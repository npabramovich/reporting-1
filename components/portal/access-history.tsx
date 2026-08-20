'use client'

import { useState } from 'react'
import { Loader2, Users, ChevronRight, ChevronDown, Eye, Download } from 'lucide-react'

interface HistoryEvent {
  id: string
  createdAt: string
  eventType: 'view' | 'download' | string
  personName: string
  personKind: string | null
  isYou: boolean
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * LP-facing "who has accessed this" disclosure. Lazily loads the access history
 * for one shared item (the LP plus their authorized users) the first time it's
 * expanded. Safe to drop next to any snapshot / letter / document.
 */
export function AccessHistory({ type, id }: { type: 'snapshot' | 'letter' | 'document'; id: string }) {
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [events, setEvents] = useState<HistoryEvent[]>([])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !loaded) {
      setLoading(true)
      try {
        const res = await fetch(`/api/portal/access-history?type=${type}&id=${id}`)
        if (res.ok) {
          const body = await res.json()
          setEvents(body.events ?? [])
        }
      } catch {
        // best-effort; leave empty
      } finally {
        setLoading(false)
        setLoaded(true)
      }
    }
  }

  return (
    <div className="text-xs">
      <button
        onClick={toggle}
        className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Users className="h-3.5 w-3.5" />
        Access history
      </button>

      {open && (
        <div className="mt-2 rounded-md border bg-card divide-y">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</div>
          ) : events.length === 0 ? (
            <div className="px-3 py-2 text-muted-foreground">No access recorded yet.</div>
          ) : (
            events.map(e => {
              const Icon = e.eventType === 'download' ? Download : Eye
              return (
                <div key={e.id} className="flex items-center gap-2 px-3 py-2">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium">{e.isYou ? 'You' : e.personName}</span>
                  {!e.isYou && e.personKind === 'authorized_user' && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">Authorized user</span>
                  )}
                  <span className="text-muted-foreground">{e.eventType === 'download' ? 'downloaded' : 'viewed'}</span>
                  <span className="ml-auto text-muted-foreground shrink-0">{fmtDateTime(e.createdAt)}</span>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
