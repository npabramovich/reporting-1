'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertTriangle, Check, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLedgerFetch } from '@/components/accounting-vehicle'

// Putting the portfolio tracker's history on the ledger.
//
// A transaction recorded today derives its entry as it is saved. Ones recorded before that
// existed derived nothing, so a vehicle can track millions and carry nothing. This card runs those
// through the same derivation (lib/accounting/investment-backfill.ts): marks post, purchases and
// other cash entries draft and wait for their bank match.
//
// There is no history-versus-snapshot question here any more. That was the retired `history_mode`
// setting, still asked in the UI: derivation is always per transaction, on its own date. A company
// the ledger already carries by another route (a snapshot, a replay, a QuickBooks import) is
// left alone and named, so nothing books twice.
//
// Renders NOTHING unless there is something to derive.

interface Backfill {
  toDerive: number
  alreadyDerived: number
  toPost: number
  /** The whole vehicle was refused, and why. */
  blocked?: string
  carriedElsewhere: string[]
  posted: number
  awaitingBankMatch: number
  refused: string[]
}

export function BootstrapInvestmentsCard({ onBooked }: { onBooked?: () => void } = {}) {
  const lf = useLedgerFetch()
  const [preview, setPreview] = useState<Backfill | null>(null)
  const [result, setResult] = useState<Backfill | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = useCallback(async (dryRun: boolean): Promise<Backfill | null> => {
    const res = await lf('/api/accounting/investments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'backfill', dryRun }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { setError(data.error ?? 'Failed'); return null }
    return data as Backfill
  }, [lf])

  // The preview is a POST (it shares the backfill's code path), so a member who can read accounting
  // but not write it is refused. That is not an error worth showing: the card simply isn't theirs.
  useEffect(() => {
    lf('/api/accounting/investments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'backfill', dryRun: true }),
    }).then(r => (r.ok ? r.json() : null)).then(setPreview).catch(() => setPreview(null))
  }, [lf])

  async function run() {
    setBusy(true); setError(null)
    const r = await call(false)
    setBusy(false)
    if (!r) return
    setResult(r)
    setPreview(await call(true))
    onBooked?.()
  }

  if (!preview && !result && !error) return null
  if (preview && !preview.blocked && preview.toDerive + preview.toPost === 0 && !result && !error) return null

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {result && (
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-1.5 text-success">
            <Check className="h-4 w-4" />
            Posted {result.posted} {result.posted === 1 ? 'mark' : 'marks'}.{' '}
            {result.awaitingBankMatch > 0 && <>{result.awaitingBankMatch} {result.awaitingBankMatch === 1 ? 'entry waits' : 'entries wait'} for a bank match.</>}
          </p>
          {result.awaitingBankMatch > 0 && (
            <Link href="/funds/bank" className="text-xs underline underline-offset-2 hover:text-foreground">Match them on the bank page</Link>
          )}
          {result.refused.length > 0 && (
            <div className="rounded-card border border-warning/40 bg-warning/10 p-3">
              <p className="flex items-center gap-1.5 font-medium text-warning">
                <AlertTriangle className="h-4 w-4" />{result.refused.length} not booked
              </p>
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {result.refused.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {preview?.blocked && (
        <div className="rounded-card border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm font-medium text-warning flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />The investment history can&rsquo;t be put on the ledger yet.
          </p>
          <p className="text-xs text-muted-foreground mt-1">{preview.blocked}</p>
        </div>
      )}

      {preview && !preview.blocked && preview.toDerive + preview.toPost > 0 && (
        <div className="rounded-card border border-warning/40 bg-warning/10 p-3 space-y-2">
          <p className="text-sm font-medium text-warning flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" />
            {preview.toDerive + preview.toPost} {preview.toDerive + preview.toPost === 1 ? 'transaction has' : 'transactions have'} not reached the ledger.
          </p>
          <p className="text-xs text-muted-foreground">
            Each one books on its own date. Marks post at once — they move no cash. Purchases, exits and cash
            income are drafted and post when matched to their bank transaction, so a wire the bank feed also
            brings in is never booked twice. Running this again derives nothing twice.
          </p>
          {preview.carriedElsewhere.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Left alone, because the ledger already carries them by another route:{' '}
              {preview.carriedElsewhere.join(', ')}.
            </p>
          )}
          <Button size="sm" onClick={run} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <BookOpen className="h-4 w-4 mr-1" />}
            Put them on the ledger
          </Button>
        </div>
      )}
    </div>
  )
}
