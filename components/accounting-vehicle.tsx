'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { Settings2 } from 'lucide-react'

interface VehicleCtx {
  group: string | null
  setGroup: (g: string) => void
}
const VehicleContext = createContext<VehicleCtx>({ group: null, setGroup: () => {} })

/** Holds the selected vehicle (portfolio_group) for the Accounting section,
 *  persisted to localStorage so it survives navigation and reloads. */
export function VehicleProvider({ children }: { children: React.ReactNode }) {
  const [group, setGroupState] = useState<string | null>(null)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('acct_vehicle')
      if (saved) setGroupState(saved)
    } catch { /* ignore */ }
  }, [])
  const setGroup = useCallback((g: string) => {
    setGroupState(g)
    try { localStorage.setItem('acct_vehicle', g) } catch { /* ignore */ }
  }, [])
  return <VehicleContext.Provider value={{ group, setGroup }}>{children}</VehicleContext.Provider>
}

export function useVehicle() {
  return useContext(VehicleContext)
}

// The static `/funds/*` subpages. Anything else of the shape `/funds/<segment>` is the fund
// DETAIL page (`/funds/[id]`), which — like the `/funds` overview — owns its own header layout
// and drives the vehicle from its URL rather than from the selector bar.
const FUND_SUBPAGES = new Set([
  'status', 'bank', 'journal', 'periods', 'statements', 'capital-accounts',
  'schedule-of-investments', 'allocation-terms', 'opening-balances', 'lp-events',
])

/** True on `/funds/[id]` — the fund detail (lead) page. */
export function isFundDetailPath(pathname: string): boolean {
  const m = pathname.match(/^\/funds\/([^/]+)\/?$/)
  return !!m && !FUND_SUBPAGES.has(m[1])
}

/**
 * A fetch wrapper that scopes every ledger request to the selected vehicle:
 * appends `?group=` to the URL and injects `group` into JSON POST bodies.
 */
export function useLedgerFetch() {
  const { group } = useVehicle()
  return useCallback(
    (path: string, opts?: RequestInit) => {
      let url = path
      if (group) url += (path.includes('?') ? '&' : '?') + 'group=' + encodeURIComponent(group)
      let init = opts
      if (opts?.body && typeof opts.body === 'string' && group) {
        try {
          const b = JSON.parse(opts.body)
          if (b && typeof b === 'object' && b.group === undefined) init = { ...opts, body: JSON.stringify({ ...b, group }) }
        } catch { /* leave non-JSON bodies alone */ }
      }
      return fetch(url, init)
    },
    [group]
  )
}

/** Vehicle selector shown across the Accounting section. */
export function VehicleBar() {
  // The /funds landing page is the fund overview — it spans every vehicle and the selector
  // drives nothing on it, so it would just be a confusing no-op control. The subpages
  // (capital accounts, journal, statements) DO operate one vehicle at a time, so the bar
  // stays for them.
  const pathname = usePathname()
  const { group, setGroup } = useVehicle()
  const [vehicles, setVehicles] = useState<string[]>([])

  const load = useCallback(() => {
    fetch('/api/accounting/vehicles').then(r => (r.ok ? r.json() : [])).then(v => setVehicles(Array.isArray(v) ? v : []))
  }, [])
  useEffect(() => { load() }, [load])

  // Default to the first vehicle once loaded if none is selected.
  useEffect(() => {
    if (!group && vehicles.length > 0) setGroup(vehicles[0])
  }, [vehicles, group, setGroup])

  const current = group ?? (vehicles[0] ?? '')

  if (pathname === '/funds') return null

  // Creating and configuring a vehicle (name, kind, vintage, associate links) is an infrequent,
  // multi-field setup, so it lives in one place — Settings → Investment vehicles — rather than as a
  // quick-add here that only captured a name and kind. This bar just selects among what exists.
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Vehicle</span>
        {vehicles.length === 0 ? (
          <Link href="/settings" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground underline underline-offset-2">
            <Settings2 className="h-3 w-3" />Add one in Settings
          </Link>
        ) : vehicles.length === 1 ? (
          <span className="font-medium">{current}</span>
        ) : (
          <select value={current} onChange={e => setGroup(e.target.value)} className="rounded border bg-transparent px-2 py-1 text-sm">
            {vehicles.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
      </div>
    </div>
  )
}
