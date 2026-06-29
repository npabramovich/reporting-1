'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/portal/snapshots', label: 'Reports' },
  { href: '/portal/letters', label: 'Letters' },
  { href: '/portal/documents', label: 'Documents' },
  { href: '/portal/authorized-users', label: 'Authorized users' },
  { href: '/portal/contact', label: 'Contact' },
]

/**
 * Portal header + tab nav, wrapping the portal pages. Onboarding
 * (/portal/welcome) is a standalone setup screen, so it renders the page bare —
 * no header, no tabs.
 */
export function PortalChrome({ fundName, logoUrl, children }: { fundName: string; logoUrl: string | null; children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/portal/welcome') {
    return <>{children}</>
  }

  return (
    <>
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4">
          <div className="py-3 flex items-center justify-between gap-3">
            <Link href="/portal/snapshots" className="flex items-center gap-2 min-w-0 font-semibold text-sm tracking-tight">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-6 w-auto max-w-[120px] object-contain shrink-0" />
              ) : null}
              <span className="truncate">{fundName}</span>
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="text-xs text-muted-foreground hover:text-foreground shrink-0">
                Sign out
              </button>
            </form>
          </div>
          <nav className="flex items-center gap-4 -mb-px overflow-x-auto">
            {TABS.map(t => (
              <Link key={t.href} href={t.href} className="text-sm text-muted-foreground hover:text-foreground py-2 border-b-2 border-transparent whitespace-nowrap">
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </>
  )
}
