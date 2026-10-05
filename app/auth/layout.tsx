import type { Metadata } from 'next'
import { AuthBrandProvider } from '@/components/auth-brand'
import { loadAuthBrand } from '@/lib/auth-brand'

export const dynamic = 'force-dynamic'
// Gated app routes bounce to /auth?next=<route>, and Google had filed seven of
// those query-string variants as "duplicate without user-selected canonical".
// A crawlable noindex drops them; blocking /auth in robots would only hide the
// noindex from the crawler.
export const metadata: Metadata = { title: 'Sign In', robots: { index: false, follow: false } }

// The sign-in logo and text the fund set in Settings → Fund, for every screen under /auth.
export default async function Layout({ children }: { children: React.ReactNode }) {
  return <AuthBrandProvider brand={await loadAuthBrand()}>{children}</AuthBrandProvider>
}
