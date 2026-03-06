'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

interface AnalystModel {
  id: string
  name: string
  provider: string
}

export interface ConversationListItem {
  id: string
  title: string
  company_id: string | null
  message_count: number
  created_at: string
  updated_at: string
}

interface AnalystContextValue {
  open: boolean
  toggleOpen: () => void
  close: () => void
  messages: { role: 'user' | 'assistant'; content: string }[]
  setMessages: React.Dispatch<React.SetStateAction<{ role: 'user' | 'assistant'; content: string }[]>>
  companyId: string | null
  setCompanyId: (id: string | null) => void
  selectedModel: AnalystModel | null
  setSelectedModel: (model: AnalystModel | null) => void
  availableModels: AnalystModel[]
  fundName: string
  hasAIKey: boolean
  conversationId: string | null
  setConversationId: (id: string | null) => void
  conversations: ConversationListItem[]
  loadConversations: () => Promise<void>
  loadConversation: (id: string) => Promise<void>
  startNewConversation: () => void
  deleteConversation: (id: string) => Promise<void>
  showHistory: boolean
  setShowHistory: (show: boolean) => void
}

const AnalystContext = createContext<AnalystContextValue | null>(null)

export function AnalystProvider({
  hasAIKey,
  defaultAIProvider,
  fundName,
  children,
}: {
  hasAIKey: boolean
  defaultAIProvider: string
  fundName: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [companyId, setCompanyIdState] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<AnalystModel[]>([])
  const [selectedModel, setSelectedModel] = useState<AnalystModel | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const toggleOpen = useCallback(() => setOpen(prev => !prev), [])
  const close = useCallback(() => setOpen(false), [])

  // Reset conversation state when companyId changes
  const setCompanyId = useCallback((id: string | null) => {
    setCompanyIdState(prev => {
      if (prev !== id) {
        setMessages([])
        setConversationId(null)
        setShowHistory(false)
        setConversations([])
      }
      return id
    })
  }, [])

  const loadConversations = useCallback(async () => {
    const params = new URLSearchParams()
    if (companyId) {
      params.set('companyId', companyId)
    } else {
      params.set('portfolio', 'true')
    }
    try {
      const res = await fetch(`/api/analyst/conversations?${params}`)
      if (res.ok) {
        const data = await res.json()
        setConversations(data.conversations ?? [])
      }
    } catch {
      // Silently fail
    }
  }, [companyId])

  const loadConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/analyst/conversations/${id}`)
      if (res.ok) {
        const data = await res.json()
        const conv = data.conversation
        setConversationId(conv.id)
        setMessages(Array.isArray(conv.messages) ? conv.messages : [])
        setShowHistory(false)
      }
    } catch {
      // Silently fail
    }
  }, [])

  const startNewConversation = useCallback(() => {
    setMessages([])
    setConversationId(null)
    setShowHistory(false)
  }, [])

  const deleteConversation = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/analyst/conversations/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setConversations(prev => prev.filter(c => c.id !== id))
        if (conversationId === id) {
          setMessages([])
          setConversationId(null)
        }
      }
    } catch {
      // Silently fail
    }
  }, [conversationId])

  useEffect(() => {
    if (!hasAIKey) return

    const fetchModels = async () => {
      const [claudeRes, openaiRes, geminiRes, ollamaRes] = await Promise.allSettled([
        fetch('/api/claude-models').then(r => r.json()),
        fetch('/api/openai-models').then(r => r.json()),
        fetch('/api/gemini-models').then(r => r.json()),
        fetch('/api/ollama-models').then(r => r.json()),
      ])

      const models: AnalystModel[] = []

      if (claudeRes.status === 'fulfilled' && Array.isArray(claudeRes.value.models)) {
        for (const m of claudeRes.value.models) {
          models.push({ id: m.id, name: m.name, provider: 'anthropic' })
        }
      }

      if (openaiRes.status === 'fulfilled' && Array.isArray(openaiRes.value.models)) {
        for (const m of openaiRes.value.models) {
          models.push({ id: m.id, name: m.name, provider: 'openai' })
        }
      }

      if (geminiRes.status === 'fulfilled' && Array.isArray(geminiRes.value.models)) {
        for (const m of geminiRes.value.models) {
          models.push({ id: m.id, name: m.name, provider: 'gemini' })
        }
      }

      if (ollamaRes.status === 'fulfilled' && Array.isArray(ollamaRes.value.models)) {
        for (const m of ollamaRes.value.models) {
          models.push({ id: m.id, name: m.name, provider: 'ollama' })
        }
      }

      setAvailableModels(models)

      // Default to Auto (null selectedModel means use server default)
      if (!selectedModel) {
        setSelectedModel(null)
      }
    }

    fetchModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAIKey])

  return (
    <AnalystContext.Provider value={{
      open,
      toggleOpen,
      close,
      messages,
      setMessages,
      companyId,
      setCompanyId,
      selectedModel,
      setSelectedModel,
      availableModels,
      fundName,
      hasAIKey,
      conversationId,
      setConversationId,
      conversations,
      loadConversations,
      loadConversation,
      startNewConversation,
      deleteConversation,
      showHistory,
      setShowHistory,
    }}>
      {children}
    </AnalystContext.Provider>
  )
}

export function useAnalystContext() {
  const ctx = useContext(AnalystContext)
  if (!ctx) throw new Error('useAnalystContext must be used within AnalystProvider')
  return ctx
}
