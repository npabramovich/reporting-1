'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { PERIOD_PRESETS, type PeriodPreset } from '@/lib/accounting/statement-period'

interface Account {
  beginning: number
  contributions: number
  distributions: number
  managementFees: number
  expenses: number
  operatingIncome: number
  realizedGains: number
  unrealizedGains: number
  transfers: number
  carriedInterest: number
  unclassified: number
  ending: number
}
interface Row extends Account {
  lpEntityId: string
  name: string
  partnerClass: string
  period: Account | null
  itd: Account
}
interface Period { preset: PeriodPreset; start: string | null; end: string | null; label: string }

const COLUMNS: { key: keyof Account; label: string }[] = [
  { key: 'beginning', label: 'Beginning' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'distributions', label: 'Distributions' },
  { key: 'managementFees', label: 'Mgmt fees' },
  { key: 'expenses', label: 'Partnership exp.' },
  { key: 'operatingIncome', label: 'Operating income' },
  { key: 'realizedGains', label: 'Net realized G/(L)' },
  { key: 'unrealizedGains', label: 'Net unrealized G/(L)' },
  { key: 'transfers', label: 'Transfers' },
  { key: 'carriedInterest', label: 'Carry accrued' },
  { key: 'unclassified', label: 'Unclassified' },
  { key: 'ending', label: 'Ending' },
]

export function CapitalAccountsView() {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const [rows, setRows] = useState<Row[]>([])
  const [nav, setNav] = useState(0)
  const [period, setPeriod] = useState<Period | null>(null)
  const [loading, setLoading] = useState(true)
  const lf = useLedgerFetch()

  const [preset, setPreset] = useState<PeriodPreset>('itd')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [commitment, setCommitment] = useState('')
  const [partnerClass, setPartnerClass] = useState('lp')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (preset === 'custom') {
      if (start) qs.set('start', start)
      if (end) qs.set('end', end)
      qs.set('preset', 'custom')
    } else {
      qs.set('preset', preset)
    }
    lf(`/api/accounting/capital-accounts?${qs}`)
      .then(r => (r.ok ? r.json() : { rows: [], nav: 0 }))
      .then(d => { setRows(d.rows ?? []); setNav(d.nav ?? 0); setPeriod(d.period ?? null) })
      .finally(() => setLoading(false))
  }, [lf, preset, start, end])
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

  // Values shown are scoped to the selected period; ITD is the whole history.
  const acctOf = (r: Row): Account => (period?.preset === 'itd' ? r.itd : r.period ?? r.itd)

  // Drop lines that are zero for every partner — a clean set of books should never
  // show an "Unclassified" column, but it has to appear the moment something lands
  // there, or a manual posting would be invisible while still inside Ending.
  const columns = useMemo(
    () => COLUMNS.filter(c =>
      c.key === 'beginning' || c.key === 'ending' ||
      rows.some(r => Math.abs(acctOf(r)[c.key]) > 0.004)
    ),
    [rows, period], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const totals = columns.reduce((acc, c) => {
    acc[c.key] = rows.reduce((s, r) => s + acctOf(r)[c.key], 0)
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 border rounded-lg p-3">
        <label className="text-xs text-muted-foreground">Statement period
          <select
            value={preset}
            onChange={e => setPreset(e.target.value as PeriodPreset)}
            className="mt-1 block h-9 px-3 rounded-md border border-input bg-background text-sm"
          >
            {PERIOD_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        {preset === 'custom' && (
          <>
            <label className="text-xs text-muted-foreground">From
              <Input type="date" value={start} onChange={e => setStart(e.target.value)} className="mt-1 h-9 w-40" />
            </label>
            <label className="text-xs text-muted-foreground">To
              <Input type="date" value={end} onChange={e => setEnd(e.target.value)} className="mt-1 h-9 w-40" />
            </label>
          </>
        )}
        {period && (
          <span className="text-xs text-muted-foreground pb-2">
            {period.preset === 'itd'
              ? 'Showing all activity since inception.'
              : <>Showing <strong>{period.label}</strong>. Beginning capital is the balance carried in{period.start ? ` before ${period.start}` : ''}.</>}
          </span>
        )}
      </div>

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
                {columns.map(c => <th key={c.key} className="text-right px-3 py-2 font-medium">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const a = acctOf(r)
                return (
                  <tr key={r.lpEntityId} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <Link href={`/accounting/capital-accounts/${r.lpEntityId}`} className="hover:underline">{r.name}</Link>
                      {r.partnerClass === 'gp' && <span className="ml-1.5 text-[10px] uppercase tracking-wider px-1 py-0.5 rounded bg-muted text-muted-foreground">GP</span>}
                    </td>
                    {columns.map(c => (
                      <td key={c.key} className={`px-3 py-2 text-right font-mono ${c.key === 'ending' ? 'font-semibold' : ''} ${c.key === 'unclassified' && Math.abs(a[c.key]) > 0.004 ? 'text-amber-600' : ''}`}>
                        {fmt(a[c.key])}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="px-3 py-2">Total (NAV {fmt(nav)})</td>
                {columns.map(c => <td key={c.key} className="px-3 py-2 text-right font-mono">{fmt(totals[c.key])}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
