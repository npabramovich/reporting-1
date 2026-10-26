'use client'

// Carried interest held in a third-party escrow (lib/accounting/carry-escrow.ts). The escrow sits
// outside the fund's books, so this register is where the ILPA Reporting Template reads its
// "Amount Held in Escrow" balance from. Recording an entry posts nothing.

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import type { EscrowEvent, EscrowKind } from '@/lib/accounting/carry-escrow'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function CarryEscrowList() {
  const lf = useLedgerFetch()
  const [events, setEvents] = useState<EscrowEvent[] | null>(null)
  const [balance, setBalance] = useState(0)
  const [date, setDate] = useState('')
  const [kind, setKind] = useState<EscrowKind>('deposit')
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => lf('/api/accounting/carry-escrow').then(r => (r.ok ? r.json() : null)).then(d => {
    setEvents(d?.events ?? [])
    setBalance(Number(d?.balance ?? 0))
  }), [lf])
  useEffect(() => { load() }, [load])

  const add = async () => {
    setBusy(true); setError(null)
    const res = await lf('/api/accounting/carry-escrow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, kind, amount: Number(amount), memo }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { setError(d.error ?? 'Could not save the escrow entry'); return }
    setAmount(''); setMemo('')
    load()
  }

  const remove = async (id: string) => {
    setError(null)
    const res = await lf(`/api/accounting/carry-escrow?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Could not delete the escrow entry'); return }
    load()
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Carry held in escrow</p>
      <p className="text-xs text-muted-foreground max-w-3xl">
        Carried interest paid into a third-party escrow under the LPA, and released from it to the
        carry recipients or back to the fund on a clawback. Nothing here posts to the books; it fills
        the &ldquo;Amount Held in Escrow&rdquo; line of each partner&rsquo;s ILPA report.
      </p>
      {events === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading…</div>
      ) : events.length > 0 && (
        <div className="overflow-x-auto border border-border rounded-sm">
          <table className="min-w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-normal">Date</th>
                <th className="px-4 py-2 font-normal">Entry</th>
                <th className="px-4 py-2 font-normal text-right">Amount</th>
                <th className="px-4 py-2 font-normal">Memo</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {events.map(e => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-2 tabular-nums">{e.date}</td>
                  <td className="px-4 py-2">{e.kind === 'deposit' ? 'Paid into escrow' : 'Released'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(e.kind === 'deposit' ? e.amount : -e.amount)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{e.memo ?? ''}</td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => remove(e.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2 font-medium" colSpan={2}>Held now</td>
                <td className="px-4 py-2 text-right tabular-nums font-medium">{money(balance)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-40 h-8 text-sm" aria-label="Date" />
        <select value={kind} onChange={e => setKind(e.target.value as EscrowKind)} aria-label="Entry" className="border border-border rounded-sm bg-background text-foreground px-2 py-1 text-sm">
          <option value="deposit">Paid into escrow</option>
          <option value="release">Released</option>
        </select>
        <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount" className="w-32 h-8 text-sm tabular-nums" aria-label="Amount" />
        <Input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Memo" className="w-48 h-8 text-sm" aria-label="Memo" />
        <Button size="sm" variant="outline" className="text-muted-foreground" onClick={add} disabled={busy || !date || !amount}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
          Record
        </Button>
      </div>
      {error && <p className="text-sm text-warning">{error}</p>}
    </div>
  )
}
