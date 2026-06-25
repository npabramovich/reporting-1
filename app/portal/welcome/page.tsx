'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Building2 } from 'lucide-react'

/**
 * LP onboarding. The invite email carries a 6-digit code; the LP enters their
 * email + that code, sets a password, and we bind + activate their LP account.
 * Afterwards they sign in like any other user at /auth (email + password) and
 * middleware routes them to the portal.
 */
export default function PortalWelcomePage() {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  const supabase = createClient()

  async function complete() {
    setError(null)
    if (!email.trim() || !code || code.length !== 6) {
      setError('Enter your email and the 6-digit code from your invitation.')
      return
    }
    if (!password || password.length < 8) {
      setError('Choose a password of at least 8 characters.')
      return
    }
    setBusy(true)
    const normEmail = email.trim().toLowerCase()

    // The code may be an invite token (first time) or a resent email OTP.
    let verify = await supabase.auth.verifyOtp({ type: 'invite', email: normEmail, token: code })
    if (verify.error) verify = await supabase.auth.verifyOtp({ type: 'email', email: normEmail, token: code })
    if (verify.error) { setError(verify.error.message); setBusy(false); return }

    const { error: pwErr } = await supabase.auth.updateUser({ password })
    if (pwErr) { setError(pwErr.message); setBusy(false); return }

    const res = await fetch('/api/portal/activate', { method: 'POST' })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not activate your portal access.')
      setBusy(false)
      return
    }
    window.location.href = '/portal/snapshots'
  }

  async function resend() {
    setError(null)
    if (!email.trim()) { setError('Enter your email first.'); return }
    await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false } })
    setResent(true)
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center mx-auto mb-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Investor Portal</h1>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Set up your access</CardTitle>
            <CardDescription>
              Enter the 6-digit code from your invitation email and choose a password.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="you@example.com" value={email}
                onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus />
            </div>

            <div className="space-y-2">
              <Label htmlFor="code">Invitation code</Label>
              <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="text-center text-lg tracking-[0.5em]" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Choose a password</Label>
              <Input id="password" type="password" placeholder="At least 8 characters" value={password}
                onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
            </div>

            <Button className="w-full" onClick={complete} disabled={busy}>
              {busy ? 'Setting up…' : 'Complete setup'}
            </Button>

            <button type="button" onClick={resend} className="w-full text-center text-sm text-muted-foreground hover:text-foreground">
              {resent ? 'New code sent — check your email' : "Didn't get a code? Resend"}
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
