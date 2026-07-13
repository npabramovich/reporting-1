// The accounting section's navigation — the single source of truth for both the
// sidebar (labels only) and the /accounting hub page (icons + descriptions).
// Add a route here and it appears in both; there is nowhere else to add it.

import {
  Landmark, Users, ScrollText, Gauge,
  Lock, Layers, FileText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface AccountingSection {
  href: string
  label: string
  icon: LucideIcon
  desc: string
}

export const ACCOUNTING_SECTIONS: AccountingSection[] = [
  {
    href: '/accounting/status',
    label: 'Admin',
    icon: Gauge,
    desc: 'Where the books stand — onboarding, how far the close has got, and what needs attention — plus the AI assistant and reconciliation against an admin statement.',
  },
  {
    href: '/accounting/bank',
    label: 'Bank transactions',
    icon: Landmark,
    desc: 'Import a transaction feed (CSV, Ramp, QuickBooks), auto-draft entries, and reconcile ledger cash against the bank.',
  },
  {
    href: '/accounting/capital-accounts',
    label: 'Capital accounts',
    icon: Users,
    desc: "Per-partner roll-forward and commitments in one place: beginning → contributions → fees → gains → ending, with called and unfunded alongside. Issue capital calls and publish LP statements from here.",
  },
  {
    href: '/accounting/journal',
    label: 'Journal',
    icon: ScrollText,
    desc: 'The book of record, as plain-text double-entry. Create entries, and click any entry to view, unpost, or edit it.',
  },
  // NOTE: /accounting/opening-balances is deliberately NOT listed. It only applies to
  // the "cutover" onboarding path, and is linked from the setup card there. On a
  // full-history vehicle, opening balances are derived from the reconstructed ledger —
  // entering them would double-count contributed capital.
  // NOTE: /accounting/allocation-terms is deliberately NOT listed. It's configuration
  // you set once per vehicle (basis, commitments, who bears which category), not a
  // place you work — so it's linked from Admin, next to the health check that tells
  // you when it's wrong.
  {
    href: '/accounting/periods',
    label: 'Period close',
    icon: Lock,
    desc: "Close a period: allocate its income and expenses to each partner's capital account, snapshot the ledger, and lock the books. Reopen to reverse.",
  },
  {
    href: '/accounting/schedule-of-investments',
    label: 'Schedule of investments',
    icon: Layers,
    desc: 'Each investment at cost and fair value, with its share of net assets — derived from the ledger.',
  },
  {
    href: '/accounting/statements',
    label: 'Financial statements',
    icon: FileText,
    desc: 'Balance sheet, income statement, and statement of changes in partners’ capital.',
  },
]
