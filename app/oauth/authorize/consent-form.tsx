'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * The approve/deny screen. Deliberately blunt about what is being handed over:
 * this grant lets an agent read the fund's whole portfolio and ledger, and — for
 * an admin — post journal entries and close periods. A vague "authorize app?"
 * prompt would be doing the user a disservice.
 */

interface Props {
  clientName: string
  fundName: string
  willWrite: boolean
  /** They asked for write but aren't an admin, so we're granting read. Say so. */
  downgraded: boolean
  params: {
    client_id: string
    redirect_uri: string
    code_challenge: string
    scope: string
    state: string | null
    resource: string | null
  }
}

export function ConsentForm({ clientName, fundName, willWrite, downgraded, params }: Props) {
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'deny')
    setError(null)
    try {
      const res = await fetch('/api/oauth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, approve }),
      })
      const body = await res.json()
      if (!res.ok || !body.redirect) {
        setError(body.error ?? 'Could not complete authorization.')
        setBusy(null)
        return
      }
      // Hand control back to the app that sent us here.
      window.location.href = body.redirect
    } catch {
      setError('Could not reach the server.')
      setBusy(null)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-lg border bg-card p-6 space-y-5">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Connect {clientName}?</h1>
          <p className="text-sm text-muted-foreground">
            It is asking to act on <span className="font-medium text-foreground">{fundName}</span> as you.
          </p>
        </div>

        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <p className="text-xs font-medium">This will let it:</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc ml-4">
            <li>Read your portfolio, companies, investments, LP positions and fund performance.</li>
            <li>Read the ledger — chart of accounts, journal entries, capital accounts and financial statements.</li>
            {willWrite && (
              <li className="text-amber-600">
                <strong>Make changes:</strong> record investments, post journal entries, run allocations,
                import bank transactions, and close accounting periods.
              </li>
            )}
          </ul>
          {!willWrite && (
            <p className="text-xs text-muted-foreground">
              Read-only. It cannot change anything.
            </p>
          )}
        </div>

        {downgraded && (
          <p className="text-xs text-amber-600">
            It asked for write access, but only fund admins can grant that — so it will get read-only.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          It can only ever see {fundName}, never another fund. You can revoke this at any time in
          Settings, and access ends automatically if you leave the fund.
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button onClick={() => decide(true)} disabled={busy !== null} className="flex-1">
            {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Allow'}
          </Button>
          <Button variant="outline" onClick={() => decide(false)} disabled={busy !== null} className="flex-1">
            {busy === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Deny'}
          </Button>
        </div>
      </div>
    </div>
  )
}
