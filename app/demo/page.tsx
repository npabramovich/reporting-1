import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function DemoPage() {
  const supabase = createClient()

  // If already signed in, don't overwrite the session
  const { data: { user } } = await supabase.auth.getUser()
  if (user) redirect('/dashboard')

  // Sign in as the demo user server-side
  const email = process.env.DEMO_USER_EMAIL
  const password = process.env.DEMO_USER_PASSWORD

  if (!email || !password) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Demo is not available.</p>
      </div>
    )
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">Unable to load demo.</p>
          <a href="/auth" className="text-sm text-blue-600 underline">Go to sign in</a>
        </div>
      </div>
    )
  }

  redirect('/dashboard')
}
