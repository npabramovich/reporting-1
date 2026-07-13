'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, FileText, Check, AlertTriangle, PhoneCall } from 'lucide-react'
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
  commitment: number
  called: number
  funded: number
  outstanding: number
  receivable: number
  period: Account | null
  itd: Account
}
interface CallLine { lpEntityId: string; name: string; amount: number }
interface CallRow { id: string; callDate: string; description: string | null; scope: string; total: number; lines: CallLine[] }
interface Period { preset: PeriodPreset; start: string | null; end: string | null; label: string }

/** Commitment / unfunded come from the call register; the rest is the roll-forward.
 *  They live on one table because "funded vs outstanding" is just the capital account
 *  seen from the commitment side — it was the duplicated half of the Capital calls page. */
const COMMITMENT_COLUMNS: { key: 'commitment' | 'outstanding' | 'receivable'; label: string }[] = [
  { key: 'commitment', label: 'Commitment' },
  { key: 'outstanding', label: 'Unfunded' },
  { key: 'receivable', label: 'Called, unpaid' },
]

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
  const lf = useLedgerFetch()

  const [rows, setRows] = useState<Row[]>([])
  const [calls, setCalls] = useState<CallRow[]>([])
  const [nav, setNav] = useState(0)
  const [period, setPeriod] = useState<Period | null>(null)
  const [loading, setLoading] = useState(true)

  const [preset, setPreset] = useState<PeriodPreset>('itd')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [commitment, setCommitment] = useState('')
  const [partnerClass, setPartnerClass] = useState('lp')
  const [adding, setAdding] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<{ count: number; errors: string[] } | null>(null)

  // Issue-a-call (folded in from the old Capital calls page).
  const [showCall, setShowCall] = useState(false)
  const [mode, setMode] = useState<'fund_wide' | 'per_lp'>('fund_wide')
  const [callDate, setCallDate] = useState('')
  const [description, setDescription] = useState('')
  const [callTotal, setCallTotal] = useState('')
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [issuing, setIssuing] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

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
      .then(r => (r.ok ? r.json() : { rows: [], nav: 0, calls: [] }))
      .then(d => { setRows(d.rows ?? []); setNav(d.nav ?? 0); setPeriod(d.period ?? null); setCalls(d.calls ?? []) })
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

  async function publishStatements() {
    if (!period) return
    setPublishing(true); setErr(null); setPublishResult(null)
    const res = await lf('/api/accounting/lp-statement/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        period.preset === 'custom' ? { start: period.start, end: period.end } : { preset: period.preset }
      ),
    })
    const data = await res.json()
    setPublishing(false)
    if (!res.ok) { setErr(data.error ?? 'Could not publish statements'); return }
    setPublishResult({ count: data.count ?? 0, errors: data.errors ?? [] })
  }

  const enteredTotal = rows.reduce((s, r) => s + (Number(amounts[r.lpEntityId]) || 0), 0)

  async function splitProRata() {
    const t = Number(callTotal)
    if (!Number.isFinite(t) || t <= 0) { setMsg({ ok: false, text: 'Enter a positive total to split' }); return }
    const res = await lf('/api/accounting/capital-calls', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'preview', total: t }),
    })
    const data = await res.json()
    if (!res.ok) { setMsg({ ok: false, text: data.error ?? 'Could not split' }); return }
    const next: Record<string, string> = {}
    for (const l of (data.lines ?? [])) next[l.lpEntityId] = String(l.amount)
    setAmounts(next); setMsg(null)
  }

  async function issue() {
    setMsg(null)
    const lines = rows
      .map(r => ({ lpEntityId: r.lpEntityId, amount: Number(amounts[r.lpEntityId]) || 0 }))
      .filter(l => l.amount > 0)
    if (lines.length === 0) { setMsg({ ok: false, text: 'Enter at least one LP amount' }); return }
    if (!callDate) { setMsg({ ok: false, text: 'Pick a call date' }); return }
    setIssuing(true)
    const res = await lf('/api/accounting/capital-calls', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'issue', callDate, description: description || null, scope: mode, lines }),
    })
    const data = await res.json()
    setIssuing(false)
    if (!res.ok) { setMsg({ ok: false, text: data.error ?? 'Could not issue call' }); return }
    setMsg({ ok: true, text: 'Call issued.' })
    setAmounts({}); setCallTotal(''); setDescription('')
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
  const commitmentCols = useMemo(
    () => COMMITMENT_COLUMNS.filter(c => c.key !== 'receivable' || rows.some(r => Math.abs(r.receivable) > 0.004)),
    [rows],
  )

  const totals = columns.reduce((acc, c) => {
    acc[c.key] = rows.reduce((s, r) => s + acctOf(r)[c.key], 0)
    return acc
  }, {} as Record<string, number>)
  const commitTotals = commitmentCols.reduce((acc, c) => {
    acc[c.key] = rows.reduce((s, r) => s + r[c.key], 0)
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

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowAdd(v => !v)}><Plus className="h-4 w-4 mr-1" />Add LP</Button>
        <Button size="sm" variant="outline" onClick={() => setShowCall(v => !v)} disabled={rows.length === 0}>
          <PhoneCall className="h-4 w-4 mr-1" />Issue a capital call
        </Button>
        <Button size="sm" variant="outline" onClick={publishStatements} disabled={publishing || rows.length === 0}>
          {publishing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
          Publish statements to LP portal
        </Button>
        {err && <span className="text-xs text-amber-600">{err}</span>}
      </div>

      {publishResult && (
        <div className="rounded-lg border p-3 text-sm space-y-1">
          <p className="flex items-center gap-1.5 text-green-700 dark:text-green-400">
            <Check className="h-4 w-4" />
            Published {publishResult.count} capital account statement{publishResult.count === 1 ? '' : 's'} for {period?.label} to the LP portal.
          </p>
          {publishResult.errors.map((e, i) => <p key={i} className="text-xs text-amber-600">{e}</p>)}
        </div>
      )}

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
        </div>
      )}

      {/* Issue a call — folded in from the old Capital calls page. */}
      {showCall && rows.length > 0 && (
        <div className="border rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium">Issue a capital call</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">Date
              <input type="date" value={callDate} onChange={e => setCallDate(e.target.value)} className="block mt-1 border border-input rounded px-2 py-1.5 text-sm bg-transparent" />
            </label>
            <label className="text-xs text-muted-foreground flex-1 min-w-[180px]">Description
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. Call #3 — new investment" className="block mt-1 w-full border border-input rounded px-2 py-1.5 text-sm bg-transparent" />
            </label>
            <div className="text-xs text-muted-foreground">
              <span className="block mb-1">Type</span>
              <div className="inline-flex rounded border border-input overflow-hidden">
                <button type="button" onClick={() => setMode('fund_wide')} className={`px-2.5 py-1.5 text-xs ${mode === 'fund_wide' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>Fund-wide</button>
                <button type="button" onClick={() => setMode('per_lp')} className={`px-2.5 py-1.5 text-xs border-l border-input ${mode === 'per_lp' ? 'bg-accent text-foreground' : 'text-muted-foreground'}`}>Per-LP</button>
              </div>
            </div>
          </div>

          {mode === 'fund_wide' && (
            <div className="flex items-end gap-2">
              <label className="text-xs text-muted-foreground">Total to call
                <input value={callTotal} onChange={e => setCallTotal(e.target.value)} inputMode="decimal" placeholder="0.00" className="block mt-1 border border-input rounded px-2 py-1.5 text-sm font-mono bg-transparent w-40" />
              </label>
              <Button size="sm" variant="outline" onClick={splitProRata}>Split pro-rata</Button>
              <span className="text-xs text-muted-foreground pb-2">Fills each LP by commitment — edit any row below.</span>
            </div>
          )}

          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-medium">Partner</th>
                  <th className="text-right px-3 py-2 font-medium">Commitment</th>
                  <th className="text-right px-3 py-2 font-medium">Unfunded</th>
                  <th className="text-right px-3 py-2 font-medium">Call amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.lpEntityId} className="border-b last:border-b-0">
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmt(r.commitment)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{fmt(r.outstanding)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        value={amounts[r.lpEntityId] ?? ''}
                        onChange={e => setAmounts(a => ({ ...a, [r.lpEntityId]: e.target.value }))}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="border border-input rounded px-2 py-1 text-sm font-mono bg-transparent w-32 text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>Call total</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(enteredTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={issue} disabled={issuing || enteredTotal <= 0}>
              {issuing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Issue call
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCall(false)} disabled={issuing}>Cancel</Button>
            {msg && (
              <span className={`text-sm flex items-center gap-1 ${msg.ok ? 'text-green-600' : 'text-amber-600'}`}>
                {msg.ok ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{msg.text}
              </span>
            )}
          </div>
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
                {/* Commitment side — was the Capital calls page. */}
                {commitmentCols.map(c => <th key={c.key} className="text-right px-3 py-2 font-medium border-l">{c.label}</th>)}
                {columns.map((c, i) => <th key={c.key} className={`text-right px-3 py-2 font-medium ${i === 0 ? 'border-l' : ''}`}>{c.label}</th>)}
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
                    {commitmentCols.map(c => (
                      <td key={c.key} className={`px-3 py-2 text-right font-mono border-l ${c.key !== 'commitment' && Math.abs(r[c.key]) > 0.004 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                        {fmt(r[c.key])}
                      </td>
                    ))}
                    {columns.map((c, i) => (
                      <td key={c.key} className={`px-3 py-2 text-right font-mono ${i === 0 ? 'border-l' : ''} ${c.key === 'ending' ? 'font-semibold' : ''} ${c.key === 'unclassified' && Math.abs(a[c.key]) > 0.004 ? 'text-amber-600' : ''}`}>
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
                {commitmentCols.map(c => <td key={c.key} className="px-3 py-2 text-right font-mono border-l">{fmt(commitTotals[c.key])}</td>)}
                {columns.map((c, i) => <td key={c.key} className={`px-3 py-2 text-right font-mono ${i === 0 ? 'border-l' : ''}`}>{fmt(totals[c.key])}</td>)}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {calls.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2 mt-4">Issued calls</p>
          <div className="space-y-2">
            {calls.map(c => (
              <div key={c.id} className="border rounded-lg p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{c.callDate} · {fmt(c.total)}</span>
                  <span className="text-xs text-muted-foreground">{c.scope === 'fund_wide' ? 'Fund-wide' : 'Per-LP'}</span>
                </div>
                {c.description && <p className="text-xs text-muted-foreground mt-0.5">{c.description}</p>}
                <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5">
                  {c.lines.map(l => <span key={l.lpEntityId}>{l.name}: <span className="font-mono">{fmt(l.amount)}</span></span>)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
