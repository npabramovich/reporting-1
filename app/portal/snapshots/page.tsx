'use client'

import { useEffect, useState } from 'react'
import { Loader2, FileText, Download } from 'lucide-react'

interface SharedSnapshot {
  id: string
  name: string
  as_of_date: string | null
  shared_at: string
}

export default function PortalSnapshotsPage() {
  const [snapshots, setSnapshots] = useState<SharedSnapshot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal/snapshots')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Failed to load'))))
      .then(body => setSnapshots(body.snapshots ?? []))
      .catch(() => setError('Could not load your reports.'))
      .finally(() => setLoading(false))
  }, [])

  async function download(s: SharedSnapshot) {
    setDownloading(s.id)
    setError(null)
    try {
      const res = await fetch(`/api/portal/snapshots/${s.id}/pdf`)
      if (!res.ok) { setError('Could not generate that report. Please try again.'); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${s.name}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not generate that report. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Your reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Statements your fund has shared with you. Select one to download a PDF.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : snapshots.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          No reports have been shared with you yet.
        </div>
      ) : (
        <div className="rounded-md border bg-card divide-y">
          {snapshots.map(s => (
            <button
              key={s.id}
              onClick={() => download(s)}
              disabled={downloading === s.id}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
            >
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{s.name}</div>
                {s.as_of_date && <div className="text-xs text-muted-foreground">As of {s.as_of_date}</div>}
              </div>
              {downloading === s.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" /> : <Download className="h-4 w-4 text-muted-foreground shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
