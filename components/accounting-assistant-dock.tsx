'use client'

// A floating accounting-assistant, available on every /funds/* page. It wraps the same
// AssistantPanel the Admin page uses — reads the current vehicle's books, answers questions, and
// drafts entries you approve — so the assistant is one click away wherever you are in accounting,
// matching how the Analyst assistant works elsewhere in the app. Lives in the funds layout, which
// provides the VehicleProvider the panel needs.

import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { AssistantPanel } from '@/app/(app)/funds/status/assistant-panel'

export function AccountingAssistantDock() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* The panel. Fixed to the bottom-right, above the toggle; scrolls internally so a long
          answer never pushes the page. */}
      {open && (
        <div className="fixed bottom-20 right-4 z-50 w-[min(440px,calc(100vw-2rem))] max-h-[75vh] overflow-y-auto rounded-lg border bg-card shadow-xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-card/95 backdrop-blur px-3 py-2">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="h-4 w-4 text-muted-foreground" />Accounting assistant
            </span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close assistant">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-3">
            <AssistantPanel />
          </div>
        </div>
      )}

      {/* The toggle. */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed bottom-4 right-4 z-50 inline-flex items-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium shadow-lg transition-colors ${
          open ? 'bg-accent text-foreground' : 'bg-card text-muted-foreground hover:text-foreground'
        }`}
        aria-label="Accounting assistant"
      >
        <Sparkles className="h-4 w-4" />
        Assistant
      </button>
    </>
  )
}
