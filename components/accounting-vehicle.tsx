'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

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
  const { group, setGroup } = useVehicle()
  const [vehicles, setVehicles] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/accounting/vehicles').then(r => (r.ok ? r.json() : [])).then(v => setVehicles(Array.isArray(v) ? v : []))
  }, [])

  // Default to the first vehicle once loaded if none is selected.
  useEffect(() => {
    if (!group && vehicles.length > 0) setGroup(vehicles[0])
  }, [vehicles, group, setGroup])

  if (vehicles.length === 0) return null
  const current = group ?? vehicles[0]

  return (
    <div className="flex items-center gap-2 mb-4 text-sm">
      <span className="text-muted-foreground">Vehicle</span>
      {vehicles.length === 1 ? (
        <span className="font-medium">{current}</span>
      ) : (
        <select value={current} onChange={e => setGroup(e.target.value)} className="border rounded px-2 py-1 text-sm bg-transparent">
          {vehicles.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )}
    </div>
  )
}
