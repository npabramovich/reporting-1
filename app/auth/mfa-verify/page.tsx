'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Building2, Loader2 } from 'lucide-react'

export default function MfaVerifyPage() {
  return (
    <Suspense>
      <MfaVerifyForm />
    </Suspense>
  )
}

function MfaVerifyForm() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [branding, setBranding] = useState<{ fundName: string; fundLogo: string }>({ fundName: '', fundLogo: '' })
  const inputRef = useRef<HTMLInputElement>(null)

  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Where to go after successful MFA verification
  const nextPath = searchParams.get('next') || '/'

  useEffect(() => {
    fetch('/api/auth/branding')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setBranding(data) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    async function checkAal() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/auth')
        return
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (!aal || aal.currentLevel === 'aal2' || aal.nextLevel !== 'aal2') {
        router.replace('/')
        return
      }
      setChecking(false)
    }
    checkAal()
  }, [router, supabase])

  async function verify() {
    setError(null)
    if (code.length !== 6) {
      setError('Enter a 6-digit code.')
      return
    }
    setLoading(true)
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totp = factors?.totp?.find(f => f.status === 'verified')
      if (!totp) {
        setError('No verified TOTP factor found.')
        setLoading(false)
        return
      }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: totp.id })
      if (challengeError) {
        setError(challengeError.message)
        setLoading(false)
        return
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.id,
        code,
      })
      if (verifyError) {
        setError(verifyError.message)
        setCode('')
        inputRef.current?.focus()
      } else {
        // Prevent open redirect — only allow relative paths
        const dest = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/'
        router.push(dest)
        router.refresh()
      }
    } catch {
      setError('Verification failed. Please try again.')
      setCode('')
      inputRef.current?.focus()
    }
    setLoading(false)
  }

  async function signOutAndRedirect() {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          {branding.fundLogo ? (
            <img src={branding.fundLogo} alt="" className="h-10 w-10 rounded object-contain mx-auto mb-2" />
          ) : (
            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center mx-auto mb-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <h1 className="text-lg font-semibold tracking-tight">{branding.fundName || 'Portfolio Reporting'}</h1>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Two-factor authentication</CardTitle>
            <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="mfa-code">Verification code</Label>
              <Input
                ref={inputRef}
                id="mfa-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && verify()}
                autoFocus
                autoComplete="one-time-code"
                placeholder="000000"
                className="text-center font-mono text-lg tracking-widest"
              />
            </div>

            <Button className="w-full" onClick={verify} disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={signOutAndRedirect}
                className="text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Sign in with a different account
              </button>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
