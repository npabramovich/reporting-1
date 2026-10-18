'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import { RECEIVED_K1_FIELDS, itemLVariance, receivedK1AmountProblems, type ReceivedK1Amounts, type ReceivedK1Field } from '@/lib/tax/received-k1-amounts'

/**
 * Record a lower-tier K-1 from the tax page: that it arrived, and what it says.
 *
 * The boxes are typed as printed — income signed, deductions and distributions positive — and the
 * same checks the server runs are shown as the person types, so a 6b larger than 6a is caught at
 * the form rather than on the way back. Saving replaces the amounts on file: a box cleared here is
 * cleared there, because what is on the form IS the K-1.
 */
export function ReceivedK1Form({
  companyId,
  companyName,
  taxYear,
  status,
  receivedDate,
  amounts,
  onSaved,
  onCancel,
}: {
  companyId: string
  companyName: string
  taxYear: number
  status: string
  receivedDate: string | null
  amounts: ReceivedK1Amounts | null | undefined
  onSaved: (message: string) => void
  onCancel: () => void
}) {
  const lf = useLedgerFetch()
  const [state, setState] = useState<'received' | 'amended'>(status === 'amended' ? 'amended' : 'received')
  const [date, setDate] = useState(receivedDate ?? '')
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(RECEIVED_K1_FIELDS.map(f => [f.key, amounts?.[f.key] !== undefined ? String(amounts[f.key]) : ''])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsed: ReceivedK1Amounts = {}
  let unreadable: string | null = null
  for (const f of RECEIVED_K1_FIELDS) {
    const raw = (values[f.key] ?? '').replace(/[,\s]/g, '')
    if (!raw) continue
    const n = Number(raw.startsWith('(') && raw.endsWith(')') ? `-${raw.slice(1, -1)}` : raw)
    if (Number.isFinite(n)) parsed[f.key] = n
    else unreadable ??= `${f.label} is not a number.`
  }
  const problems = [...(unreadable ? [unreadable] : []), ...receivedK1AmountProblems(parsed)]
  const foot = itemLVariance(parsed)

  async function save() {
    setBusy(true); setError(null)
    try {
      const res = await lf('/api/accounting/received-k1s', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, taxYear, status: state, receivedDate: date || null, amounts: parsed }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d?.error ?? `Could not save the K-1 (${res.status})`)
      onSaved(`Recorded ${companyName}'s ${taxYear} K-1. Its entries post with the year's adjustments.`)
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the K-1')
    } finally {
      setBusy(false)
    }
  }

  const field = (f: ReceivedK1Field) => (
    <label key={f.key} className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-9 shrink-0 tabular-nums">{f.box === 'L' ? '' : f.box}</span>
      <span className="min-w-0 flex-1">{f.label}</span>
      <Input
        value={values[f.key] ?? ''}
        onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}
        inputMode="decimal"
        aria-label={f.box === 'L' ? `Item L, ${f.label}` : `Box ${f.box}, ${f.label}`}
        className="h-7 w-32 shrink-0 text-right text-sm text-foreground tabular-nums"
      />
    </label>
  )
  const group = (title: string, part: ReceivedK1Field['part'][], note?: string) => (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-foreground">{title}</legend>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {RECEIVED_K1_FIELDS.filter(f => part.includes(f.part)).map(field)}
    </fieldset>
  )

  return (
    <div className="mt-2 space-y-3 rounded-lg border bg-muted/20 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Status
          <select
            value={state}
            onChange={e => setState(e.target.value as 'received' | 'amended')}
            className="block h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
          >
            <option value="received">Received</option>
            <option value="amended">Amended (supersedes an earlier one)</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Received on
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8" />
        </label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {group('Part III — income and gain', ['income'], 'As printed: a loss is negative.')}
        <div className="space-y-4">
          {group('Deductions and distributions', ['deduction', 'distribution'], 'Positive amounts, as the form shows them.')}
          {group('Item L — capital account as reported', ['capital'])}
        </div>
      </div>
      {foot !== null && Math.abs(foot) >= 1 && (
        <p className="text-sm text-warning">Item L does not foot as entered: off by {foot.toFixed(2)}.</p>
      )}
      {problems.length > 0 && <ul className="text-sm text-destructive">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || problems.length > 0}>
          {busy && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save K-1
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </div>
  )
}
