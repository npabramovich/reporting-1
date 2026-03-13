'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronRight, Check, AlertTriangle, X, ExternalLink, Clock, Loader2, Link as LinkIcon } from 'lucide-react'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { PortfolioNotesProvider, PortfolioNotesButton, PortfolioNotesPanel } from '@/components/portfolio-notes'
import { evaluateAll, type ComplianceProfile, type Applicability } from '@/lib/compliance/applicability'
import { ComplianceNav, type ComplianceTab } from './compliance-nav'

interface ComplianceItem {
  id: string
  category: string
  name: string
  short_name: string
  description: string
  frequency: string
  deadline_description: string
  deadline_month: number | null
  deadline_day: number | null
  applicability_text: string
  filing_system: string
  filing_portal_url: string | null
  regulation_url: string
  complexity: string
  notes: string | null
  alert: string | null
  sort_order: number
  scope: 'firm' | 'vehicle'
}

interface FundSetting {
  compliance_item_id: string
  portfolio_group: string
  applies: string | null
  dismissed: boolean
  dismissed_reason: string | null
  notes: string | null
}

interface Deadline {
  id: string
  compliance_item_id: string
  year: number
  due_date: string | null
  status: string
}

interface ComplianceLink {
  id: string
  compliance_item_id: string | null
  title: string
  description: string | null
  url: string
}

// Intake questions
const QUESTIONS = [
  {
    key: 'registration_status',
    question: 'How is your firm registered with the SEC?',
    explainer: 'Most VC firms are ERAs under the Dodd-Frank Act — they file limited sections of Form ADV but aren\'t fully registered. If your firm advises only qualifying VC funds and has filed Form ADV checking the \'exempt reporting adviser\' box, you\'re an ERA.',
    options: [
      { value: 'ria', label: 'SEC-Registered Investment Adviser (RIA)' },
      { value: 'era', label: 'Exempt Reporting Adviser (ERA)' },
      { value: 'not_registered', label: 'Not registered / Venture Capital Fund Adviser exemption only' },
      { value: 'unsure', label: 'I\'m not sure' },
    ],
  },
  {
    key: 'aum_range',
    question: 'What is your firm\'s approximate regulatory assets under management (AUM)?',
    explainer: 'Regulatory AUM is calculated per the Form ADV instructions and may differ from your fund\'s NAV.',
    options: [
      { value: 'under_25m', label: 'Under $25 million' },
      { value: '25m_100m', label: '$25M – $100M' },
      { value: '100m_150m', label: '$100M – $150M' },
      { value: '150m_500m', label: '$150M – $500M' },
      { value: '500m_1.5b', label: '$500M – $1.5B' },
      { value: 'over_1.5b', label: 'Over $1.5B' },
      { value: 'unsure', label: 'I\'m not sure' },
    ],
  },
  {
    key: 'fund_structure',
    question: 'How is your fund structured?',
    explainer: 'Most VC funds are limited partnerships, which file Form 1065 and issue K-1s to partners.',
    options: [
      { value: 'lp', label: 'Limited Partnership' },
      { value: 'llc_partnership', label: 'LLC taxed as partnership' },
      { value: 'llc_corp', label: 'LLC taxed as corporation' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    key: 'fundraising_status',
    question: 'What is your fund\'s current fundraising status?',
    explainer: 'This determines whether Form D amendments and Blue Sky renewal filings are needed.',
    options: [
      { value: 'actively_raising', label: 'Actively raising capital' },
      { value: 'closed_recent', label: 'Closed within the last 12 months' },
      { value: 'closed_over_12m', label: 'Closed more than 12 months ago' },
      { value: 'evergreen', label: 'Evergreen / continuous offering' },
    ],
  },
  {
    key: 'reg_d_exemption',
    question: 'Did your fund raise capital under Regulation D (Rule 506)?',
    explainer: 'Almost all VC funds raise under Reg D. If your fund has a PPM and subscription agreements, you\'re almost certainly using Reg D.',
    options: [
      { value: '506b', label: 'Yes — Rule 506(b) (no general solicitation)' },
      { value: '506c', label: 'Yes — Rule 506(c) (general solicitation permitted)' },
      { value: 'no', label: 'No / not applicable' },
      { value: 'unsure', label: 'I\'m not sure' },
    ],
  },
  {
    key: 'investor_state_count',
    question: 'In how many U.S. states do your fund investors reside?',
    explainer: 'Each state where you have investors may require a Blue Sky notice filing.',
    options: [
      { value: 'single_state', label: 'Just one state' },
      { value: '2_to_5', label: '2–5 states' },
      { value: '6_to_15', label: '6–15 states' },
      { value: '16_plus', label: '16 or more states' },
      { value: 'unsure', label: 'I\'m not sure' },
    ],
  },
  {
    key: 'california_nexus',
    question: 'Does your firm have any connection to California?',
    explainer: 'California\'s diversity reporting law (SB 54 / FIPVCC) has broad \'nexus\' triggers. Even firms headquartered outside CA may be covered.',
    multi: true,
    options: [
      { value: 'hq_ca', label: 'Headquartered or have an office in CA' },
      { value: 'investors_ca', label: 'Have investors based in CA' },
      { value: 'investments_ca', label: 'Made investments in CA-based companies' },
      { value: 'fundraising_ca', label: 'Raised capital from CA-based sources' },
      { value: 'none', label: 'No California connection' },
    ],
  },
  {
    key: 'public_equity',
    question: 'Do any of your funds hold publicly traded equity securities?',
    explainer: 'Most VC funds hold only private company equity, which means 13F, 13G, 13H, and N-PX don\'t apply.',
    options: [
      { value: 'yes_over_100m', label: 'Yes — over $100M in public equities' },
      { value: 'yes_under_100m', label: 'Yes — under $100M' },
      { value: 'yes_5pct_single', label: 'Yes — and we hold 5%+ of a single public company' },
      { value: 'no', label: 'No — private investments only' },
      { value: 'unsure', label: 'I\'m not sure' },
    ],
  },
  {
    key: 'cftc_activity',
    question: 'Does your fund engage in any commodity, futures, or swap trading?',
    explainer: 'If your fund uses any hedging instruments, interest rate swaps, or commodity-linked investments, you may need to file an exemption with the NFA.',
    options: [
      { value: 'yes_with_exemption', label: 'Yes — and we\'ve filed a CPO exemption (e.g., §4.13(a)(3))' },
      { value: 'yes_no_exemption', label: 'Yes — but we haven\'t filed an exemption' },
      { value: 'no', label: 'No commodity/futures/swap activity' },
      { value: 'unsure', label: 'I\'m not sure' },
    ],
  },
  {
    key: 'access_person_count',
    question: 'How many people at your firm have access to nonpublic information about fund holdings or transactions?',
    explainer: 'These are your \'Access Persons\' under the Code of Ethics. They\'ll need to provide periodic personal trading and holdings disclosures.',
    options: [
      { value: '1_to_3', label: '1–3 people' },
      { value: '4_to_10', label: '4–10 people' },
      { value: '11_plus', label: '11 or more' },
    ],
  },
  {
    key: 'has_foreign_entities',
    question: 'Are any of your fund entities formed under the laws of a foreign country?',
    explainer: 'As of March 2025, FinCEN exempted all U.S.-formed entities from BOI reporting. Only foreign-formed entities registered to do business in the U.S. still need to file.',
    options: [
      { value: 'yes', label: 'Yes — we have offshore/foreign fund entities registered in the U.S.' },
      { value: 'no', label: 'No — all entities are U.S.-formed' },
    ],
  },
] as const

type View = ComplianceTab
type StatusFilter = 'active' | 'dismissed' | 'all'

const STATUS_COLORS: Record<Applicability | 'monitor', { bg: string; text: string; icon: typeof Check }> = {
  applies: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', icon: Check },
  not_applicable: { bg: 'bg-muted', text: 'text-muted-foreground', icon: X },
  needs_review: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', icon: AlertTriangle },
  monitor: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', icon: Clock },
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  'SEC Filings':           { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400' },
  'Securities Offerings':  { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400' },
  'Tax Filings':           { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400' },
  'Internal Compliance':   { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400' },
  'Fund Reporting':        { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-400' },
  'State Compliance':      { bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-700 dark:text-rose-400' },
  'CFTC':                  { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-400' },
  'AML / FinCEN':          { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400' },
}
const DEFAULT_CATEGORY_COLORS = { bg: 'bg-muted', text: 'text-muted-foreground' }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

type CalendarEntry = { item: ComplianceItem; group?: string }

function entryKey(e: CalendarEntry) {
  return e.group ? `${e.item.id}::${e.group}` : e.item.id
}

export default function CompliancePage() {
  const searchParams = useSearchParams()
  const initialView = (['calendar', 'items', 'setup'].includes(searchParams.get('view') ?? '') ? searchParams.get('view') as View : 'calendar')
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ComplianceItem[]>([])
  const [profile, setProfile] = useState<ComplianceProfile | null>(null)
  const [fundSettings, setFundSettings] = useState<FundSetting[]>([])
  const [portfolioGroups, setPortfolioGroups] = useState<string[]>([])
  const [closeMonths, setCloseMonths] = useState<Record<string, number[]>>({})
  const [view, setView] = useState<View>(initialView)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [links, setLinks] = useState<ComplianceLink[]>([])

  // Intake state
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})

  useEffect(() => {
    Promise.all([
      fetch('/api/compliance').then(r => r.json()),
      fetch('/api/compliance/links').then(r => r.json()),
    ])
      .then(([d, linksData]) => {
        setItems(d.items ?? [])
        setFundSettings(d.settings ?? [])
        setPortfolioGroups(d.portfolioGroups ?? [])
        setCloseMonths(d.closeMonths ?? {})
        setLinks(Array.isArray(linksData) ? linksData : [])
        if (d.profile) {
          setProfile(d.profile)
          // Pre-fill answers from existing profile
          const a: Record<string, string | string[]> = {}
          for (const q of QUESTIONS) {
            const val = d.profile[q.key]
            if (val != null) a[q.key] = val
          }
          setAnswers(a)
          // Only override view if no query param was provided
          if (!searchParams.get('view')) setView('calendar')
        } else {
          setView('setup')
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Compute applicability from profile
  const applicability = useMemo(() => {
    if (!profile) return {}
    return evaluateAll(profile)
  }, [profile])

  // Get setting for an item (optionally scoped to a portfolio group)
  const getSetting = useCallback((itemId: string, group?: string): FundSetting | undefined => {
    const pg = group ?? ''
    return fundSettings.find(s => s.compliance_item_id === itemId && (s.portfolio_group ?? '') === pg)
  }, [fundSettings])

  // Get effective status for an item (optionally scoped to a portfolio group)
  const getStatus = useCallback((itemId: string, group?: string): Applicability => {
    const setting = getSetting(itemId, group)
    if (setting?.dismissed) return 'not_applicable'
    if (setting?.applies === 'yes') return 'applies'
    if (setting?.applies === 'no') return 'not_applicable'
    return applicability[itemId]?.result ?? 'needs_review'
  }, [getSetting, applicability])

  // Count answered questions
  const answeredCount = Object.keys(answers).filter(k => {
    const val = answers[k]
    if (Array.isArray(val)) return val.length > 0
    return val != null && val !== ''
  }).length

  // Submit intake
  async function handleSubmitIntake() {
    setSaving(true)
    try {
      const profileData: Record<string, unknown> = {}
      for (const q of QUESTIONS) {
        profileData[q.key] = answers[q.key] ?? null
      }

      const res = await fetch('/api/compliance/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData),
      })
      if (!res.ok) throw new Error('Failed to save profile')
      const savedProfile = await res.json()
      setProfile(savedProfile)

      // Evaluate and bulk-set applicability
      const results = evaluateAll(savedProfile as ComplianceProfile)
      const settings = Object.entries(results).map(([itemId, { result, reason }]) => ({
        compliance_item_id: itemId,
        applies: result === 'applies' ? 'yes' : result === 'not_applicable' ? 'no' : 'unsure',
        dismissed: result === 'not_applicable',
        dismissed_reason: result === 'not_applicable' ? reason : undefined,
      }))

      const settingsRes = await fetch('/api/compliance/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (settingsRes.ok) {
        const savedSettings = await settingsRes.json()
        setFundSettings(savedSettings)
      }

      setView('calendar')
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  // Toggle dismiss/restore (optionally scoped to a portfolio group)
  async function handleToggleDismiss(itemId: string, dismiss: boolean, reason?: string, group?: string) {
    const pg = group ?? ''
    const res = await fetch('/api/compliance/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compliance_item_id: itemId,
        portfolio_group: pg,
        dismissed: dismiss,
        dismissed_reason: reason,
        applies: dismiss ? 'no' : 'unsure',
      }),
    })
    if (res.ok) {
      const updated = await res.json()
      setFundSettings(prev => {
        const others = prev.filter(s => !(s.compliance_item_id === itemId && (s.portfolio_group ?? '') === pg))
        return [...others, updated]
      })
    }
  }

  // Calendar items grouped by month
  const calendarData = useMemo(() => {
    const months: Record<number, CalendarEntry[]> = {}
    for (let m = 1; m <= 12; m++) months[m] = []
    function addToMonths(entry: CalendarEntry, monthList: number[]) {
      for (const m of monthList) months[m].push(entry)
    }

    const QUARTERLY_MONTHS: Record<string, number[]> = {
      'valuations-soi': [3, 6, 9, 12],
      'partnership-expenses': [3, 6, 9, 12],
      'quarterly-financial-reporting': [3, 5, 8, 11],
    }
    const DEFAULT_QUARTERLY = [1, 4, 7, 10]
    const QUARTER_LABELS: Record<number, string> = { 1: 'Q1', 2: 'Q1', 3: 'Q1', 4: 'Q2', 5: 'Q2', 6: 'Q2', 7: 'Q3', 8: 'Q3', 9: 'Q3', 10: 'Q4', 11: 'Q4', 12: 'Q4' }

    function placeItem(item: ComplianceItem, group?: string) {
      if (item.deadline_month) {
        const status = getStatus(item.id, group)
        if (statusFilter === 'active' && status === 'not_applicable') return
        if (statusFilter === 'dismissed' && status !== 'not_applicable') return
        months[item.deadline_month].push({ item, group })
      } else if (item.frequency === 'Quarterly') {
        // Each quarter gets its own entry so it can be dismissed independently
        const qMonths = QUARTERLY_MONTHS[item.id] ?? DEFAULT_QUARTERLY
        for (const m of qMonths) {
          const qLabel = QUARTER_LABELS[m]
          const qGroup = group ? `${group}::${qLabel}` : qLabel
          const status = getStatus(item.id, qGroup)
          if (statusFilter === 'active' && status === 'not_applicable') continue
          if (statusFilter === 'dismissed' && status !== 'not_applicable') continue
          months[m].push({ item, group: qGroup })
        }
      } else {
        // Event-driven items (Form D, Blue Sky) — only show for funds
        // with a current-year vintage (new fund/SPV this year)
      }
    }

    // Portfolio groups that had closes (commitment entries) this year
    const groupsWithCloses = Object.keys(closeMonths).filter(pg => closeMonths[pg].length > 0)

    for (const item of items) {
      if (item.frequency === 'Event-driven') {
        // Place only in months where a close (commitment entry) occurred
        for (const pg of groupsWithCloses) {
          const status = getStatus(item.id, pg)
          if (statusFilter === 'active' && status === 'not_applicable') continue
          if (statusFilter === 'dismissed' && status !== 'not_applicable') continue
          addToMonths({ item, group: pg }, closeMonths[pg])
        }
      } else if (item.scope === 'vehicle') {
        for (const pg of portfolioGroups) {
          if (item.frequency === 'Quarterly') {
            placeItem(item, pg)
          } else {
            const status = getStatus(item.id, pg)
            if (statusFilter === 'active' && status === 'not_applicable') continue
            if (statusFilter === 'dismissed' && status !== 'not_applicable') continue
            placeItem(item, pg)
          }
        }
      } else {
        if (item.frequency === 'Quarterly') {
          placeItem(item)
        } else {
          const status = getStatus(item.id)
          if (statusFilter === 'active' && status === 'not_applicable') continue
          if (statusFilter === 'dismissed' && status !== 'not_applicable') continue
          placeItem(item)
        }
      }
    }
    return { months }
  }, [items, getStatus, statusFilter, portfolioGroups, closeMonths])


  if (loading) {
    return (
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <PortfolioNotesProvider pageContext="compliance">
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <div className="mb-6 space-y-1">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Compliance</h1>
          <div className="flex items-center gap-2">
            <PortfolioNotesButton />
            <AnalystToggleButton />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Track regulatory filings and compliance deadlines</p>
        {profile && (
          <div className="flex items-center justify-between flex-wrap gap-2 pt-2">
            <ComplianceNav active={view} onSelect={(tab) => setView(tab)} />
            {(view === 'calendar' || view === 'items') && (
              <div className="flex items-center rounded-md border text-xs">
                {(['active', 'dismissed', 'all'] as const).map((f, i, arr) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`px-3 py-1 capitalize transition-colors ${
                      i === 0 ? 'rounded-l-md' : i === arr.length - 1 ? 'rounded-r-md' : ''
                    } ${
                      statusFilter === f
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-5xl w-full">
          {view === 'setup' && (
            <IntakeQuestionnaire
              answers={answers}
              setAnswers={setAnswers}
              answeredCount={answeredCount}
              totalCount={QUESTIONS.length}
              onSubmit={handleSubmitIntake}
              saving={saving}
              isEdit={!!profile}
            />
          )}

          {view === 'calendar' && (
            <CalendarView
              calendarData={calendarData}
              items={items}
              getStatus={getStatus}
              applicability={applicability}
              getSetting={getSetting}
              expandedItem={expandedItem}
              setExpandedItem={setExpandedItem}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              onToggleDismiss={handleToggleDismiss}

              links={links}
            />
          )}

          {view === 'items' && (
            <ItemsView
              items={items}
              getStatus={getStatus}
              applicability={applicability}
              getSetting={getSetting}
              expandedItem={expandedItem}
              setExpandedItem={setExpandedItem}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              onToggleDismiss={handleToggleDismiss}

              links={links}
            />
          )}
        </div>
        <PortfolioNotesPanel />
        <AnalystPanel />
      </div>
    </div>
    </PortfolioNotesProvider>
  )
}

// --- Intake Questionnaire ---
function IntakeQuestionnaire({
  answers, setAnswers, answeredCount, totalCount, onSubmit, saving, isEdit,
}: {
  answers: Record<string, string | string[]>
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string | string[]>>>
  answeredCount: number
  totalCount: number
  onSubmit: () => void
  saving: boolean
  isEdit: boolean
}) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-medium mb-1">{isEdit ? 'Update Fund Profile' : 'Fund Profile Setup'}</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Answer these questions to determine which compliance obligations apply to your fund.
          Your answers auto-determine applicability — you can override any result later.
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="bg-foreground h-full rounded-full transition-all"
              style={{ width: `${(answeredCount / totalCount) * 100}%` }}
            />
          </div>
          <span>{answeredCount} of {totalCount} answered</span>
        </div>
      </div>

      <div className="space-y-6">
        {QUESTIONS.map((q, idx) => {
          const currentVal = answers[q.key]
          return (
            <div key={q.key} className="rounded-lg border p-4">
              <p className="font-medium text-sm mb-1">
                <span className="text-muted-foreground mr-2">{idx + 1}.</span>
                {q.question}
              </p>
              <p className="text-xs text-muted-foreground mb-3">{q.explainer}</p>
              {'multi' in q && q.multi ? (
                <div className="space-y-1.5">
                  {q.options.map(opt => {
                    const selected = Array.isArray(currentVal) && currentVal.includes(opt.value)
                    const isNone = opt.value === 'none'
                    return (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setAnswers(prev => {
                            const arr = Array.isArray(prev[q.key]) ? [...(prev[q.key] as string[])] : []
                            if (isNone) return { ...prev, [q.key]: ['none'] }
                            const filtered = arr.filter(v => v !== 'none')
                            if (filtered.includes(opt.value)) {
                              return { ...prev, [q.key]: filtered.filter(v => v !== opt.value) }
                            }
                            return { ...prev, [q.key]: [...filtered, opt.value] }
                          })
                        }}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${
                          selected
                            ? 'border-foreground bg-accent font-medium'
                            : 'border-border hover:bg-accent/50'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {q.options.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setAnswers(prev => ({ ...prev, [q.key]: opt.value }))}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm border transition-colors ${
                        currentVal === opt.value
                          ? 'border-foreground bg-accent font-medium'
                          : 'border-border hover:bg-accent/50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={onSubmit} disabled={saving || answeredCount === 0}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {isEdit ? 'Update & Re-evaluate' : 'Save & Evaluate'}
        </Button>
        <span className="text-xs text-muted-foreground">
          {answeredCount < totalCount ? `${totalCount - answeredCount} unanswered questions will be marked for review` : 'All questions answered'}
        </span>
      </div>
    </div>
  )
}

// --- Calendar View ---
function CalendarView({
  calendarData, items, getStatus, applicability, getSetting, expandedItem, setExpandedItem,
  statusFilter, setStatusFilter, onToggleDismiss, links,
}: {
  calendarData: { months: Record<number, CalendarEntry[]> }
  items: ComplianceItem[]
  getStatus: (id: string, group?: string) => Applicability
  applicability: Record<string, { result: Applicability; reason: string }>
  getSetting: (id: string, group?: string) => FundSetting | undefined
  expandedItem: string | null
  setExpandedItem: (id: string | null) => void
  statusFilter: StatusFilter
  setStatusFilter: (v: StatusFilter) => void
  onToggleDismiss: (id: string, dismiss: boolean, reason?: string, group?: string) => void
  links: ComplianceLink[]
}) {
  const now = new Date()
  const currentMonth = now.getMonth() + 1
  // Track which entry is expanded (item id + optional group)
  const [expandedEntry, setExpandedEntry] = useState<{ itemId: string; group?: string } | null>(null)
  // Months that have entries
  const activeMonths = Array.from({ length: 12 }, (_, i) => i + 1)
    .filter(month => (calendarData.months[month] ?? []).length > 0)

  return (
    <div>
      {/* Header */}
      <div className="mb-3">
        <h2 className="text-sm font-medium">{now.getFullYear()} Compliance Calendar</h2>
      </div>

      {/* Two-column on desktop, single-column on mobile */}
      <div className="flex flex-col lg:flex-row gap-5 mb-6">
        {/* Month boxes column */}
        <div className="w-full lg:w-80 lg:shrink-0 space-y-3">
          {activeMonths.map(month => {
            const entries = calendarData.months[month] ?? []
            const isPast = month < currentMonth
            const isCurrent = month === currentMonth
            return (
              <div
                key={month}
                className={`rounded-lg border p-3 ${isPast ? 'opacity-60' : ''}`}
              >
                <p className={`text-base font-semibold mb-2 ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {MONTHS[month - 1]}
                </p>
                <div className="space-y-1">
                  {entries.map(entry => {
                    const { item, group } = entry
                    const status = getStatus(item.id, group)
                    const colors = status === 'not_applicable'
                      ? { bg: 'bg-muted', text: 'text-muted-foreground' }
                      : (CATEGORY_COLORS[item.category] ?? DEFAULT_CATEGORY_COLORS)
                    const ek = entryKey(entry)
                    const isExpanded = expandedEntry?.itemId === item.id && expandedEntry?.group === group
                    return (
                      <div key={ek}>
                        <button
                          onClick={() => setExpandedEntry(isExpanded ? null : { itemId: item.id, group })}
                          className={`w-full text-left px-2 py-1 rounded text-xs ${
                            isExpanded ? 'ring-1 ring-foreground' : ''
                          } ${colors.bg} ${colors.text} hover:opacity-80 transition-opacity`}
                        >
                          {item.short_name}
                          {group && <span className="ml-1 opacity-70">· {group}</span>}
                          {item.deadline_day && !group && <span className="ml-1 opacity-70">({item.deadline_month}/{item.deadline_day})</span>}
                        </button>
                        {/* Inline detail on mobile */}
                        {isExpanded && (
                          <div className="mt-2 mb-1 lg:hidden">
                            <ItemDetail
                              item={items.find(i => i.id === item.id)!}
                              status={getStatus(item.id, group)}
                              reason={applicability[item.id]?.reason}
                              setting={getSetting(item.id, group)}
                              group={group}
                              onClose={() => setExpandedEntry(null)}
                              onToggleDismiss={onToggleDismiss}
                              links={links.filter(l => l.compliance_item_id === item.id)}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

        </div>

        {/* Detail panel — sticky on the right, desktop only */}
        <div className="hidden lg:block flex-1 min-w-0">
          {expandedEntry ? (
            <div className="sticky top-8">
              <ItemDetail
                item={items.find(i => i.id === expandedEntry.itemId)!}
                status={getStatus(expandedEntry.itemId, expandedEntry.group)}
                reason={applicability[expandedEntry.itemId]?.reason}
                setting={getSetting(expandedEntry.itemId, expandedEntry.group)}
                group={expandedEntry.group}
                onClose={() => setExpandedEntry(null)}
                onToggleDismiss={onToggleDismiss}
                links={links.filter(l => l.compliance_item_id === expandedEntry.itemId)}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Click an item to view details
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

// --- Items List View ---
function ItemsView({
  items, getStatus, applicability, getSetting, expandedItem, setExpandedItem,
  statusFilter, setStatusFilter, onToggleDismiss, links,
}: {
  items: ComplianceItem[]
  getStatus: (id: string, group?: string) => Applicability
  applicability: Record<string, { result: Applicability; reason: string }>
  getSetting: (id: string, group?: string) => FundSetting | undefined
  expandedItem: string | null
  setExpandedItem: (id: string | null) => void
  statusFilter: StatusFilter
  setStatusFilter: (v: StatusFilter) => void
  onToggleDismiss: (id: string, dismiss: boolean, reason?: string, group?: string) => void
  links: ComplianceLink[]
}) {
  // Group items by category
  const CATEGORY_ORDER = ['SEC Filings', 'Securities Offerings', 'Tax Filings', 'Fund Reporting', 'Internal Compliance', 'State Compliance', 'CFTC', 'AML / FinCEN']

  const categoryGroups = useMemo(() => {
    const groups: Record<string, ComplianceItem[]> = {}
    for (const item of items) {
      const status = getStatus(item.id)
      if (statusFilter === 'active' && status === 'not_applicable') continue
      if (statusFilter === 'dismissed' && status !== 'not_applicable') continue
      if (!groups[item.category]) groups[item.category] = []
      groups[item.category].push(item)
    }
    return groups
  }, [items, getStatus, statusFilter])

  const orderedCategories = CATEGORY_ORDER.filter(c => categoryGroups[c]?.length > 0)

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-sm font-medium">All Compliance Items</h2>
      </div>

      {orderedCategories.map(category => {
        const catColors = CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLORS
        return (
          <div key={category} className="mb-6">
            <h3 className={`text-xs font-medium mb-2 ${catColors.text}`}>{category} ({categoryGroups[category].length})</h3>
            <div className="space-y-1">
              {categoryGroups[category].map(item => {
                const status = getStatus(item.id)
                const isDismissed = status === 'not_applicable'
                const colors = isDismissed ? { bg: 'bg-muted', text: 'text-muted-foreground' } : catColors
                const isExpanded = expandedItem === item.id
                return (
                  <div key={item.id}>
                    <button
                      onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm flex items-center justify-between transition-colors ${
                        isExpanded ? 'bg-accent border-foreground/20' : 'hover:bg-accent/50'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${colors.bg}`} />
                        <span className={`font-medium ${isDismissed ? 'text-muted-foreground line-through' : ''}`}>{item.short_name}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{item.deadline_description}</span>
                        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      </span>
                    </button>
                    {isExpanded && (
                      <ItemDetail
                        item={item}
                        status={status}
                        reason={applicability[item.id]?.reason}
                        setting={getSetting(item.id)}
                        onClose={() => setExpandedItem(null)}
                        onToggleDismiss={onToggleDismiss}
                        links={links.filter(l => l.compliance_item_id === item.id)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// --- Item Detail Panel ---
function ItemDetail({
  item, status, reason, setting, group, onClose, onToggleDismiss, links,
}: {
  item: ComplianceItem
  status: Applicability
  reason?: string
  setting?: FundSetting
  group?: string
  onClose: () => void
  onToggleDismiss: (id: string, dismiss: boolean, reason?: string, group?: string) => void
  links?: ComplianceLink[]
}) {
  if (!item) return null

  return (
    <div className="rounded-lg border bg-card p-4 mt-2 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-sm">{item.name}{group && <span className="text-muted-foreground font-normal"> · {group}</span>}</h3>
          <p className="text-sm text-muted-foreground">{item.category} · {item.frequency} · {item.complexity} complexity</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-sm text-muted-foreground mb-3">{item.description}</p>

      {reason && (
        <div className={`text-sm px-2.5 py-1.5 rounded mb-3 ${STATUS_COLORS[status].bg} ${STATUS_COLORS[status].text}`}>
          {reason}
        </div>
      )}

      {item.alert && (
        <div className="text-sm px-2.5 py-1.5 rounded mb-3 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
          {item.alert}
        </div>
      )}

      {item.notes && (
        <p className="text-sm text-muted-foreground mb-3">{item.notes}</p>
      )}

      {item.id === 'ca-diversity' && (
        <p className="text-sm text-muted-foreground mb-3">
          <a href="https://www.fipvcc.com/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">FIPVCC</a> provides standardized questionnaires for collecting demographic data from founders.
        </p>
      )}

      <div className="text-sm text-muted-foreground mb-3 space-y-0.5">
        <p><strong>Deadline:</strong> {item.deadline_description}</p>
        <p><strong>Filing system:</strong> {item.filing_system}</p>
        <p><strong>Applies to:</strong> {item.applicability_text}</p>
      </div>

      {links && links.length > 0 && (
        <div className="mb-3 space-y-1">
          {links.map(link => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <LinkIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="underline underline-offset-2">{link.title}</span>
              {link.description && <span className="opacity-70">— {link.description}</span>}
            </a>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {item.regulation_url && (
          <a
            href={item.regulation_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />View Regulation
          </a>
        )}
        {item.filing_portal_url && (
          <a
            href={item.filing_portal_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />Filing Portal
          </a>
        )}
        <span className="flex-1" />
        {status !== 'not_applicable' ? (
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground"
            onClick={() => onToggleDismiss(item.id, true, 'Manually dismissed', group)}
          >
            Dismiss
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="text-muted-foreground"
            onClick={() => onToggleDismiss(item.id, false, undefined, group)}
          >
            Restore
          </Button>
        )}
      </div>
    </div>
  )
}
