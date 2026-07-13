'use client'

import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Connect an Affinity API key.
 *
 * This is PER USER, not per fund — Affinity issues one key per person and scopes
 * it to what that person can see. That's a feature, not a limitation: the
 * assistant and the sync can never surface CRM records the user couldn't open
 * themselves. The notes they import still land in the shared data room.
 */

interface Status {
  connected: boolean
  affinity_user_email: string | null
  affinity_user_name: string | null
  last_verified_at: string | null
  last_error: string | null
}

export function AffinityConnect() {
  const [status, setStatus] = useState<Status | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/settings/affinity')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false, affinity_user_email: null, affinity_user_name: null, last_verified_at: null, last_error: null }))
  }, [])

  async function connect() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/affinity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Could not connect')
        return
      }
      setStatus({
        connected: true,
        affinity_user_email: body.affinity_user_email,
        affinity_user_name: body.affinity_user_name,
        last_verified_at: new Date().toISOString(),
        last_error: null,
      })
      setApiKey('')
    } catch {
      setError('Could not reach Affinity.')
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    setSaving(true)
    await fetch('/api/settings/affinity', { method: 'DELETE' })
    setStatus({ connected: false, affinity_user_email: null, affinity_user_name: null, last_verified_at: null, last_error: null })
    setSaving(false)
  }

  if (!status) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Affinity CRM</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Connect your Affinity account to pull company notes and attached files into diligence
          data rooms, and to let the diligence assistant answer questions about your relationship
          history.
        </p>
        <p className="text-xs text-muted-foreground">
          Affinity issues one key per person, scoped to what you can see. Yours is stored encrypted
          and is never shown again after you save it. Notes you import go into the shared data room
          for the whole fund.
        </p>

        {status.connected ? (
          <>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>
                Connected as {status.affinity_user_name ?? status.affinity_user_email ?? 'your Affinity account'}
                {status.affinity_user_name && status.affinity_user_email && (
                  <span className="text-muted-foreground"> ({status.affinity_user_email})</span>
                )}
              </span>
            </div>

            {status.last_error && (
              <div className="flex items-start gap-2 text-sm text-amber-600">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{status.last_error} Re-enter your key below to reconnect.</span>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="Replace with a new key…"
                autoComplete="off"
              />
              <Button onClick={connect} disabled={saving || !apiKey.trim()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update'}
              </Button>
              <Button variant="outline" onClick={disconnect} disabled={saving}>
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <div className="flex gap-2">
            <Input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && apiKey.trim()) connect() }}
              placeholder="Affinity API key"
              autoComplete="off"
            />
            <Button onClick={connect} disabled={saving || !apiKey.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <p className="text-xs text-muted-foreground">
          Generate a key in Affinity under Settings → API. Requires the “Generate an API key”
          permission from your Affinity admin.
        </p>
      </CardContent>
    </Card>
  )
}
