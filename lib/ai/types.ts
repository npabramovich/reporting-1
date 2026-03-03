export interface TextBlock { type: 'text'; text: string }
export interface DocumentBlock { type: 'document'; mediaType: string; data: string }
export interface ImageBlock { type: 'image'; mediaType: string; data: string }

export type ContentBlock = TextBlock | DocumentBlock | ImageBlock
export type MessageContent = string | ContentBlock[]

export interface CreateMessageParams {
  model: string
  maxTokens: number
  system?: string
  content: MessageContent
}

export interface AIModel { id: string; name: string }

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface AIResult {
  text: string
  usage: TokenUsage
}

export interface AIProvider {
  createMessage(params: CreateMessageParams): Promise<AIResult>
  testConnection(): Promise<void>
  listModels(): Promise<AIModel[]>
}
