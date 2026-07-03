'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Lock, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface Period { id: string; period_start: string; period_end: string; label: string | null; status: string; closed_at: string | null }

export function PeriodsView() {
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lf = useLedgerFetch()

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/periods').then(r => (r.ok ? r.json() : [])).then(d => setPeriods(Array.isArray(d) ? d : [])).finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  async function close() {
    setBusy(true); setError(null)
    const res = await lf('/api/accounting/periods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close', periodStart: start, periodEnd: end, label }) })
    const data = await res.json()
    if (res.ok) { setStart(''); setEnd(''); setLabel(''); load() } else setError(data.error ?? 'Failed')
    setBusy(false)
  }

  async function reopen(id: string) {
    await lf('/api/accounting/periods', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reopen', id }) })
    load()
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="border rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium">Close & lock a period</p>
        <p className="text-xs text-muted-foreground">
          First run the P&amp;L close on the Allocations page (Close period) if you want income/expense
          zeroed into the bridge. Locking snapshots the ledger as text and blocks new postings dated
          in this range until you reopen it.
        </p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Start</label>
            <input type="date" value={start} onChange={e => setStart(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">End</label>
            <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Label (optional)</label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Q4 2022" className="border rounded px-2 py-1.5 text-sm w-full bg-transparent" />
          </div>
        </div>
        <Button size="sm" onClick={close} disabled={busy || !start || !end}><Lock className="h-3.5 w-3.5 mr-1" />Close & lock</Button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : periods.length === 0 ? (
        <p className="text-sm text-muted-foreground">No periods yet.</p>
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
                    {p.status === 'closed' && <button onClick={() => reopen(p.id)} className="text-xs text-muted-foreground hover:underline">Reopen</button>}
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
