'use client'

import { ThemeToggle } from '@/components/theme-toggle'

export function AppFooter() {
  return (
    <footer className="flex items-center justify-between border-t bg-card px-4 py-2 shrink-0">
      <ThemeToggle />
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <a
          href="https://hemrock.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Hemrock
        </a>
        <span className="text-border">|</span>
        <a
          href="https://github.com/tdavidson/reporting"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          GitHub
        </a>
      </div>
    </footer>
  )
}
