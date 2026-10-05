import { AuthWordmark } from '@/components/auth-brand'

/**
 * The chrome for every signed-out, full-page screen: sign-in, sign-up, password reset,
 * MFA, and the OAuth consent screen.
 *
 * It exists because that chrome was previously copy-pasted — byte for byte — into six auth
 * pages, while the OAuth pages had none of it at all and consequently looked like a
 * different product bolted on at the moment a user is being asked to hand an agent the
 * keys to their fund. That is the worst possible place to look unfamiliar.
 *
 * The mark links home. What it shows (a logo, and optionally a line of text) is the fund's
 * choice in Settings → Fund; see components/auth-brand.tsx.
 */
export function AuthShell({
  children,
  above,
  footer,
  wide,
}: {
  children: React.ReactNode
  /** Rendered ABOVE the wordmark — the sign-up page's "try the demo" banner leads with this. */
  above?: React.ReactNode
  /** Rendered under the card, in fine print. */
  footer?: React.ReactNode
  /** The consent screen carries more text than a login form and needs the extra room. */
  wide?: boolean
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className={`w-full space-y-6 ${wide ? 'max-w-lg' : 'max-w-md'}`}>
        {above}
        <AuthWordmark />
        {children}
        {footer}
      </div>
    </div>
  )
}
