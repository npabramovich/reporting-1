'use client'

import { useState, useEffect } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Sun, Moon } from 'lucide-react'
import { Button } from '@/components/ui/button'

const CYCLE = ['system', 'light', 'dark'] as const
const ICONS = { system: Monitor, light: Sun, dark: Moon }
const LABELS = { system: 'System', light: 'Light', dark: 'Dark' }

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  const current = (CYCLE.includes(theme as typeof CYCLE[number]) ? theme : 'system') as typeof CYCLE[number]
  const Icon = ICONS[current]

  function cycle() {
    const idx = CYCLE.indexOf(current)
    setTheme(CYCLE[(idx + 1) % CYCLE.length])
  }

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" disabled className="h-8 w-8 text-muted-foreground">
        <Monitor className="h-3.5 w-3.5" />
        <span className="sr-only">System</span>
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      className="h-8 w-8 text-muted-foreground hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="sr-only">{LABELS[current]}</span>
    </Button>
  )
}
