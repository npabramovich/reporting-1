'use client'

import { useEffect, useState, useCallback } from 'react'
import { Sparkles, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SummaryData {
  summary: string | null
  period_label?: string | null
  generated_at?: string | null
}

interface Props {
  companyId: string
}

export function CompanySummary({ companyId }: Props) {
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the latest stored summary
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/companies/${companyId}/summary`)
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [companyId])

  // Generate a new summary via POST
  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/companies/${companyId}/summary`, { method: 'POST' })
      const result = await res.json()
      if (res.ok) {
        setData(result)
      } else {
        setError(result.error ?? 'Unable to generate summary.')
      }
    } catch {
      setError('Unable to generate summary at this time.')
    } finally {
      setGenerating(false)
    }
  }

  async function clear() {
    setClearing(true)
    setError(null)
    try {
      const res = await fetch(`/api/companies/${companyId}/summary`, { method: 'DELETE' })
      if (res.ok) {
        setData({ summary: null })
      }
    } catch {
      setError('Failed to clear summary.')
    } finally {
      setClearing(false)
    }
  }

  useEffect(() => { load() }, [load])

  // Loading skeleton
  if (loading) {
    return (
      <div className="rounded-lg border bg-card p-5 mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">AI Analyst</span>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
          <div className="h-3 bg-muted rounded w-4/6" />
        </div>
      </div>
    )
  }

  // No summary yet — show generate button
  if (!data?.summary) {
    return (
      <div className="rounded-lg border border-dashed bg-card p-5 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">AI Analyst</span>
          </div>
          <Button size="sm" variant="outline" onClick={generate} disabled={generating}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            {generating ? 'Generating…' : 'Generate summary'}
          </Button>
        </div>
        {generating && (
          <div className="animate-pulse space-y-2 mt-3">
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-5/6" />
            <div className="h-3 bg-muted rounded w-4/6" />
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive mt-3">{error}</p>
        )}
      </div>
    )
  }

  // Render the summary with paragraph breaks
  const paragraphs = data.summary.split('\n\n').filter(p => p.trim())

  return (
    <div className="rounded-lg border bg-card p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">AI Analyst</span>
          {data.generated_at && (
            <span className="text-[10px] text-muted-foreground">
              · {new Date(data.generated_at).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={generate}
            disabled={generating || clearing}
            title="Regenerate summary"
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={clear}
            disabled={generating || clearing}
            title="Clear and start fresh"
            className="h-7 px-2 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-sm leading-relaxed">{p}</p>
        ))}
      </div>
      {generating && (
        <div className="animate-pulse space-y-2 mt-3 pt-3 border-t">
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-5/6" />
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive mt-3 pt-3 border-t">{error}</p>
      )}
    </div>
  )
}
