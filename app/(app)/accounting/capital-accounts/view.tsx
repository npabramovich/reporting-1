'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'

interface Row {
  lpEntityId: string
  name: string
  partnerClass: string
  beginning: number
  contributions: number
  distributions: number
  managementFees: number
  expenses: number
  gains: number
  other: number
  ending: number
}

const COLUMNS: { key: keyof Row; label: string }[] = [
  { key: 'beginning', label: 'Beginning' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'managementFees', label: 'Mgmt fees' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'gains', label: 'Gains' },
  { key: 'ending', label: 'Ending' },
]

export function CapitalAccountsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [rows, setRows] = useState<Row[]>([])
  const [nav, setNav] = useState(0)
  const [loading, setLoading] = useState(true)
  const lf = useLedgerFetch()

  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [commitment, setCommitment] = useState('')
  const [partnerClass, setPartnerClass] = useState('lp')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    lf('/api/accounting/capital-accounts')
      .then(r => (r.ok ? r.json() : { rows: [], nav: 0 }))
      .then(d => { setRows(d.rows ?? []); setNav(d.nav ?? 0) })
      .finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  async function addLp() {
    setErr(null)
    if (!name.trim()) { setErr('Enter a name'); return }
    setAdding(true)
    const res = await lf('/api/accounting/lps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), commitment: Number(commitment) || 0, partnerClass }),
    })
    const data = await res.json()
    setAdding(false)
    if (!res.ok) { setErr(data.error ?? 'Could not add'); return }
    setName(''); setCommitment(''); setPartnerClass('lp'); setShowAdd(false)
    load()
  }

  const totals = COLUMNS.reduce((acc, c) => {
    acc[c.key] = rows.reduce((s, r) => s + (r[c.key] as number), 0)
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowAdd(v => !v)}><Plus className="h-4 w-4 mr-1" />Add LP</Button>
        <span className="text-xs text-muted-foreground">Add a partner (LP or GP) to this vehicle with a commitment.</span>
      </div>

      {showAdd && (
        <div className="border rounded-lg p-3 flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">Name
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ashgrove Associates LLC" className="mt-1 h-9 w-64" />
          </label>
          <label className="text-xs text-muted-foreground">Commitment
            <Input value={commitment} onChange={e => setCommitment(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1 h-9 w-36 font-mono" />
          </label>
          <label className="text-xs text-muted-foreground">Type
            <select value={partnerClass} onChange={e => setPartnerClass(e.target.value)} className="mt-1 block h-9 px-3 rounded-md border border-input bg-background text-sm">
              <option value="lp">LP</option>
              <option value="gp">GP</option>
            </select>
          </label>
          <Button size="sm" onClick={addLp} disabled={adding}>{adding && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Add</Button>
          {err && <span className="text-xs text-amber-600">{err}</span>}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : rows.length === 0 ? (
        <div className="border border-dashed rounded-lg p-8 text-center text-sm text-muted-foreground">
          No capital accounts yet. Add a partner above, or import opening balances from the Accounting home page.
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm whitespace-nowrap">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-3 py-2 font-medium">Partner</th>
                {COLUMNS.map(c => <th key={c.key} className="text-right px-3 py-2 font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.lpEntityId} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link href={`/accounting/capital-accounts/${r.lpEntityId}`} className="hover:underline">{r.name}</Link>
                    {r.partnerClass === 'gp' && <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1 py-0.5 rounded bg-muted text-muted-foreground">GP</span>}
                  </td>
                  {COLUMNS.map(c => (
                    <td key={c.key} className={`px-3 py-2 text-right font-mono ${c.key === 'ending' ? 'font-semibold' : ''}`}>
                      {fmt(r[c.key] as number)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="px-3 py-2">Total (NAV {fmt(nav)})</td>
                {COLUMNS.map(c => <td key={c.key} className="px-3 py-2 text-right font-mono">{fmt(totals[c.key])}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
