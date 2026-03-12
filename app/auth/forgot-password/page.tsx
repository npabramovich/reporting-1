'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Building2 } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const supabase = createClient()

  async function handleReset() {
    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    })
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="h-14 w-14 rounded-xl overflow-hidden shadow-sm border mx-auto mb-3">
            <img src="/logo.png" alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Portfolio Reporting</h1>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Reset your password</CardTitle>
            <CardDescription>
              {sent
                ? 'Check your email for a password reset link.'
                : "Enter your email and we'll send you a link to reset your password."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {sent ? (
              <div className="space-y-4">
                <Alert>
                  <AlertDescription>
                    If an account exists for <strong>{email}</strong>, you will receive an email with a link to set a new password.
                  </AlertDescription>
                </Alert>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => { setSent(false); setEmail('') }}
                >
                  Send again
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleReset()}
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                <Button className="w-full" onClick={handleReset} disabled={loading}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </Button>
              </>
            )}

            <p className="text-center text-sm text-muted-foreground">
              <Link href="/auth" className="text-primary underline underline-offset-4 hover:text-primary/80">
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
