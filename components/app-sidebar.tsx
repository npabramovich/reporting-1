'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  badge?: boolean
}

interface AppSidebarProps {
  navItems: NavItem[]
  reviewBadge: number
  onNavigate?: () => void
}

export function AppSidebar({ navItems, reviewBadge, onNavigate }: AppSidebarProps) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 p-2 space-y-0.5">
      {navItems.map(({ href, label, icon: Icon, badge }) => {
        const isActive = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              isActive
                ? 'bg-accent text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{label}</span>
            {badge && reviewBadge > 0 && (
              <span className="rounded-full bg-amber-500 text-white text-[10px] font-semibold leading-none px-1.5 py-0.5 min-w-[18px] text-center">
                {reviewBadge > 99 ? '99+' : reviewBadge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
