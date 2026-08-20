'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * A titled section that collapses behind a dropdown arrow. Used to fold the accounting
 * Admin page's many configuration blocks (carry terms, allocation, deal carry, …) so each
 * can be hidden — the page stays scannable while keeping everything on one surface.
 */
export function CollapsibleSection({
  title, subtitle, defaultOpen = false, right, children,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  /** Optional content pinned to the right of the header (e.g. a status pill). */
  right?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
        </div>
        {right && <div className="shrink-0" onClick={e => e.stopPropagation()}>{right}</div>}
      </button>
      {open && <div className="border-t p-3">{children}</div>}
    </div>
  )
}
