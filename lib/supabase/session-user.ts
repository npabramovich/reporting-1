import type { SupabaseClient, User, UserResponse } from '@supabase/supabase-js'

/**
 * The signed-in user, from the session's access token verified LOCALLY, without asking the Auth
 * server.
 *
 * `auth.getUser()` is a network round trip to Supabase Auth on every call, and every request paid
 * it at least twice: once in proxy.ts and again in the route or layout. `auth.getClaims()` checks
 * the token's signature against the project's published signing keys (fetched once and cached in
 * memory by auth-js), so it costs nothing per request. A project still on the legacy shared
 * (HS256) secret can't be verified locally, and auth-js falls back to `getUser()` for it, so that
 * case is exactly as before.
 *
 * The trade: a session that was signed out, or a user that was deleted, stays valid here until its
 * access token expires (an hour by default) instead of failing on the next request. Membership,
 * role and grants are still read live from the database on every request, so removing someone from
 * the fund takes effect at once either way. Routes where that hour matters (issuing OAuth tokens,
 * activating a portal account) use `authServerUser` instead.
 *
 * Only the fields the access token carries are set. Nothing in the server code reads more than
 * `id` and `email` from a session user; anything that needs the full record (email confirmation,
 * identities) must use `authServerUser`.
 */
export async function sessionUser(auth: SupabaseClient['auth']): Promise<UserResponse> {
  const { data, error } = await auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub) {
    return { data: { user: null }, error: error ?? null } as UserResponse
  }
  const user = {
    id: claims.sub,
    aud: Array.isArray(claims.aud) ? claims.aud[0] : claims.aud,
    role: claims.role,
    email: claims.email,
    phone: claims.phone,
    is_anonymous: claims.is_anonymous,
    app_metadata: claims.app_metadata ?? {},
    user_metadata: claims.user_metadata ?? {},
    // Not in the token. Typed as required on User; nothing on the server reads it.
    created_at: '',
  } as User
  return { data: { user }, error: null }
}

/**
 * The full user record, asked of the Auth server (a network round trip). For the few places where
 * a revoked session must fail at once, or that read fields the access token doesn't carry.
 */
const AUTH_SERVER_GET_USER = Symbol.for('portfolio.authServerGetUser')

export async function authServerUser(supabase: { auth: SupabaseClient['auth'] }): Promise<UserResponse> {
  const original = (supabase.auth as any)[AUTH_SERVER_GET_USER] as SupabaseClient['auth']['getUser'] | undefined
  return original ? original() : supabase.auth.getUser()
}

/**
 * Points a server client's `auth.getUser()` at `sessionUser`, so the several hundred routes that
 * call it get the local check without each being edited. A call that passes a token (`getUser(jwt)`)
 * still goes to the Auth server, and `authServerUser` reaches the original method.
 */
export function withSessionUser<C extends { auth: SupabaseClient['auth'] }>(client: C): C {
  const auth = client.auth as any
  if (auth[AUTH_SERVER_GET_USER]) return client
  const original = auth.getUser.bind(auth)
  auth[AUTH_SERVER_GET_USER] = original
  auth.getUser = (jwt?: string) => (jwt ? original(jwt) : sessionUser(client.auth))
  return client
}
