'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import {
  DRAW_PURPOSE_LABEL, DRAW_PURPOSES, EVENT_TYPE_LABEL, FACILITY_EVENT_TYPES, FACILITY_KIND_LABEL, FACILITY_KINDS,
  type DrawPurpose, type FacilityEventType, type FacilityKind,
} from '@/lib/accounting/credit-facility-core'

// The vehicle's credit facilities: a subscription line or other borrowing, its balance, and each
// draw, repayment, interest payment and fee (lib/accounting/credit-facility.ts). What a draw paid
// for and which call paid a repayment or interest is what the ILPA performance file needs to state
// returns with and without the line.

interface Row {
  id: string
  type: FacilityEventType
  date: string
  amount: number
  purpose: DrawPurpose | null
  callId: string | null
  journalEntryId: string | null
  origin: 'posted' | 'linked'
  memo: string | null
  live: boolean
}
interface Facility {
  id: string
  name: string
  kind: FacilityKind
  lender: string | null
  commitmentAmount: number | null
  openedOn: string | null
  maturesOn: string | null
  rateDescription: string | null
  balance: { drawn: number; repaid: number; outstanding: number; interest: number; fees: number }
  available: number | null
  events: Row[]
}
interface Call { id: string; callNumber: number | null; callDate: string; total: number }

const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

export function CreditFacilityPanel({ canWrite }: { canWrite: boolean }) {
  const lf = useLedgerFetch()
  const currency = useCurrency()
  const fmt = (v: number | null) => formatCurrencyPrice(v, currency)

  const [facilities, setFacilities] = useState<Facility[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [fac, setFac] = useState({ name: '', kind: 'subscription' as FacilityKind, lender: '', commitmentAmount: '', openedOn: '', maturesOn: '', rateDescription: '' })
  const [row, setRow] = useState({ facilityId: '', type: 'draw' as FacilityEventType, date: '', amount: '', purpose: 'investment' as DrawPurpose, callId: '', entryId: '', memo: '' })

  // The first load shows the spinner (loading starts true); a reload after a save refreshes in place.
  const load = useCallback(() => {
    Promise.all([
      lf('/api/accounting/credit-facilities').then(r => (r.ok ? r.json() : { facilities: [] })),
      lf('/api/accounting/capital-calls').then(r => (r.ok ? r.json() : { calls: [] })),
    ])
      .then(([f, c]) => {
        setFacilities(f.facilities ?? [])
        setCalls((c.calls ?? []).map((x: any) => ({ id: x.id, callNumber: x.callNumber ?? null, callDate: x.callDate, total: x.total })))
      })
      .finally(() => setLoading(false))
  }, [lf])
  useEffect(() => { load() }, [load])

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setSaving(true)
    setError(null)
    try {
      const r = await lf('/api/accounting/credit-facilities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const out = await r.json().catch(() => null)
      if (!r.ok) { setError(out?.error ?? 'That could not be saved.'); return false }
      load()
      return true
    } finally {
      setSaving(false)
    }
  }

  async function saveFacility() {
    const ok = await post({ action: 'save_facility', ...fac, commitmentAmount: fac.commitmentAmount || null })
    if (ok) { setAdding(false); setFac({ name: '', kind: 'subscription', lender: '', commitmentAmount: '', openedOn: '', maturesOn: '', rateDescription: '' }) }
  }

  async function record() {
    const ok = await post({
      action: 'record',
      facilityId: row.facilityId || facilities[0]?.id,
      type: row.type,
      date: row.date,
      amount: row.amount,
      ...(row.type === 'draw' ? { purpose: row.purpose } : row.callId ? { callId: row.callId } : {}),
      ...(row.entryId.trim() ? { entryId: row.entryId.trim() } : {}),
      ...(row.memo.trim() ? { memo: row.memo.trim() } : {}),
    })
    if (ok) setRow(r => ({ ...r, date: '', amount: '', callId: '', entryId: '', memo: '' }))
  }

  const callLabel = (id: string | null) => {
    const c = calls.find(x => x.id === id)
    return c ? `${c.callNumber ? `Call ${c.callNumber}` : 'Call'}, ${c.callDate}` : ''
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {facilities.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          No credit facility is recorded. Add the fund&rsquo;s subscription line here, then record each draw, repayment and
          interest payment against it.
        </p>
      )}

      {facilities.map(f => (
        <div key={f.id} className="rounded-card border">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2 border-b">
            <span className="text-sm font-medium">{f.name}</span>
            <span className="text-xs text-muted-foreground">
              {FACILITY_KIND_LABEL[f.kind]}{f.lender ? ` · ${f.lender}` : ''}{f.rateDescription ? ` · ${f.rateDescription}` : ''}
              {f.maturesOn ? ` · matures ${f.maturesOn}` : ''}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 px-3 py-2 text-sm">
            {[
              ['Size', fmt(f.commitmentAmount)],
              ['Outstanding', fmt(f.balance.outstanding)],
              ['Available', fmt(f.available)],
              ['Drawn to date', fmt(f.balance.drawn)],
              ['Interest and fees', fmt(f.balance.interest + f.balance.fees)],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          {f.events.length > 0 && (
            <div className="overflow-x-auto border-t">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-3 py-2 font-medium">Date</th>
                    <th className="text-left px-3 py-2 font-medium">Type</th>
                    <th className="text-left px-3 py-2 font-medium">For / paid by</th>
                    <th className="text-right px-3 py-2 font-medium">Amount</th>
                    <th className="text-left px-3 py-2 font-medium">Entry</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {f.events.map(e => (
                    <tr key={e.id} className={`border-b last:border-b-0 ${e.live ? '' : 'text-muted-foreground line-through'}`}>
                      <td className="px-3 py-2 tabular-nums">{e.date}</td>
                      <td className="px-3 py-2">{EVENT_TYPE_LABEL[e.type]}</td>
                      <td className="px-3 py-2">{e.purpose ? DRAW_PURPOSE_LABEL[e.purpose] : callLabel(e.callId)}{e.memo ? <span className="text-muted-foreground"> · {e.memo}</span> : null}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(e.amount)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{e.origin === 'linked' ? 'Linked' : e.live ? 'Posted' : 'Voided'}</td>
                      <td className="px-3 py-2 text-right">
                        {canWrite && (e.origin === 'linked' || !e.live) && (
                          <Button size="sm" variant="ghost" disabled={saving} aria-label="Remove row" onClick={() => post({ action: 'remove_row', id: e.id })}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {canWrite && facilities.length > 0 && (
        <div className="rounded-card border p-3 space-y-2">
          <p className="text-sm font-medium">Record a draw, repayment, interest or fee</p>
          <div className="flex flex-wrap items-center gap-2">
            {facilities.length > 1 && (
              <select aria-label="Facility" className={selectClass} value={row.facilityId} onChange={e => setRow({ ...row, facilityId: e.target.value })}>
                <option value="">Facility…</option>
                {facilities.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
            <select aria-label="Type" className={selectClass} value={row.type} onChange={e => setRow({ ...row, type: e.target.value as FacilityEventType })}>
              {FACILITY_EVENT_TYPES.map(t => <option key={t} value={t}>{EVENT_TYPE_LABEL[t]}</option>)}
            </select>
            <Input type="date" aria-label="Date" className="h-9 w-auto" value={row.date} onChange={e => setRow({ ...row, date: e.target.value })} />
            <Input type="number" aria-label="Amount" placeholder="Amount" className="h-9 w-36 tabular-nums" value={row.amount} onChange={e => setRow({ ...row, amount: e.target.value })} />
            {row.type === 'draw' ? (
              <select aria-label="Paid for" className={selectClass} value={row.purpose} onChange={e => setRow({ ...row, purpose: e.target.value as DrawPurpose })}>
                {DRAW_PURPOSES.map(p => <option key={p} value={p}>{DRAW_PURPOSE_LABEL[p]}</option>)}
              </select>
            ) : (
              <select aria-label="Paid by call" className={selectClass} value={row.callId} onChange={e => setRow({ ...row, callId: e.target.value })}>
                <option value="">Paid by call (optional)…</option>
                {calls.map(c => <option key={c.id} value={c.id}>{callLabel(c.id)} · {fmt(c.total)}</option>)}
              </select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Existing entry id" placeholder="Already booked? Entry id to link (optional)" className="h-9 w-80" value={row.entryId} onChange={e => setRow({ ...row, entryId: e.target.value })} />
            <Input aria-label="Memo" placeholder="Memo (optional)" className="h-9 w-64" value={row.memo} onChange={e => setRow({ ...row, memo: e.target.value })} />
            <Button size="sm" disabled={saving || !row.date || !row.amount} onClick={record}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : row.entryId.trim() ? 'Link' : 'Post'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A draw posts Dr cash / Cr loan payable, a repayment the reverse, and interest or a fee Dr interest expense / Cr cash,
            allocated to the partners. If the movement is already on the books, give its entry id and the row links it instead.
            Link interest to the call that paid it so the ILPA &ldquo;without facility&rdquo; returns leave it out.
          </p>
        </div>
      )}

      {canWrite && (adding ? (
        <div className="rounded-card border p-3 space-y-2">
          <p className="text-sm font-medium">Add a facility</p>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Name" placeholder="Name, e.g. Subscription line" className="h-9 w-56" value={fac.name} onChange={e => setFac({ ...fac, name: e.target.value })} />
            <select aria-label="Kind" className={selectClass} value={fac.kind} onChange={e => setFac({ ...fac, kind: e.target.value as FacilityKind })}>
              {FACILITY_KINDS.map(k => <option key={k} value={k}>{FACILITY_KIND_LABEL[k]}</option>)}
            </select>
            <Input aria-label="Lender" placeholder="Lender" className="h-9 w-44" value={fac.lender} onChange={e => setFac({ ...fac, lender: e.target.value })} />
            <Input type="number" aria-label="Size" placeholder="Size" className="h-9 w-36 tabular-nums" value={fac.commitmentAmount} onChange={e => setFac({ ...fac, commitmentAmount: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Opened</span>
            <Input type="date" aria-label="Opened" className="h-9 w-auto" value={fac.openedOn} onChange={e => setFac({ ...fac, openedOn: e.target.value })} />
            <span className="text-sm text-muted-foreground">Matures</span>
            <Input type="date" aria-label="Matures" className="h-9 w-auto" value={fac.maturesOn} onChange={e => setFac({ ...fac, maturesOn: e.target.value })} />
            <Input aria-label="Rate" placeholder="Rate, e.g. SOFR + 2.25%" className="h-9 w-56" value={fac.rateDescription} onChange={e => setFac({ ...fac, rateDescription: e.target.value })} />
            <Button size="sm" disabled={saving || !fac.name.trim()} onClick={saveFacility}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1.5" />Add a facility</Button>
      ))}
    </div>
  )
}
