import { GoogleGenAI } from '@google/genai'
import type { AIProvider, AIModel, AIResult, CreateMessageParams, CreateChatParams, ContentBlock } from './types'

export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey })
  }

  async createMessage(params: CreateMessageParams): Promise<AIResult> {
    const contents = typeof params.content === 'string'
      ? params.content
      : toGeminiContent(params.content)

    const response = await this.client.models.generateContent({
      model: params.model,
      contents,
      config: {
        maxOutputTokens: params.maxTokens,
        ...(params.system ? { systemInstruction: params.system } : {}),
      },
    })

    const text = response.text ?? ''
    const truncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS'

    return {
      text,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      truncated,
    }
  }

  async createChat(params: CreateChatParams): Promise<AIResult> {
    // Build history from all messages except the last (which we send as the new message)
    const history = params.messages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: m.content }],
    }))

    const lastMessage = params.messages[params.messages.length - 1]

    const chat = this.client.chats.create({
      model: params.model,
      config: {
        maxOutputTokens: params.maxTokens,
        ...(params.system ? { systemInstruction: params.system } : {}),
      },
      history,
    })

    const response = await chat.sendMessage({ message: lastMessage.content })

    const text = response.text ?? ''
    const truncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS'

    return {
      text,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      truncated,
    }
  }

  async testConnection(): Promise<void> {
    await this.client.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: 'Hi',
      config: { maxOutputTokens: 10 },
    })
  }

  async listModels(): Promise<AIModel[]> {
    const pager = await this.client.models.list()
    const models: AIModel[] = []
    for await (const model of pager) {
      if (!model.name) continue
      // Only include generative models (gemini-)
      const id = model.name.replace(/^models\//, '')
      if (!id.startsWith('gemini-')) continue
      models.push({ id, name: model.displayName ?? id })
    }
    return models
  }
}

function toGeminiContent(blocks: ContentBlock[]): Array<string | { inlineData: { data: string; mimeType: string } }> {
  const parts: Array<string | { inlineData: { data: string; mimeType: string } }> = []

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'image':
        parts.push({
          inlineData: { data: block.data, mimeType: block.mediaType },
        })
        break
      case 'document':
        // Gemini doesn't support PDF via base64 inline data in the same way —
        // extracted text is already included in text content blocks, so skip.
        break
    }
  }

  return parts
}
