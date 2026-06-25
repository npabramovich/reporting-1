'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowLeft } from 'lucide-react'

interface Letter {
  id: string
  period_label: string
  full_draft: string | null
  portfolio_table_html: string | null
}

export default function PortalLetterDetailPage() {
  const { letterId } = useParams<{ letterId: string }>()
  const [letter, setLetter] = useState<Letter | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/portal/letters/${letterId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('not found'))))
      .then(body => setLetter(body.letter))
      .catch(() => setError('This letter is not available.'))
      .finally(() => setLoading(false))
  }, [letterId])

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
  }
  if (error || !letter) {
    return (
      <div className="space-y-4">
        <Link href="/portal/letters" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back</Link>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error ?? 'Not found.'}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/portal/letters" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Back to letters</Link>

      <h1 className="text-xl font-semibold tracking-tight">{letter.period_label}</h1>

      <div className="rounded-md border bg-card p-6 space-y-4">
        {letter.full_draft && (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{letter.full_draft}</div>
        )}
        {letter.portfolio_table_html && (
          // GP-authored letter content, rendered as-is.
          <div className="text-sm overflow-x-auto [&_table]:w-full [&_th]:text-left [&_th]:px-2 [&_th]:py-1 [&_td]:px-2 [&_td]:py-1 [&_td]:border-t" dangerouslySetInnerHTML={{ __html: letter.portfolio_table_html }} />
        )}
        {!letter.full_draft && !letter.portfolio_table_html && (
          <p className="text-sm text-muted-foreground italic">This letter has no content.</p>
        )}
      </div>
    </div>
  )
}
