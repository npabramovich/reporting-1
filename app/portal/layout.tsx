import Link from 'next/link'

export const metadata = { title: 'Investor Portal' }

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-card">
        <div className="max-w-5xl mx-auto px-4">
          <div className="py-3 flex items-center justify-between">
            <Link href="/portal/snapshots" className="font-semibold text-sm tracking-tight">
              Investor Portal
            </Link>
            <form action="/api/auth/logout" method="POST">
              <button type="submit" className="text-xs text-muted-foreground hover:text-foreground">
                Sign out
              </button>
            </form>
          </div>
          <nav className="flex items-center gap-4 -mb-px">
            <Link href="/portal/snapshots" className="text-sm text-muted-foreground hover:text-foreground py-2 border-b-2 border-transparent">
              Reports
            </Link>
            <Link href="/portal/letters" className="text-sm text-muted-foreground hover:text-foreground py-2 border-b-2 border-transparent">
              Letters
            </Link>
            <Link href="/portal/authorized-users" className="text-sm text-muted-foreground hover:text-foreground py-2 border-b-2 border-transparent">
              Authorized users
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  )
}
