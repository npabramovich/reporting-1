'use client'

import { useEffect, useState } from 'react'
import { Loader2, Download, X, FileWarning } from 'lucide-react'
import { AccessHistory } from '@/components/portal/access-history'

export interface ViewerDoc {
  id: string
  title: string
  file_name: string
  mime_type: string | null
}

type PreviewKind = 'pdf' | 'image' | 'text' | 'none'

/** Whether the in-portal viewer can render this file inline (vs. download-only). */
export function isPreviewable(d: ViewerDoc): boolean {
  return previewKind(d) !== 'none'
}

function previewKind(d: ViewerDoc): PreviewKind {
  const m = (d.mime_type || '').toLowerCase()
  if (m.includes('pdf')) return 'pdf'
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('text/')) return 'text'
  const ext = d.file_name?.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext ?? '')) return 'image'
  if (['txt', 'csv', 'md', 'log'].includes(ext ?? '')) return 'text'
  return 'none'
}

/**
 * In-portal document viewer. Renders PDFs, images, and text inline via a
 * short-lived inline-disposition signed URL (which also records a `view` event);
 * other file types fall back to a download prompt. Shows the document's access
 * history alongside.
 */
export function DocumentViewer({ doc, onClose }: { doc: ViewerDoc; onClose: () => void }) {
  const kind = previewKind(doc)
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let active = true
    setLoading(true); setError(false); setUrl(null)
    // Only fetch an inline URL for types we can render in-page. Others just
    // offer a download, so no inline `view` event is logged for them.
    if (kind === 'none') { setLoading(false); return }
    fetch(`/api/portal/documents/${doc.id}?disposition=inline`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(body => { if (active) { setUrl(body.url ?? null); if (!body.url) setError(true) } })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [doc.id, kind])

  async function download() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/portal/documents/${doc.id}`)
      if (res.ok) {
        const { url: dl } = await res.json()
        if (dl) window.open(dl, '_blank', 'noopener')
      }
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{doc.title}</div>
            {doc.file_name && <div className="truncate text-xs text-muted-foreground">{doc.file_name}</div>}
          </div>
          <button
            onClick={download}
            disabled={downloading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-60"
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download
          </button>
          <button onClick={onClose} title="Close" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-auto bg-muted/20">
          {kind === 'none' ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <FileWarning className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">This file type can&apos;t be previewed in the browser.</p>
              <button
                onClick={download}
                disabled={downloading}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground disabled:opacity-60"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download to view
              </button>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading preview…
            </div>
          ) : error || !url ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <FileWarning className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Couldn&apos;t load a preview.</p>
              <button
                onClick={download}
                className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              >
                <Download className="h-4 w-4" /> Download instead
              </button>
            </div>
          ) : kind === 'image' ? (
            <div className="flex h-full items-center justify-center p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={doc.title} className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <iframe src={url} title={doc.title} className="h-full w-full" />
          )}
        </div>

        {/* Footer — access history */}
        <div className="border-t px-4 py-2.5">
          <AccessHistory type="document" id={doc.id} />
        </div>
      </div>
    </div>
  )
}
