'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useFundSeg, useLedgerFetch, useVehicle } from '@/components/accounting-vehicle'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

interface SetupState { name: string; chartSeeded: boolean; accountCount: number }

/** Uses the existing management-company setup endpoint, including its access checks. */
export function MancoAccountingSetup({ alwaysShow, onSetup }: { alwaysShow: boolean; onSetup?: () => void }) {
  const { group } = useVehicle()
  const fundSeg = useFundSeg()
  const lf = useLedgerFetch()
  const [state, setState] = useState<SetupState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/manco/vehicles')
      .then(async res => {
        if (!res.ok) throw new Error('Could not load accounting setup')
        const vehicles: SetupState[] = await res.json()
        const selected = vehicles.find(v => v.name === group)
        if (!selected) throw new Error('Could not find this entity')
        if (!cancelled) setState(selected)
      })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [group])

  async function setUp() {
    setBusy(true)
    setError(null)
    try {
      const res = await lf('/api/manco/setup', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not set up accounting')
      setState(current => current && ({
        ...current, chartSeeded: true, accountCount: current.accountCount + (data.seeded ?? 0),
      }))
      onSetup?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set up accounting')
    } finally {
      setBusy(false)
    }
  }

  if (state?.chartSeeded && !alwaysShow) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{state?.chartSeeded ? 'Accounting is set up' : 'Set up accounting'}</CardTitle>
        <CardDescription>
          {state?.chartSeeded
            ? 'Import your existing books or start recording transactions.'
            : 'Create the accounts for cash, income, expenses, and owner equity.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!state && !error && <p className="text-sm text-muted-foreground">Loading accounting setup…</p>}
        {state && !state.chartSeeded && (
          <Button size="sm" onClick={setUp} disabled={busy}>
            {busy && <Loader2 data-icon="inline-start" className="animate-spin" />}
            Set up accounting
          </Button>
        )}
        {state?.chartSeeded && fundSeg && (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm"><Link href={`/funds/${fundSeg}/migrate`}>Import from QuickBooks</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={`/funds/${fundSeg}/journal`}>Open journal</Link></Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
