'use client'

// Fees the GP earns from portfolio companies (transaction, monitoring, directors'), recorded so the
// fee schedule's offsets can credit them against the management fee (lib/accounting/portfolio-fees.ts).
// They're paid to the GP or the management company, not the fund, so nothing here posts to the books.

import { useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'

type Kind = 'transaction' | 'monitoring' | 'directors' | 'other'
interface Fee { id: string; date: string; kind: Kind; amount: number; companyId: string | null; memo: string | null }

export const FEE_KIND_LABELS: Record<Kind, string> = {
  transaction: 'Transaction',
  monitoring: 'Monitoring',
  directors: 'Directors’',
  other: 'Other',
}

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function PortfolioFeesList() {
  const lf = useLedgerFetch()
  const [fees, setFees] = useState<Fee[] | null>(null)
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [date, setDate] = useState('')
  const [kind, setKind] = useState<Kind>('transaction')
  const [amount, setAmount] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    lf('/api/accounting/portfolio-fees').then(r => (r.ok ? r.json() : null)).then(d => setFees(d?.fees ?? []))
    // The company is optional, so a member who can't read the portfolio can still record a fee.
    fetch('/api/companies').then(r => (r.ok ? r.json() : [])).then(d => {
      if (Array.isArray(d)) setCompanies(d.map((c: any) => ({ id: c.id, name: c.name })))
    }).catch(() => {})
  }, [lf])

  const add = async () => {
    setBusy(true); setError(null)
    const res = await lf('/api/accounting/portfolio-fees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, kind, amount: Number(amount), companyId: companyId || null, memo }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? 'Could not save the fee'); return }
    setFees(prev => [...(prev ?? []), d.fee].sort((a, b) => a.date.localeCompare(b.date)))
    setAmount(''); setMemo('')
  }

  const remove = async (id: string) => {
    setError(null)
    const res = await lf(`/api/accounting/portfolio-fees?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Could not delete the fee'); return }
    setFees(prev => (prev ?? []).filter(f => f.id !== id))
  }

  const companyName = (id: string | null) => (id ? companies.find(c => c.id === id)?.name ?? '' : '')

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Portfolio-company fees</p>
      <p className="text-xs text-muted-foreground max-w-3xl">
        Fees the GP or the management company was paid by portfolio companies. Each one offsets the
        period it&rsquo;s dated in, at the share set above, and an offset larger than the period&rsquo;s
        fee carries into the next. Recording one here doesn&rsquo;t post anything to the fund&rsquo;s books.
      </p>
      {fees === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : fees.length > 0 && (
        <div className="overflow-x-auto border border-border rounded-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-normal">Date</th>
                <th className="px-4 py-2 font-normal">Kind</th>
                <th className="px-4 py-2 font-normal">Company</th>
                <th className="px-4 py-2 font-normal text-right">Amount</th>
                <th className="px-4 py-2 font-normal">Memo</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {fees.map(f => (
                <tr key={f.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-2 tabular-nums">{f.date}</td>
                  <td className="px-4 py-2">{FEE_KIND_LABELS[f.kind]}</td>
                  <td className="px-4 py-2">{companyName(f.companyId)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(f.amount)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{f.memo ?? ''}</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => remove(f.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40 h-8 text-sm" aria-label="Date" />
        <select value={kind} onChange={e => setKind(e.target.value as Kind)} aria-label="Kind" className="border border-border rounded-sm bg-background text-foreground px-2 py-1 text-sm">
          {(Object.keys(FEE_KIND_LABELS) as Kind[]).map(k => <option key={k} value={k}>{FEE_KIND_LABELS[k]}</option>)}
        </select>
        {companies.length > 0 && (
          <select value={companyId} onChange={e => setCompanyId(e.target.value)} aria-label="Company" className="border border-border rounded-sm bg-background text-foreground px-2 py-1 text-sm max-w-48">
            <option value="">No company</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" className="w-32 h-8 text-sm tabular-nums" aria-label="Amount" />
        <Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Memo" className="w-48 h-8 text-sm" aria-label="Memo" />
        <Button size="sm" variant="outline" className="text-muted-foreground" onClick={add} disabled={busy || !date || !amount}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
          Record fee
        </Button>
      </div>
      {error && <p className="text-sm text-warning">{error}</p>}
    </div>
  )
}
