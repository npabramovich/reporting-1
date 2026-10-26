import { describe, it, expect, vi } from 'vitest'
import { authServerUser, sessionUser, withSessionUser } from './session-user'

function fakeAuth(claims: Record<string, unknown> | null, error: unknown = null) {
  const getUser = vi.fn(async (jwt?: string) => ({ data: { user: { id: 'from-auth-server', jwt } }, error: null }))
  const getClaims = vi.fn(async () => ({ data: claims ? { claims } : null, error }))
  return { auth: { getUser, getClaims } as any, getUser, getClaims }
}

describe('sessionUser', () => {
  it('builds the user from verified claims, without asking the Auth server', async () => {
    const f = fakeAuth({ sub: 'u1', email: 'gp@fund.example', aud: 'authenticated', role: 'authenticated', user_metadata: { full_name: 'Jane Doe' } })
    const { data: { user } } = await sessionUser(f.auth)
    expect(user).toMatchObject({ id: 'u1', email: 'gp@fund.example', aud: 'authenticated', user_metadata: { full_name: 'Jane Doe' }, app_metadata: {} })
    expect(f.getUser).not.toHaveBeenCalled()
  })

  it('is signed out when the token does not verify or there is no session', async () => {
    expect((await sessionUser(fakeAuth(null, new Error('Invalid JWT signature')).auth)).data.user).toBeNull()
    expect((await sessionUser(fakeAuth(null).auth)).data.user).toBeNull()
    expect((await sessionUser(fakeAuth({ email: 'no-subject@fund.example' }).auth)).data.user).toBeNull()
  })
})

describe('withSessionUser', () => {
  it('answers getUser() locally, and still sends getUser(jwt) and authServerUser to the Auth server', async () => {
    const f = fakeAuth({ sub: 'u1' })
    const client = withSessionUser({ auth: f.auth })

    expect((await client.auth.getUser()).data.user?.id).toBe('u1')
    expect(f.getUser).not.toHaveBeenCalled()

    expect((await client.auth.getUser('a.b.c')).data.user?.id).toBe('from-auth-server')
    expect((await authServerUser(client)).data.user?.id).toBe('from-auth-server')
    expect(f.getUser).toHaveBeenCalledTimes(2)
  })

  it('wraps a client once', async () => {
    const f = fakeAuth({ sub: 'u1' })
    const client = withSessionUser(withSessionUser({ auth: f.auth }))
    await authServerUser(client)
    expect(f.getUser).toHaveBeenCalledTimes(1)
  })
})
