import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verify a Mailgun webhook signature using HMAC-SHA256.
 * @see https://documentation.mailgun.com/docs/mailgun/user-manual/get-started/#securing-webhooks
 */
export function verifyMailgunWebhook(
  signingKey: string,
  timestamp: string,
  token: string,
  signature: string
): boolean {
  // Reject stale timestamps (> 5 minutes) to prevent replay attacks
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10))
  if (isNaN(age) || age > 300) return false

  const data = timestamp + token
  const digest = createHmac('sha256', signingKey).update(data).digest('hex')

  // Use timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
  } catch {
    return false
  }
}
