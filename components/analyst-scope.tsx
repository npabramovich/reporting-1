'use client'

// Tells the app-wide Analyst which section it's sitting in, so its context is scoped to that
// domain's data. Renders nothing.
//
// These only report WHERE the user is. Whether they actually GET a domain's data is decided
// server-side in /api/analyst against their role and the fund's feature settings — see
// plans/plan-unified-analyst.md. Mounting one of these grants nothing.

import { useEffect } from 'react'
import { useVehicle } from '@/components/accounting-vehicle'
import { useAnalystContext, type AnalystDomain } from '@/components/analyst-context'

/** For the Accounting section: scopes the Analyst to the vehicle the section is showing. */
export function AnalystVehicleSync() {
  const { group } = useVehicle()
  const { setVehicle } = useAnalystContext()

  useEffect(() => { setVehicle(group) }, [group, setVehicle])
  // Leaving the section drops the scope. Separate from the effect above so a vehicle switch
  // doesn't null-then-set and reset the thread twice.
  useEffect(() => () => setVehicle(null), [setVehicle])

  return null
}

/** For sections whose scope is just "this domain": <AnalystDomainScope domain="lps" />. */
export function AnalystDomainScope({ domain }: { domain: AnalystDomain }) {
  const { setDomain } = useAnalystContext()

  useEffect(() => { setDomain(domain) }, [domain, setDomain])
  useEffect(() => () => setDomain(null), [setDomain])

  return null
}
