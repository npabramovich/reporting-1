// The accounting section's navigation — the single source of truth for both the
// sidebar (labels only) and the /accounting hub page (icons + descriptions).
// Add a route here and it appears in both; there is nowhere else to add it.

import {
  Landmark, Users, PhoneCall, GitCompareArrows, Bot, ScrollText,
  FileCode, Upload, Lock, Layers, FileText, SlidersHorizontal,
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
    href: '/accounting/bank',
    label: 'Bank transactions',
    icon: Landmark,
    desc: 'Import a transaction feed (CSV, Ramp, QuickBooks), auto-draft entries, and reconcile ledger cash against the bank.',
  },
  {
    href: '/accounting/capital-accounts',
    label: 'Capital accounts',
    icon: Users,
    desc: 'Per-LP roll-forward: beginning → contributions → distributions → fees → gains → ending.',
  },
  {
    href: '/accounting/capital-calls',
    label: 'Capital calls',
    icon: PhoneCall,
    desc: 'Issue calls against commitments (fund-wide pro-rata or per-LP) and track called vs funded vs outstanding.',
  },
  {
    href: '/accounting/reconciliation',
    label: 'Reconciliation',
    icon: GitCompareArrows,
    desc: "Shadow-reconcile the ledger's capital accounts against the existing admin statement, per LP.",
  },
  {
    href: '/accounting/assistant',
    label: 'Assistant',
    icon: Bot,
    desc: 'Ask AI to review your books, explain the statements, or draft entries — from a question or an uploaded document. Applied as drafts you approve; nothing posts automatically.',
  },
  {
    href: '/accounting/journal',
    label: 'Journal',
    icon: ScrollText,
    desc: 'Double-entry journal entries and postings — the book of record everything derives from.',
  },
  {
    href: '/accounting/ledger-text',
    label: 'Plain text',
    icon: FileCode,
    desc: 'Author entries as plain-text double-entry and post them back — the DB is just the store.',
  },
  {
    href: '/accounting/opening-balances',
    label: 'Opening balances',
    icon: Upload,
    desc: "Take over at a cutover date: enter each LP's capital balance from their latest admin statement as one posted opening entry.",
  },
  {
    href: '/accounting/allocation-terms',
    label: 'Allocation terms',
    icon: SlidersHorizontal,
    desc: 'How the close splits P&L across partners: allocation basis, commitments over time, and which partners bear the management fee, expenses, and carry.',
  },
  {
    href: '/accounting/periods',
    label: 'Periods & close',
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
