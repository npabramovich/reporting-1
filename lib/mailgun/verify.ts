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
  const data = timestamp + token
  const digest = createHmac('sha256', signingKey).update(data).digest('hex')

  // Use timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
  } catch {
    return false
  }
}
