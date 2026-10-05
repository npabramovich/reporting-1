import { AuthBrandProvider } from '@/components/auth-brand'
import { loadAuthBrand } from '@/lib/auth-brand'

// The OAuth consent screen uses the sign-in chrome (components/auth-shell.tsx), so it shows
// the same logo and text as /auth.
export default async function Layout({ children }: { children: React.ReactNode }) {
  return <AuthBrandProvider brand={await loadAuthBrand()}>{children}</AuthBrandProvider>
}
