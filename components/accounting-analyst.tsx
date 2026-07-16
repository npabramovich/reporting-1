'use client'

// The accounting Analyst — the same header-button + page-shifting side panel the app's Analyst
// uses elsewhere (/dashboard, /import), so accounting is consistent with the rest of the app. The
// panel content is the accounting assistant (reads the current vehicle's books, drafts entries you
// approve); the button is named "Analyst" to match. Mounted in the funds layout; the toggle button
// sits in the vehicle-bar row (inside this provider, so it can toggle open).

import { createContext, useContext, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AssistantPanel } from '@/app/(app)/funds/status/assistant-panel'

const Ctx = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} })

/** Wraps the accounting pages: content flexes to make room for the panel when it's open. */
export function AccountingAnalystShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Ctx.Provider value={{ open, toggle: () => setOpen(o => !o) }}>
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 min-w-0 w-full">{children}</div>
        {open && (
          <aside className="w-full lg:w-[400px] shrink-0 lg:sticky lg:top-4">
            <div className="rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />Analyst
                </span>
                <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
              </div>
              <div className="max-h-[calc(100vh-8rem)] overflow-y-auto p-3">
                <AssistantPanel />
              </div>
            </div>
          </aside>
        )}
      </div>
    </Ctx.Provider>
  )
}

/** The "Analyst" toggle — place it in the page header (vehicle-bar row). */
export function AccountingAnalystButton() {
  const { open, toggle } = useContext(Ctx)
  return (
    <Button
      variant="outline"
      size="sm"
      className={`gap-1.5 h-8 py-2 text-muted-foreground hover:text-foreground ${open ? 'bg-accent' : ''}`}
      onClick={toggle}
    >
      <Sparkles className="h-3.5 w-3.5" />
      Analyst
    </Button>
  )
}
