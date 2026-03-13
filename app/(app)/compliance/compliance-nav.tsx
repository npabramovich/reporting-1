'use client'

import Link from 'next/link'

const tabs = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'items', label: 'All Items' },
  { key: 'setup', label: 'Fund Profile' },
  { key: 'links', label: 'Filing Links' },
] as const

export type ComplianceTab = (typeof tabs)[number]['key']

export function ComplianceNav({
  active,
  onSelect,
}: {
  active: ComplianceTab
  onSelect?: (tab: ComplianceTab) => void
}) {
  return (
    <div className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
      {tabs.map(tab => {
        const isActive = active === tab.key
        const className = `inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all ${
          isActive
            ? 'bg-background text-foreground shadow'
            : 'hover:text-foreground'
        }`

        // Filing Links is always a route
        if (tab.key === 'links') {
          return (
            <Link key={tab.key} href="/compliance/links" className={className}>
              {tab.label}
            </Link>
          )
        }

        // If we have an onSelect handler (on the compliance page), use buttons
        if (onSelect) {
          return (
            <button
              key={tab.key}
              onClick={() => onSelect(tab.key)}
              className={className}
            >
              {tab.label}
            </button>
          )
        }

        // Otherwise (on sub-pages like links), link back to compliance with view param
        return (
          <Link
            key={tab.key}
            href={`/compliance?view=${tab.key}`}
            className={className}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
