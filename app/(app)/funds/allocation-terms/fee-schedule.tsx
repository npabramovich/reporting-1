'use client'

// A vehicle's dated management fee schedule: what the management fee allocation charges for a
// period when it books from the schedule (lib/accounting/fee-schedule.ts).
//
// Rates are entered as PERCENTAGES here and stored as fractions, as on the carry terms.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { FEE_KIND_LABELS, PortfolioFeesList } from './portfolio-fees'

type Frequency = 'quarterly' | 'semiannual' | 'annual'
type Basis = 'commitments' | 'invested' | 'nav'
interface StepRow { from: string; rate: string; basis: Basis }
type FeeKind = keyof typeof FEE_KIND_LABELS
const FEE_KINDS = Object.keys(FEE_KIND_LABELS) as FeeKind[]

const pct = (fraction: number) => String(Math.round((fraction || 0) * 10000) / 100)
const frac = (percent: string) => {
  const n = Number(percent)
  return percent.trim() !== '' && Number.isFinite(n) ? n / 100 : NaN
}

export function FeeScheduleCard() {
  const lf = useLedgerFetch()
  const [on, setOn] = useState(false)
  const [frequency, setFrequency] = useState<Frequency>('quarterly')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [steps, setSteps] = useState<StepRow[]>([{ from: '', rate: '2', basis: 'commitments' }])
  const [cap, setCap] = useState('')
  const [offsets, setOffsets] = useState<Record<FeeKind, string>>(() => Object.fromEntries(FEE_KINDS.map(k => [k, ''])) as Record<FeeKind, string>)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const apply = useCallback((s: any) => {
    setOn(!!s)
    if (!s) return
    setFrequency(s.frequency)
    setStart(s.start)
    setEnd(s.end)
    setSteps(s.steps.map((x: any) => ({ from: x.from, rate: pct(x.rate), basis: x.basis })))
    setCap(s.organizationalExpenseCap != null ? String(s.organizationalExpenseCap) : '')
    setOffsets(Object.fromEntries(FEE_KINDS.map(k => [k, s.offsets?.[k] != null ? pct(s.offsets[k]) : ''])) as Record<FeeKind, string>)
  }, [])

  useEffect(() => {
    lf('/api/accounting/fee-schedule').then(r => (r.ok ? r.json() : null)).then(d => { apply(d?.schedule ?? null); setLoading(false) })
  }, [lf, apply])

  const save = async () => {
    setBusy(true); setError(null); setSaved(false)
    const schedule = on ? {
      frequency,
      start,
      end,
      // The first rate starts with the schedule unless it says otherwise.
      steps: steps.map((s, i) => ({ from: s.from || (i === 0 ? start : ''), rate: frac(s.rate), basis: s.basis })),
      ...(cap.trim() !== '' ? { organizationalExpenseCap: Number(cap) } : {}),
      offsets: Object.fromEntries(FEE_KINDS.filter(k => offsets[k].trim() !== '').map(k => [k, frac(offsets[k])])),
    } : null
    const res = await lf('/api/accounting/fee-schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule }) })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? 'Could not save'); return }
    apply(d.schedule ?? null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the fee schedule…</div>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground max-w-3xl">
        The management fee as the LPA states it: how often it&rsquo;s charged, each rate and what
        it&rsquo;s charged on, from the date it starts. Booking the fee from the schedule charges the
        period the entry date falls in. A rate that starts mid-period is charged for its share of the
        days, and partners exempt from the fee on the Allocation terms page don&rsquo;t bear it.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} />
        This vehicle has a fee schedule
      </label>

      {on && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="space-y-1 text-xs font-medium">Charged
              <select value={frequency} onChange={e => setFrequency(e.target.value as Frequency)} className="w-full border border-border rounded-sm bg-background text-foreground px-3 py-2 text-sm">
                <option value="quarterly">Quarterly</option>
                <option value="semiannual">Semiannually</option>
                <option value="annual">Annually</option>
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium">Starts<Input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>
            <label className="space-y-1 text-xs font-medium">Ends (exclusive)<Input type="date" value={end} onChange={e => setEnd(e.target.value)} /></label>
            <label className="space-y-1 text-xs font-medium">Organizational expense cap
              <Input inputMode="decimal" value={cap} onChange={e => setCap(e.target.value)} placeholder="None" className="tabular-nums" />
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium">Rates</p>
            {steps.map((s, i) => {
              const set = (patch: Partial<StepRow>) => setSteps(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x))
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input type="date" value={s.from || (i === 0 ? start : '')} onChange={e => set({ from: e.target.value })} className="w-40 h-8 text-sm" />
                  <div className="relative w-24">
                    <Input inputMode="decimal" value={s.rate} onChange={e => set({ rate: e.target.value })} className="h-8 text-sm tabular-nums" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                  <span className="text-xs text-muted-foreground">a year of</span>
                  <select value={s.basis} onChange={e => set({ basis: e.target.value as Basis })} className="border border-border rounded-sm bg-background text-foreground px-2 py-1 text-sm">
                    <option value="commitments">Commitments</option>
                    <option value="invested">Invested capital</option>
                    <option value="nav">NAV</option>
                  </select>
                  {i > 0 && <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setSteps(prev => prev.filter((_, j) => j !== i))}>Remove</Button>}
                </div>
              )
            })}
            <Button size="sm" variant="outline" className="text-muted-foreground" onClick={() => setSteps(prev => [...prev, { from: '', rate: '', basis: 'invested' }])}>
              Add a step-down
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium">Offsets</p>
            <p className="text-xs text-muted-foreground max-w-3xl">
              The share of each kind of portfolio-company fee that reduces the management fee. Leave
              a kind blank when the LPA doesn&rsquo;t offset it.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {FEE_KINDS.map(k => (
                <label key={k} className="space-y-1 text-xs font-medium">{FEE_KIND_LABELS[k]}
                  <div className="relative">
                    <Input inputMode="decimal" value={offsets[k]} onChange={e => setOffsets(prev => ({ ...prev, [k]: e.target.value }))} placeholder="None" className="h-8 text-sm tabular-nums" />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-warning">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" variant="outline" className="text-muted-foreground" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
          Save fee schedule
        </Button>
        {saved && <span className="text-xs text-success">Saved</span>}
      </div>

      {on && <PortfolioFeesList />}
    </div>
  )
}
