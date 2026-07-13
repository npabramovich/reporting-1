'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock, Unlock, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface Period { id: string; period_start: string; period_end: string; label: string | null; status: string; closed_at: string | null }
interface CloseLine { lpEntityId: string; name: string; amount: number }
interface CloseCategory {
  sourceType: string
  label: string
  capitalEffect: number
  accounts: { code: string; name: string; amount: number }[]
  lines: CloseLine[]
}
interface Preview {
  periodStart: string
  periodEnd: string
  netIncome: number
  categories: CloseCategory[]
  basis: string
  warnings: string[]
}

/** Default the close to the month just ended — the common case. */
function lastMonth(): { start: string; end: string; label: string } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return {
    start: iso(start),
    end: iso(end),
    label: start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }
}

export function PeriodsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState(lastMonth().start)
  const [end, setEnd] = useState(lastMonth().end)
  const [label, setLabel] = useState(lastMonth().label)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const lf = useLedgerFetch()

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/periods').then(r => (r.ok ? r.json() : [])).then(d => setPeriods(Array.isArray(d) ? d : [])).finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  const post = async (body: object) => {
    const res = await lf('/api/accounting/periods', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    return { ok: res.ok, data: await res.json() }
  }

  async function runPreview() {
    setBusy(true); setError(null); setPreview(null)
    const { ok, data } = await post({ action: 'preview', periodStart: start, periodEnd: end })
    setBusy(false)
    if (!ok) { setError(data.error ?? 'Could not preview'); return }
    setPreview(data)
  }

  async function confirmClose() {
    setBusy(true); setError(null)
    const { ok, data } = await post({ action: 'close', periodStart: start, periodEnd: end, label })
    setBusy(false)
    if (!ok) { setError(data.error ?? 'Could not close'); return }
    setPreview(null)
    load()
  }

  async function reopen(id: string) {
    setBusy(true); setError(null)
    const { ok, data } = await post({ action: 'reopen', id })
    setBusy(false)
    if (!ok) { setError(data.error ?? 'Could not reopen'); return }
    load()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="border rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium">Close a period</p>
        <p className="text-xs text-muted-foreground">
          Closing allocates the period&rsquo;s income and expenses to each partner&rsquo;s capital account
          (pro-rata by commitment), snapshots the ledger, and blocks new postings dated in the range.
          This is the only place allocation happens — expense and mark entries never touch capital
          accounts on their own. Reopening reverses the allocation.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Start</label>
            <input type="date" value={start} onChange={e => { setStart(e.target.value); setPreview(null) }} className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">End</label>
            <input type="date" value={end} onChange={e => { setEnd(e.target.value); setPreview(null) }} className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Label (optional)</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="June 2026" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={runPreview} disabled={busy || !start || !end}>
          {busy && !preview && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}Preview close
        </Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {/* Nothing is posted until this is approved. */}
      {preview && (
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b bg-muted/30">
            <p className="text-sm font-medium">
              Closing {preview.periodStart} → {preview.periodEnd} will allocate {fmt(preview.netIncome)} of net income
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Split across partners pro-rata by commitment. Nothing is posted until you confirm.</p>
          </div>

          {preview.warnings.map((w, i) => (
            <p key={i} className="px-4 py-2 text-xs text-amber-600 flex items-center gap-1.5 border-b">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}
            </p>
          ))}

          {preview.categories.map(cat => (
            <div key={cat.sourceType} className="border-b last:border-b-0">
              <div className="px-4 py-2 flex items-center justify-between bg-muted/10">
                <span className="text-sm font-medium">{cat.label}</span>
                <span className={`font-mono text-sm ${cat.capitalEffect < 0 ? 'text-muted-foreground' : ''}`}>{fmt(cat.capitalEffect)}</span>
              </div>
              <p className="px-4 pb-1 text-[11px] text-muted-foreground">
                From {cat.accounts.map(a => `${a.code} ${a.name}`).join(', ')}
              </p>
              <table className="w-full text-xs">
                <tbody>
                  {cat.lines.filter(l => l.amount !== 0).map(l => (
                    <tr key={l.lpEntityId} className="border-t">
                      <td className="px-4 py-1 text-muted-foreground">{l.name}</td>
                      <td className="px-4 py-1 text-right font-mono">{fmt(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div className="px-4 py-3 flex items-center gap-2 border-t bg-muted/30">
            <Button size="sm" onClick={confirmClose} disabled={busy}>
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}<Lock className="h-3.5 w-3.5 mr-1" />Close &amp; lock
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreview(null)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No periods closed yet.</p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Period</th>
                <th className="text-left px-3 py-2 font-medium">Label</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {periods.map(p => (
                <tr key={p.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs">{p.period_start} → {p.period_end}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.label ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${p.status === 'closed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-muted text-muted-foreground'}`}>
                      {p.status === 'closed' ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}{p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {p.status === 'closed' && (
                      <button
                        onClick={() => reopen(p.id)}
                        disabled={busy}
                        title="Void this period's allocation entries and unlock the range"
                        className="text-xs text-muted-foreground hover:underline disabled:opacity-50"
                      >
                        Reopen &amp; reverse
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
