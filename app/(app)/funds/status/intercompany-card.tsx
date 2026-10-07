'use client'

import { useCallback, useEffect, useState } from 'react'
import { useVehicle } from '@/components/accounting-vehicle'
import { IntercompanyPanel } from '@/components/accounting/intercompany-panel'

interface Feed { balances: any[]; charges: any[] }

// The MANAGEMENT COMPANY's side of its intercompany register: what it has billed each fund and
// what is still outstanding. There is deliberately no fund-side counterpart — a charge is already
// a pair of postings, one per entity, so the fund sees it in its own journal and statements.
export function MancoIntercompanyCard({ onChanged }: { onChanged: () => void }) {
  const { group, vehicleId } = useVehicle()
  const [feed, setFeed] = useState<Feed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!group || !vehicleId) return
    try {
      const res = await fetch(`/api/manco/intercompany?group=${encodeURIComponent(group)}`)
      if (!res.ok) throw new Error('Could not load intercompany balances. Try refreshing the page.')
      const data = await res.json()
      setFeed({
        balances: data.balances,
        charges: data.charges.map((c: {
          id: string; kind: string; charge_date: string; amount: number | string;
          memo: string | null; status: string; settled_date: string | null;
          from_vehicle_id: string; to_vehicle_id: string;
        }) => ({
          id: c.id, kind: c.kind, chargeDate: c.charge_date, amount: Number(c.amount),
          memo: c.memo, status: c.status, settledDate: c.settled_date,
          direction: c.to_vehicle_id === vehicleId ? 'receivable' : 'payable',
          counterpartyVehicleId: c.to_vehicle_id === vehicleId ? c.from_vehicle_id : c.to_vehicle_id,
        })),
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load intercompany balances')
    }
  }, [group, vehicleId])
  useEffect(() => { void load() }, [load])
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!feed || !group || !vehicleId) return <p className="text-sm text-muted-foreground">Loading intercompany balances…</p>
  return <IntercompanyPanel
    vehicle={group} vehicleId={vehicleId} balances={feed.balances} charges={feed.charges}
    onChanged={() => { void load(); onChanged() }}
  />
}
