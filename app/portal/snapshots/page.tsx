'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, FileText, Download, Mail, ChevronRight } from 'lucide-react'
import { LpAnalyst } from '@/components/portal/lp-analyst'

interface Snapshot { id: string; name: string; as_of_date: string | null }
interface Letter { id: string; period_label: string }
interface Doc {
  id: string; title: string; file_name: string; mime_type: string | null; size_bytes: number | null
  uploaded_at: string; doc_date: string | null; category: string | null; scope: string; sample: boolean
}

const SCOPE_ORDER: { key: string; label: string }[] = [
  { key: 'fund', label: 'Fund documents' },
  { key: 'investor', label: 'Your documents' },
]

function fmtSize(b: number | null): string {
  if (!b) return ''
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}
const effective = (d: Doc) => d.doc_date || d.uploaded_at || ''
function fmtDate(s: string): string {
  if (!s) return ''
  const date = new Date(s.length <= 10 ? `${s}T00:00:00` : s)
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fileType(d: Doc): string {
  const m = (d.mime_type || '').toLowerCase()
  if (m.includes('pdf')) return 'PDF'
  if (m.includes('wordprocessing') || m.includes('msword')) return 'Word'
  if (m.includes('spreadsheet') || m.includes('excel') || m.includes('csv')) return 'Spreadsheet'
  if (m.includes('presentation') || m.includes('powerpoint')) return 'Slides'
  if (m.startsWith('image/')) return 'Image'
  if (m.startsWith('text/')) return 'Text'
  const ext = d.file_name?.split('.').pop()?.toUpperCase()
  return ext && ext.length <= 5 ? ext : 'File'
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export default function PortalLibraryPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [letters, setLetters] = useState<Letter[]>([])
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/portal/snapshots').then(r => (r.ok ? r.json() : { snapshots: [] })),
      fetch('/api/portal/letters').then(r => (r.ok ? r.json() : { letters: [] })),
      fetch('/api/portal/documents').then(r => (r.ok ? r.json() : { documents: [] })),
    ])
      .then(([s, l, d]) => {
        setSnapshots(s.snapshots ?? [])
        setLetters(l.letters ?? [])
        setDocs(d.documents ?? [])
      })
      .catch(() => setError('Could not load your documents.'))
      .finally(() => setLoading(false))
  }, [])

  // Download a PDF blob from one of the portal PDF routes, named `fileName`.
  async function downloadPdf(key: string, url: string, fileName: string) {
    setDownloading(key)
    try {
      const res = await fetch(url)
      if (!res.ok) return
      const blob = await res.blob()
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(href)
    } finally {
      setDownloading(null)
    }
  }

  async function downloadDoc(id: string) {
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

  // scope -> docs (flat, newest first); metadata is shown on each row.
  const groupedDocs = useMemo(() => {
    const byScope = new Map<string, Doc[]>()
    for (const d of docs) {
      const s = d.scope === 'investor' ? 'investor' : 'fund'
      if (!byScope.has(s)) byScope.set(s, [])
      byScope.get(s)!.push(d)
    }
    for (const arr of Array.from(byScope.values())) arr.sort((a, b) => effective(b).localeCompare(effective(a)))
    return byScope
  }, [docs])

  // A library row that opens a web view (the whole row) plus a separate
  // "Download PDF" action. Used identically for statements and letters so the
  // two behave the same.
  function ViewableRow({ href, icon, title, subtitle, dlKey, dlUrl, dlName }: {
    href: string; icon: React.ReactNode; title: string; subtitle?: string | null
    dlKey: string; dlUrl: string; dlName: string
  }) {
    return (
      <div className="flex items-center hover:bg-muted/40 transition-colors">
        <Link href={href} className="flex flex-1 min-w-0 items-center gap-3 px-4 py-3">
          {icon}
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{title}</div>
            {subtitle && <div className="text-xs text-muted-foreground">{subtitle}</div>}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </Link>
        <button
          onClick={() => downloadPdf(dlKey, dlUrl, dlName)}
          disabled={downloading === dlKey}
          title="Download PDF"
          className="flex shrink-0 items-center gap-1.5 border-l px-3 py-3 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        >
          {downloading === dlKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span className="hidden sm:inline">PDF</span>
        </button>
      </div>
    )
  }

  const docRow = (d: Doc) => {
    const meta: string[] = [fileType(d)]
    if (d.size_bytes) meta.push(fmtSize(d.size_bytes))
    if (d.uploaded_at) meta.push(`Uploaded ${fmtDate(d.uploaded_at)}`)
    if (d.doc_date && fmtDate(d.doc_date) !== fmtDate(d.uploaded_at)) meta.push(`Dated ${fmtDate(d.doc_date)}`)

    const inner = (
      <>
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{d.title}</span>
            {d.category?.trim() && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{d.category.trim()}</span>
            )}
          </div>
          {d.file_name && <div className="text-xs text-muted-foreground truncate">{d.file_name}</div>}
          <div className="mt-0.5 text-xs text-muted-foreground/80">{meta.join(' · ')}</div>
        </div>
      </>
    )
    return d.sample ? (
      <div key={d.id} className="w-full flex items-start gap-3 px-4 py-3" title="Sample document">
        {inner}
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 mt-0.5">Sample</span>
      </div>
    ) : (
      <button key={d.id} onClick={() => downloadDoc(d.id)} disabled={downloading === d.id} className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors">
        {inner}
        {downloading === d.id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0 mt-0.5" /> : <Download className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />}
      </button>
    )
  }

  const isEmpty = snapshots.length === 0 && letters.length === 0 && docs.length === 0

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Your documents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Reports, letters, and documents your fund has shared with you.</p>
        </div>
        <LpAnalyst />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : isEmpty ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">Nothing has been shared with you yet.</div>
      ) : (
        <>
          {snapshots.length > 0 && (
            <Section title="Statements">
              <div className="rounded-md border bg-card divide-y">
                {snapshots.map(s => (
                  <ViewableRow
                    key={s.id}
                    href={`/portal/snapshots/${s.id}`}
                    icon={<FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                    title={s.name}
                    subtitle={s.as_of_date ? `As of ${s.as_of_date}` : null}
                    dlKey={`snap-${s.id}`}
                    dlUrl={`/api/portal/snapshots/${s.id}/pdf`}
                    dlName={`${s.name}.pdf`}
                  />
                ))}
              </div>
            </Section>
          )}

          {letters.length > 0 && (
            <Section title="Letters">
              <div className="rounded-md border bg-card divide-y">
                {letters.map(l => (
                  <ViewableRow
                    key={l.id}
                    href={`/portal/letters/${l.id}`}
                    icon={<Mail className="h-4 w-4 text-muted-foreground shrink-0" />}
                    title={l.period_label}
                    dlKey={`letter-${l.id}`}
                    dlUrl={`/api/portal/letters/${l.id}/pdf`}
                    dlName={`${l.period_label}.pdf`}
                  />
                ))}
              </div>
            </Section>
          )}

          {docs.length > 0 && (
            <Section title="Documents">
              <div className="space-y-4">
                {SCOPE_ORDER.map(scope => {
                  const list = groupedDocs.get(scope.key)
                  if (!list || list.length === 0) return null
                  return (
                    <div key={scope.key} className="space-y-1.5">
                      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{scope.label}</h3>
                      <div className="rounded-md border bg-card divide-y">{list.map(docRow)}</div>
                    </div>
                  )
                })}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
