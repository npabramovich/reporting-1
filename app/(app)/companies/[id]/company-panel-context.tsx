'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import type { MentionTextareaRef } from '@/components/mention-textarea'

interface PanelContextValue {
  notesOpen: boolean
  toggleNotes: () => void
  closeNotes: () => void
  companyId: string
  userId: string
  isAdmin: boolean
  unreadCount: number
  setUnreadCount: (n: number) => void
  inputRef: React.MutableRefObject<MentionTextareaRef | null>
}

const PanelContext = createContext<PanelContextValue | null>(null)

export function CompanyPanelProvider({
  companyId,
  userId,
  isAdmin,
  children,
}: {
  companyId: string
  userId: string
  isAdmin: boolean
  children: ReactNode
}) {
  const [notesOpen, setNotesOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const inputRef = useRef<MentionTextareaRef | null>(null)

  const toggleNotes = useCallback(() => {
    setNotesOpen(prev => !prev)
  }, [])

  const closeNotes = useCallback(() => {
    setNotesOpen(false)
  }, [])

  useEffect(() => {
    if (notesOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [notesOpen])

  return (
    <PanelContext.Provider value={{
      notesOpen,
      toggleNotes,
      closeNotes,
      companyId,
      userId,
      isAdmin,
      unreadCount,
      setUnreadCount,
      inputRef,
    }}>
      {children}
    </PanelContext.Provider>
  )
}

export function usePanelContext() {
  const ctx = useContext(PanelContext)
  if (!ctx) throw new Error('usePanelContext must be used within CompanyPanelProvider')
  return ctx
}
