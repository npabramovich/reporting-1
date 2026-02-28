'use client'

import { useState } from 'react'
import { Menu, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { AppSidebar } from '@/components/app-sidebar'

interface AppHeaderProps {
  fundName: string
  userEmail: string
  reviewBadge: number
}

export function AppHeader({ fundName, userEmail, reviewBadge }: AppHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <header className="flex items-center justify-between px-4 py-3 shrink-0">
      {/* Left: hamburger + fund name */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="md:hidden p-1.5"
          onClick={() => setDrawerOpen(true)}
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
        <span className="font-semibold text-xl tracking-tight truncate">{fundName}</span>
      </div>

      {/* Right: user + sign out */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground truncate hidden sm:block max-w-[200px]">
          {userEmail}
        </span>
        <form action="/api/auth/logout" method="POST">
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </form>
      </div>

      {/* Mobile drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="p-0 pt-12 w-64">
          <AppSidebar
            reviewBadge={reviewBadge}
            onNavigate={() => setDrawerOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </header>
  )
}
