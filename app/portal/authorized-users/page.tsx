'use client'

import { useEffect, useState } from 'react'
import { Loader2, Trash2, UserCheck } from 'lucide-react'

interface AuthUser {
  id: string
  lp_investor_id: string
  lp_investors: { name: string } | null
  lp_accounts: { email: string; display_name: string | null; status: string } | null
}

export default function PortalAuthorizedUsersPage() {
  const [rows, setRows] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  function load() {
    setLoading(true)
    fetch('/api/portal/authorized-users')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(b => setRows(b.authorized_users ?? []))
      .catch(() => setError('Could not load your authorized users.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function revoke(id: string) {
    setRevoking(id)
    const res = await fetch(`/api/portal/authorized-users?id=${id}`, { method: 'DELETE' })
    setRevoking(null)
    if (res.ok) setRows(prev => prev.filter(r => r.id !== id))
    else setError('Could not revoke access. Please try again.')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Authorized users</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          People your fund has granted access to your investor data. Revoke access at any time.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
          No one else has access to your account.
        </div>
      ) : (
        <div className="rounded-md border bg-card divide-y">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              <UserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm truncate">{r.lp_accounts?.email ?? '—'}</div>
                <div className="text-xs text-muted-foreground">
                  Access to {r.lp_investors?.name ?? 'your account'}
                  {r.lp_accounts?.status && r.lp_accounts.status !== 'active' && (
                    <span className="uppercase tracking-wide ml-2">{r.lp_accounts.status}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => revoke(r.id)}
                disabled={revoking === r.id}
                className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1 shrink-0"
              >
                {revoking === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
