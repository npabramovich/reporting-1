'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ShieldCheck, ChevronRight, Check, AlertTriangle, X, ExternalLink, Clock, FileText, Eye, EyeOff, Loader2 } from 'lucide-react'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { evaluateAll, type ComplianceProfile, type Applicability } from '@/lib/compliance/applicability'

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
}

interface FundSetting {
  compliance_item_id: string
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

type View = 'calendar' | 'items' | 'setup'

const STATUS_COLORS: Record<Applicability | 'monitor', { bg: string; text: string; icon: typeof Check }> = {
  applies: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', icon: Check },
  not_applicable: { bg: 'bg-muted', text: 'text-muted-foreground', icon: X },
  needs_review: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-400', icon: AlertTriangle },
  monitor: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', icon: Clock },
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function CompliancePage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<ComplianceItem[]>([])
  const [profile, setProfile] = useState<ComplianceProfile | null>(null)
  const [fundSettings, setFundSettings] = useState<FundSetting[]>([])
  const [view, setView] = useState<View>('calendar')
  const [showDismissed, setShowDismissed] = useState(false)
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Intake state
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})

  useEffect(() => {
    fetch('/api/compliance')
      .then(r => r.json())
      .then(d => {
        setItems(d.items ?? [])
        setFundSettings(d.settings ?? [])
        if (d.profile) {
          setProfile(d.profile)
          // Pre-fill answers from existing profile
          const a: Record<string, string | string[]> = {}
          for (const q of QUESTIONS) {
            const val = d.profile[q.key]
            if (val != null) a[q.key] = val
          }
          setAnswers(a)
          setView('calendar')
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

  // Get setting for an item
  const getSetting = useCallback((itemId: string): FundSetting | undefined => {
    return fundSettings.find(s => s.compliance_item_id === itemId)
  }, [fundSettings])

  // Get effective status for an item
  const getStatus = useCallback((itemId: string): Applicability => {
    const setting = getSetting(itemId)
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

  // Toggle dismiss/restore
  async function handleToggleDismiss(itemId: string, dismiss: boolean, reason?: string) {
    const res = await fetch('/api/compliance/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        compliance_item_id: itemId,
        dismissed: dismiss,
        dismissed_reason: reason,
        applies: dismiss ? 'no' : 'unsure',
      }),
    })
    if (res.ok) {
      const updated = await res.json()
      setFundSettings(prev => {
        const others = prev.filter(s => s.compliance_item_id !== itemId)
        return [...others, updated]
      })
    }
  }

  // Calendar items grouped by month
  const calendarData = useMemo(() => {
    const months: Record<number, ComplianceItem[]> = {}
    for (let m = 1; m <= 12; m++) months[m] = []
    const eventDriven: ComplianceItem[] = []

    for (const item of items) {
      const status = getStatus(item.id)
      if (status === 'not_applicable' && !showDismissed) continue

      if (item.deadline_month) {
        months[item.deadline_month].push(item)
      } else {
        eventDriven.push(item)
      }
    }
    return { months, eventDriven }
  }, [items, getStatus, showDismissed])

  // Items grouped by status
  const groupedItems = useMemo(() => {
    const groups: Record<string, ComplianceItem[]> = {
      applies: [],
      needs_review: [],
      monitor: [],
      not_applicable: [],
    }
    for (const item of items) {
      const status = getStatus(item.id)
      groups[status]?.push(item)
    }
    return groups
  }, [items, getStatus])

  if (loading) {
    return (
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-muted-foreground" />
          Compliance
        </h1>
        <div className="flex items-center gap-2">
          {profile && (
            <>
              <Button
                variant={view === 'calendar' ? 'secondary' : 'ghost'}
                size="sm"
                className="text-muted-foreground"
                onClick={() => setView('calendar')}
              >
                Calendar
              </Button>
              <Button
                variant={view === 'items' ? 'secondary' : 'ghost'}
                size="sm"
                className="text-muted-foreground"
                onClick={() => setView('items')}
              >
                All Items
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setView('setup')}
              >
                Fund Profile
              </Button>
            </>
          )}
          <AnalystToggleButton />
        </div>
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
              showDismissed={showDismissed}
              setShowDismissed={setShowDismissed}
              onToggleDismiss={handleToggleDismiss}
              groupedItems={groupedItems}
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
              showDismissed={showDismissed}
              setShowDismissed={setShowDismissed}
              onToggleDismiss={handleToggleDismiss}
              groupedItems={groupedItems}
            />
          )}
        </div>
        <AnalystPanel />
      </div>
    </div>
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
  showDismissed, setShowDismissed, onToggleDismiss, groupedItems,
}: {
  calendarData: { months: Record<number, ComplianceItem[]>; eventDriven: ComplianceItem[] }
  items: ComplianceItem[]
  getStatus: (id: string) => Applicability
  applicability: Record<string, { result: Applicability; reason: string }>
  getSetting: (id: string) => FundSetting | undefined
  expandedItem: string | null
  setExpandedItem: (id: string | null) => void
  showDismissed: boolean
  setShowDismissed: (v: boolean) => void
  onToggleDismiss: (id: string, dismiss: boolean, reason?: string) => void
  groupedItems: Record<string, ComplianceItem[]>
}) {
  const now = new Date()
  const currentMonth = now.getMonth() + 1

  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground mb-0.5">Applies</p>
            <p className="text-2xl font-semibold">{groupedItems.applies?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground mb-0.5">Needs Review</p>
            <p className="text-2xl font-semibold text-amber-600">{groupedItems.needs_review?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground mb-0.5">Monitor</p>
            <p className="text-2xl font-semibold text-blue-600">{groupedItems.monitor?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-[10px] text-muted-foreground mb-0.5">Not Applicable</p>
            <p className="text-2xl font-semibold text-muted-foreground">{groupedItems.not_applicable?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* Calendar grid */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium">2026 Compliance Calendar</h2>
        <button
          onClick={() => setShowDismissed(!showDismissed)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {showDismissed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {showDismissed ? 'Hide dismissed' : 'Show all'}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-6">
        {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
          const monthItems = calendarData.months[month] ?? []
          const isPast = month < currentMonth
          const isCurrent = month === currentMonth

          return (
            <div
              key={month}
              className={`rounded-lg border p-3 ${isCurrent ? 'border-foreground' : ''} ${isPast ? 'opacity-50' : ''}`}
            >
              <p className={`text-xs font-medium mb-2 ${isCurrent ? 'text-foreground' : 'text-muted-foreground'}`}>
                {MONTHS[month - 1]}
              </p>
              {monthItems.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">—</p>
              ) : (
                <div className="space-y-1">
                  {monthItems.map(item => {
                    const status = getStatus(item.id)
                    const colors = STATUS_COLORS[status]
                    return (
                      <button
                        key={item.id}
                        onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                        className={`w-full text-left px-2 py-1 rounded text-[11px] ${colors.bg} ${colors.text} hover:opacity-80 transition-opacity`}
                      >
                        {item.short_name}
                        {item.deadline_day && <span className="ml-1 opacity-70">({item.deadline_month}/{item.deadline_day})</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Event-driven / rolling */}
      {calendarData.eventDriven.length > 0 && (
        <div className="mb-6">
          <h3 className="text-xs font-medium text-muted-foreground mb-2">Event-Driven / Rolling Deadlines</h3>
          <div className="space-y-1">
            {calendarData.eventDriven.map(item => {
              const status = getStatus(item.id)
              const colors = STATUS_COLORS[status]
              return (
                <button
                  key={item.id}
                  onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm flex items-center justify-between ${
                    expandedItem === item.id ? 'bg-accent' : 'hover:bg-accent/50'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`inline-block w-2 h-2 rounded-full ${colors.bg.replace('bg-', 'bg-').replace('/30', '')}`} />
                    {item.short_name}
                  </span>
                  <span className="text-xs text-muted-foreground">{item.deadline_description}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Expanded item detail */}
      {expandedItem && (
        <ItemDetail
          item={items.find(i => i.id === expandedItem)!}
          status={getStatus(expandedItem)}
          reason={applicability[expandedItem]?.reason}
          setting={getSetting(expandedItem)}
          onClose={() => setExpandedItem(null)}
          onToggleDismiss={onToggleDismiss}
        />
      )}
    </div>
  )
}

// --- Items List View ---
function ItemsView({
  items, getStatus, applicability, getSetting, expandedItem, setExpandedItem,
  showDismissed, setShowDismissed, onToggleDismiss, groupedItems,
}: {
  items: ComplianceItem[]
  getStatus: (id: string) => Applicability
  applicability: Record<string, { result: Applicability; reason: string }>
  getSetting: (id: string) => FundSetting | undefined
  expandedItem: string | null
  setExpandedItem: (id: string | null) => void
  showDismissed: boolean
  setShowDismissed: (v: boolean) => void
  onToggleDismiss: (id: string, dismiss: boolean, reason?: string) => void
  groupedItems: Record<string, ComplianceItem[]>
}) {
  const sections: { key: string; label: string; items: ComplianceItem[] }[] = [
    { key: 'applies', label: `Applies to your fund (${groupedItems.applies?.length ?? 0})`, items: groupedItems.applies ?? [] },
    { key: 'needs_review', label: `Needs review (${groupedItems.needs_review?.length ?? 0})`, items: groupedItems.needs_review ?? [] },
    { key: 'monitor', label: `Monitor (${groupedItems.monitor?.length ?? 0})`, items: groupedItems.monitor ?? [] },
  ]

  if (showDismissed) {
    sections.push({ key: 'not_applicable', label: `Not applicable (${groupedItems.not_applicable?.length ?? 0})`, items: groupedItems.not_applicable ?? [] })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium">All Compliance Items</h2>
        <button
          onClick={() => setShowDismissed(!showDismissed)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {showDismissed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {showDismissed ? 'Hide dismissed' : 'Show all'}
        </button>
      </div>

      {sections.map(section => (
        <div key={section.key} className="mb-6">
          <h3 className="text-xs font-medium text-muted-foreground mb-2">{section.label}</h3>
          {section.items.length === 0 ? (
            <p className="text-xs text-muted-foreground pl-2">None</p>
          ) : (
            <div className="space-y-1">
              {section.items.map(item => {
                const status = getStatus(item.id)
                const colors = STATUS_COLORS[status]
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
                        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${colors.bg}`}>
                          {(() => { const Icon = colors.icon; return <Icon className={`h-3 w-3 ${colors.text}`} /> })()}
                        </span>
                        <span>
                          <span className="font-medium">{item.short_name}</span>
                          <span className="text-muted-foreground ml-2">{item.category}</span>
                        </span>
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
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// --- Item Detail Panel ---
function ItemDetail({
  item, status, reason, setting, onClose, onToggleDismiss,
}: {
  item: ComplianceItem
  status: Applicability
  reason?: string
  setting?: FundSetting
  onClose: () => void
  onToggleDismiss: (id: string, dismiss: boolean, reason?: string) => void
}) {
  if (!item) return null

  return (
    <div className="rounded-lg border bg-card p-4 mt-2 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-medium text-sm">{item.name}</h3>
          <p className="text-xs text-muted-foreground">{item.category} · {item.frequency} · {item.complexity} complexity</p>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-sm text-muted-foreground mb-3">{item.description}</p>

      {reason && (
        <div className={`text-xs px-2.5 py-1.5 rounded mb-3 ${STATUS_COLORS[status].bg} ${STATUS_COLORS[status].text}`}>
          {reason}
        </div>
      )}

      {item.alert && (
        <div className="text-xs px-2.5 py-1.5 rounded mb-3 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
          {item.alert}
        </div>
      )}

      {item.notes && (
        <p className="text-xs text-muted-foreground mb-3">{item.notes}</p>
      )}

      <div className="text-xs text-muted-foreground mb-3 space-y-0.5">
        <p><strong>Deadline:</strong> {item.deadline_description}</p>
        <p><strong>Filing system:</strong> {item.filing_system}</p>
        <p><strong>Applies to:</strong> {item.applicability_text}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <a
          href={item.regulation_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline"
        >
          <ExternalLink className="h-3 w-3" />View Regulation
        </a>
        {item.filing_portal_url && (
          <a
            href={item.filing_portal_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline"
          >
            <ExternalLink className="h-3 w-3" />Filing Portal
          </a>
        )}
        <span className="flex-1" />
        {status !== 'not_applicable' ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground h-7"
            onClick={() => onToggleDismiss(item.id, true, 'Manually dismissed')}
          >
            Dismiss
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground h-7"
            onClick={() => onToggleDismiss(item.id, false)}
          >
            Restore
          </Button>
        )}
      </div>
    </div>
  )
}
