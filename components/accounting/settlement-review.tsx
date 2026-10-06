'use client'

import { useState } from 'react'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { useCurrency, formatCurrencyFull } from '@/components/currency-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Settlement, SettlementReview } from '@/lib/accounting/settlement'

export function SettlementReviewAction({ kind, line, onChanged }: {
  kind: 'call' | 'distribution'
  line: { id: string; lpEntityId: string; name: string; manualSettled?: number; settlementReview?: string }
  onChanged: () => void
}) {
  const lf = useLedgerFetch()
  const currency = useCurrency()
  const [open, setOpen] = useState(false)
  const [payments, setPayments] = useState<Settlement[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [separate, setSeparate] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!(line.manualSettled! > 0)) return null
  async function show() {
    setOpen(true); setBusy(true); setLoaded(false); setError(null)
    try {
      const res = await lf(`/api/accounting/settlements?kind=${kind}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not load payments')
      setLoaded(true)
      setPayments(data.payments.filter((p: Settlement) => p.lpEntityId === line.lpEntityId))
      const review: SettlementReview | undefined = data.reviews.find((r: SettlementReview) => r.lineId === line.id)
      setAmounts(Object.fromEntries((review?.links ?? []).map(link => [link.entryId, String(link.amount)])))
      setSeparate(review?.separateRemainder ?? false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load payments') }
    finally { setBusy(false) }
  }
  async function save() {
    setBusy(true); setError(null)
    try {
      const links = Object.entries(amounts).filter(([, amount]) => Number(amount) > 0).map(([entryId, amount]) => ({ entryId, amount: Number(amount) }))
      const res = await lf('/api/accounting/settlements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, lineId: line.id, links, separateRemainder: separate }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not save payment review')
      setOpen(false); onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save payment review') }
    finally { setBusy(false) }
  }
  return <div className="mt-2 text-sm">
    {!open ? <Button size="sm" variant="outline" onClick={show}>Reconcile {line.name} payment</Button> : <div className="space-y-3 rounded-lg border p-3">
      <p className="font-medium">Match the recorded payment for {line.name}</p>
      <p className="text-muted-foreground">
        Recorded amount: <span className="tabular-nums">{formatCurrencyFull(line.manualSettled ?? 0, currency)}</span>. Enter how much of each accounting payment represents this amount. Matched amounts are counted once.
      </p>
      {loaded && payments.length === 0 && <p className="text-muted-foreground">
        This partner has no posted payment in the accounting records yet. Confirm below that the recorded amount is a separate payment, or import the payment first and reconcile then.
      </p>}
      {payments.map(payment => <label key={payment.entryId} className="flex items-center justify-between gap-3">
        <span>
          {payment.date} · <span className="tabular-nums">{formatCurrencyFull(payment.amount, currency)}</span>
          {/* The journal entry's id, so the reviewer can find the exact entry. A literal identifier, so mono. */}
          {payment.entryId && <> · <span className="font-mono text-xs">{payment.entryId.slice(0, 8)}</span></>}
        </span>
        <Input className="max-w-36 tabular-nums" aria-label={`Match amount for ${payment.entryId}`} type="number" min="0" step="0.01" max={payment.amount} value={amounts[payment.entryId!] ?? ''} onChange={e => setAmounts(current => ({ ...current, [payment.entryId!]: e.target.value }))} />
      </label>)}
      <label className="flex items-start gap-2"><input type="checkbox" checked={separate} onChange={e => setSeparate(e.target.checked)} /><span>I confirm any unmatched recorded amount is a separate payment, additional to the accounting payments shown.</span></label>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex gap-2"><Button size="sm" disabled={busy || !loaded} onClick={save}>Save reconciliation</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button></div>
    </div>}
  </div>
}
