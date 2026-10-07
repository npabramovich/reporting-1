'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCurrency, formatCurrencyPrice } from '@/components/currency-context'
import { useLedgerFetch } from '@/components/accounting-vehicle'
import type { AwaitingMatch } from '@/lib/accounting/investment-bank-match'

// Investment entries waiting for their bank match (lib/accounting/investment-bank-match.ts).
//
// A purchase, exit or cash income derives a DRAFT, because the bank feed books the same wire and
// posting both would count the payment twice. Each one waits here with the bank rows of exactly its
// amount, nearest date first — suggested, never applied. A vehicle with no bank feed posts it
// without a match, on a deliberate second click that is recorded on the entry.
//
// Renders nothing when nothing is waiting.

export function InvestmentMatchQueue({ onChanged }: { onChanged?: () => void }) {
  const currency = useCurrency()
  const fmt = (v: number) => formatCurrencyPrice(v, currency)
  const lf = useLedgerFetch()
  const [rows, setRows] = useState<AwaitingMatch[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The txn whose "post without a bank match" has been clicked once — the second click commits.
  const [confirming, setConfirming] = useState<string | null>(null)

  const load = useCallback(() => {
    lf('/api/accounting/investment-bank-match')
      .then(r => (r.ok ? r.json() : []))
      .then(d => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
  }, [lf])
  useEffect(() => { load() }, [load])

  async function act(txnId: string, body: object) {
    setBusy(txnId); setError(null)
    const res = await lf('/api/accounting/investment-bank-match', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId: txnId, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(null); setConfirming(null)
    if (!res.ok) { setError(data.error ?? 'Could not post the entry.'); return }
    load(); onChanged?.()
  }

  if (rows.length === 0) return null

  return (
    <div className="border rounded-card p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Investments waiting for a bank match</p>
        <p className="text-xs text-muted-foreground">
          Each posts when matched to the bank transaction that paid it. Only a transaction of the same amount can match.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="divide-y">
        {rows.map(r => (
          <li key={r.entryId} className="py-2 space-y-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="tabular-nums text-muted-foreground">{r.entryDate}</span>
              <span className="flex-1 min-w-0 truncate">{r.memo ?? 'Investment entry'}</span>
              <span className="tabular-nums">{fmt(r.cash)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {r.candidates.map(c => (
                <Button key={c.id} size="sm" variant="outline" disabled={busy !== null}
                  onClick={() => act(r.txnId, { bankTransactionId: c.id })}>
                  {busy === r.txnId ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Link2 className="h-4 w-4 mr-1" />}
                  Match <span className="tabular-nums mx-1">{c.txnDate}</span>{c.description ? `· ${c.description}` : ''}
                </Button>
              ))}
              {r.candidates.length === 0 && (
                <span className="text-xs text-muted-foreground">No bank transaction of this amount yet.</span>
              )}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => confirming === r.txnId ? act(r.txnId, { withoutBankMatch: true }) : setConfirming(r.txnId)}
                className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                {confirming === r.txnId ? 'Confirm: this payment has no bank transaction' : 'Post without a bank match'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
