'use client'

import { useCallback, useEffect, useState } from 'react'
import { useVehicle } from '@/components/accounting-vehicle'
import { useCanRead } from '@/components/access-context'
import { IntercompanyPanel } from '@/components/accounting/intercompany-panel'

// A fund's (or GP entity's) charges with the firm's management company, from the fund's side.
//
// The data is the management company's — its routes, its receivables, its register — and this
// card asks for it on the fund's behalf and filters to the rows where the fund is the
// counterparty. That keeps ONE set of postings and one place that knows how a charge is booked
// (lib/accounting/intercompany.ts); the fund page only changes whose words the rows are in.
//
// Gated as the routes are: /api/manco/* needs the management_company grant, so a caller without
// it sees nothing here rather than a card full of 403s. A firm with no management company sees
// nothing either.

interface Manco { id: string; name: string }
interface Feed { balances: any[]; charges: any[] }

export function IntercompanyCard() {
  const { vehicleId } = useVehicle()
  const canSee = useCanRead('management_company')
  const [mancos, setMancos] = useState<Manco[]>([])
  const [feeds, setFeeds] = useState<Record<string, Feed>>({})

  const load = useCallback(async () => {
    if (!canSee || !vehicleId) return
    const r = await fetch('/api/manco/vehicles').catch(() => null)
    if (!r || !r.ok) { setMancos([]); return }
    const rows = await r.json().catch(() => [])
    const list: Manco[] = (Array.isArray(rows) ? rows : []).filter((m: any) => m?.id && m?.name).map((m: any) => ({ id: m.id, name: m.name }))
    setMancos(list)
    const entries = await Promise.all(list.map(async m => {
      const fr = await fetch(`/api/manco/intercompany?group=${encodeURIComponent(m.name)}`).catch(() => null)
      const d = fr && fr.ok ? await fr.json().catch(() => null) : null
      return [m.id, { balances: d?.balances ?? [], charges: d?.charges ?? [] }] as const
    }))
    setFeeds(Object.fromEntries(entries))
  }, [canSee, vehicleId])
  useEffect(() => { load() }, [load])

  if (!canSee || !vehicleId || mancos.length === 0) return null

  return (
    <>
      {mancos.map(m => (
        <IntercompanyPanel
          key={m.id}
          vehicle={m.name}
          vehicleId={m.id}
          mancoName={m.name}
          perspective="counterparty"
          onlyCounterpartyId={vehicleId}
          balances={feeds[m.id]?.balances ?? []}
          charges={feeds[m.id]?.charges ?? []}
          onChanged={load}
        />
      ))}
    </>
  )
}

/** The operating entity sees its own register, with all counterparties. */
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
