import { cache } from 'react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/types/database'
import { withSessionUser } from './session-user'

/**
 * Async as of Next 16: `cookies()` returns a Promise and the synchronous shim that Next 15 kept for
 * the transition is gone. Every caller awaits this. The codemod offered `UnsafeUnwrappedCookies`
 * here instead — a cast that compiles and then throws at runtime in 16 — which is why this is done
 * by hand.
 */
export async function createClient() {
  const cookieStore = await cookies()

  // auth.getUser() on this client verifies the session token locally: see lib/supabase/session-user.ts.
  return withSessionUser(createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — cookie writes are a no-op.
            // Middleware handles session refresh in that case.
          }
        },
      },
    }
  ))
}

/**
 * The signed-in user, resolved ONCE per request.
 *
 * The session token is verified locally against the project's signing keys
 * (lib/supabase/session-user.ts), not by a round trip to the Auth server, and React's
 * `cache` dedupes it within a request so the layout and the page share one result. This is
 * per-REQUEST memoisation, not a cache with a TTL: nothing is remembered between requests.
 *
 * proxy.ts makes its own check first; it runs before this one exists, and it is what
 * refreshes the session cookie.
 */
export const getUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})
