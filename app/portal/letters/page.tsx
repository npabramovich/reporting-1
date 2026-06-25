'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Mail, ChevronRight } from 'lucide-react'

interface SharedLetter {
  id: string
  period_label: string
  period_year: number
  period_quarter: number
  shared_at: string
}

export default function PortalLettersPage() {
  const [letters, setLetters] = useState<SharedLetter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal/letters')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Failed to load'))))
      .then(body => setLetters(body.letters ?? []))
      .catch(() => setError('Could not load your letters.'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Letters</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Quarterly updates your fund has shared with you.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : letters.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          No letters have been shared with you yet.
        </div>
      ) : (
        <div className="rounded-md border bg-card divide-y">
          {letters.map(l => (
            <Link
              key={l.id}
              href={`/portal/letters/${l.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
            >
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{l.period_label}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
