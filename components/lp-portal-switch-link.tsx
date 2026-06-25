'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'

/**
 * Shown in the GP app header only for dual users (a GP who is also an active
 * LP), giving them a way into their LP portal. LP-only users never see the GP
 * app — middleware routes them straight to /portal.
 */
export function LpPortalSwitchLink() {
  const [isLp, setIsLp] = useState(false)

  useEffect(() => {
    fetch('/api/portal/me')
      .then(r => (r.ok ? r.json() : { isLp: false }))
      .then(b => setIsLp(!!b.isLp))
      .catch(() => {})
  }, [])

  if (!isLp) return null
  return (
    <Link
      href="/portal/snapshots"
      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap"
      title="Switch to your LP portal"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">LP Portal</span>
    </Link>
  )
}
