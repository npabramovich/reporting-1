'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Signs out the demo (viewer) user when the browser tab is closed
 * or when they navigate to an external page. This prevents the demo
 * session from persisting and interfering with real user logins.
 */
export function DemoSessionGuard() {
  useEffect(() => {
    const supabase = createClient()

    const handleUnload = () => {
      // Use sendBeacon to reliably sign out even during tab close.
      // Fall back to calling signOut directly.
      navigator.sendBeacon('/api/auth/logout')
    }

    window.addEventListener('beforeunload', handleUnload)
    return () => window.removeEventListener('beforeunload', handleUnload)
  }, [])

  return null
}
