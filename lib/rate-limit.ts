import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface RateLimitConfig {
  /** Unique key for the rate limit bucket (e.g., `auth:${ip}` or `ai:${userId}`) */
  key: string
  /** Maximum number of requests allowed in the window */
  limit: number
  /** Window size in seconds */
  windowSeconds: number
}

/**
 * Sliding-window rate limiter backed by Supabase.
 * Uses the rate_limit_entries table to track request counts.
 *
 * Returns null if the request is allowed, or a 429 NextResponse if rate limited.
 */
export async function rateLimit(config: RateLimitConfig): Promise<NextResponse | null> {
  const { key, limit, windowSeconds } = config

  try {
    const admin = createAdminClient()
    const now = new Date()
    const windowStart = new Date(now.getTime() - windowSeconds * 1000)

    // Clean old entries and count recent ones in a single query
    await admin
      .from('rate_limit_entries' as any)
      .delete()
      .eq('key', key)
      .lt('created_at', windowStart.toISOString())

    const { count } = await admin
      .from('rate_limit_entries' as any)
      .select('id', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', windowStart.toISOString())

    if ((count ?? 0) >= limit) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(windowSeconds),
          },
        }
      )
    }

    // Record this request
    await admin
      .from('rate_limit_entries' as any)
      .insert({ key, created_at: now.toISOString() })

    return null // Allowed
  } catch (err) {
    // If rate limiting fails (e.g., table doesn't exist yet), allow the request
    console.error('[rate-limit] Error:', err)
    return null
  }
}

/** Extract client IP from request headers. Prefer platform-specific headers that cannot be spoofed. */
export function getClientIp(req: Request): string {
  const headers = req.headers
  return (
    headers.get('x-real-ip') ||                          // Vercel (cannot be spoofed)
    headers.get('x-nf-client-connection-ip') ||          // Netlify (cannot be spoofed)
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  )
}
