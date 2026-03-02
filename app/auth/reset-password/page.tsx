'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Building2 } from 'lucide-react'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  async function resetPassword() {
    setError(null)

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
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
            <CardTitle className="text-lg">Set new password</CardTitle>
            <CardDescription>
              {success ? 'Your password has been updated.' : 'Choose a new password for your account.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {success ? (
              <div className="space-y-4">
                <Alert>
                  <AlertDescription>
                    Your password has been updated successfully. You can now sign in with your new password.
                  </AlertDescription>
                </Alert>
                <Button className="w-full" onClick={() => router.push('/')}>
                  Continue
                </Button>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && resetPassword()}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && resetPassword()}
                    autoComplete="new-password"
                  />
                </div>

                <Button className="w-full" onClick={resetPassword} disabled={loading}>
                  {loading ? 'Updating…' : 'Update password'}
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
