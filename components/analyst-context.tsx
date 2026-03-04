'use client'

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

interface AnalystModel {
  id: string
  name: string
  provider: 'anthropic' | 'openai'
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
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [availableModels, setAvailableModels] = useState<AnalystModel[]>([])
  const [selectedModel, setSelectedModel] = useState<AnalystModel | null>(null)

  const toggleOpen = useCallback(() => setOpen(prev => !prev), [])
  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!hasAIKey) return

    const fetchModels = async () => {
      const [claudeRes, openaiRes] = await Promise.allSettled([
        fetch('/api/claude-models').then(r => r.json()),
        fetch('/api/openai-models').then(r => r.json()),
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

      setAvailableModels(models)

      // Default to first model from the fund's default provider
      if (models.length > 0 && !selectedModel) {
        const preferred = models.find(m => m.provider === defaultAIProvider) ?? models[0]
        setSelectedModel(preferred)
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
