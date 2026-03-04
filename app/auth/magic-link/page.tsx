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

export default function MagicLinkPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const supabase = createClient()

  async function handleSend() {
    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
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
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center mx-auto mb-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Portfolio Reporting</h1>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Sign in with magic link</CardTitle>
            <CardDescription>
              {sent
                ? 'Check your email for a sign-in link.'
                : "We'll email you a link that signs you in instantly — no password needed."}
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
                    A sign-in link has been sent to <strong>{email}</strong>. Click the link in the email to sign in.
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
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                <Button className="w-full" onClick={handleSend} disabled={loading}>
                  {loading ? 'Sending…' : 'Send magic link'}
                </Button>
              </>
            )}

            <p className="text-center text-sm text-muted-foreground">
              <Link href="/auth" className="text-primary underline underline-offset-4 hover:text-primary/80">
                Sign in with password
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
