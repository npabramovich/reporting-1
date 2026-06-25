'use client'

import { useEffect, useState } from 'react'
import { Loader2, FileText, Download } from 'lucide-react'

interface Doc {
  id: string
  title: string
  file_name: string
  size_bytes: number | null
  uploaded_at: string
}

function fmtSize(b: number | null): string {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

export default function PortalDocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal/documents')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(b => setDocs(b.documents ?? []))
      .catch(() => setError('Could not load your documents.'))
      .finally(() => setLoading(false))
  }, [])

  async function download(id: string) {
    setDownloading(id)
    try {
      const res = await fetch(`/api/portal/documents/${id}`)
      if (res.ok) {
        const { url } = await res.json()
        if (url) window.open(url, '_blank', 'noopener')
      }
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Files your fund has shared with you.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : docs.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">No documents have been shared with you yet.</div>
      ) : (
        <div className="rounded-md border bg-card divide-y">
          {docs.map(d => (
            <button key={d.id} onClick={() => download(d.id)} disabled={downloading === d.id} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{d.title}</div>
                <div className="text-xs text-muted-foreground truncate">{d.file_name}{d.size_bytes ? ` · ${fmtSize(d.size_bytes)}` : ''}</div>
              </div>
              {downloading === d.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" /> : <Download className="h-4 w-4 text-muted-foreground shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
