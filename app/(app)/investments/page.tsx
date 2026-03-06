'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, ChevronUp, ChevronDown, Lock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useCurrency, formatCurrency, formatCurrencyFull } from '@/components/currency-context'
import type { CompanyStatus } from '@/lib/types/database'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'
import { PortfolioNotesProvider, PortfolioNotesButton, PortfolioNotesPanel } from '@/components/portfolio-notes'
import { useFeatureVisibility } from '@/components/feature-visibility-context'

interface CompanySummary {
  companyId: string
  companyName: string
  status: CompanyStatus
  portfolioGroup: string[]
  totalInvested: number
  totalRealized: number
  unrealizedValue: number
  fmv: number
  moic: number | null
  irr: number | null
}

interface PortfolioData {
  totalInvested: number
  totalRealized: number
  totalUnrealized: number
  totalFMV: number
  portfolioMOIC: number | null
  portfolioIRR: number | null
  companies: CompanySummary[]
}

type SortKey = 'companyName' | 'status' | 'portfolioGroup' | 'totalInvested' | 'fmv' | 'totalRealized' | 'moic' | 'irr'
type SortDir = 'asc' | 'desc'

function fmtMoic(val: number | null): string {
  if (val == null) return '-'
  return `${val.toFixed(2)}x`
}

function fmtIrr(val: number | null): string {
  if (val == null) return '-'
  return `${(val * 100).toFixed(1)}%`
}

const STATUS_COLORS: Record<CompanyStatus, string> = {
  active: 'text-green-600',
  exited: 'text-blue-600',
  'written-off': 'text-muted-foreground',
}

const TEXT_SORT_KEYS: SortKey[] = ['companyName', 'status', 'portfolioGroup']

export default function InvestmentsPage() {
  const fv = useFeatureVisibility()
  const currency = useCurrency()
  const fmt = (val: number) => formatCurrency(val, currency)
  const fmtFull = (val: number) => formatCurrencyFull(val, currency)

  const [data, setData] = useState<PortfolioData | null>(null)
  const [loading, setLoading] = useState(true)
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().split('T')[0])

  const [sortKey, setSortKey] = useState<SortKey>('totalInvested')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [statusFilter, setStatusFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`/api/portfolio/investments?asOf=${asOfDate}`)
        if (res.ok) setData(await res.json())
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [asOfDate])

  // Derive unique portfolio groups from data
  const availableGroups = useMemo(() => {
    if (!data) return []
    const groups = new Set<string>()
    for (const c of data.companies) {
      for (const g of c.portfolioGroup) groups.add(g)
    }
    return Array.from(groups).sort()
  }, [data])

  // Filter + sort
  const filtered = useMemo(() => {
    if (!data) return []
    let list = data.companies

    if (statusFilter) {
      list = list.filter(c => c.status === statusFilter)
    }
    if (groupFilter) {
      list = list.filter(c => c.portfolioGroup.includes(groupFilter))
    }

    const dir = sortDir === 'asc' ? 1 : -1

    list = [...list].sort((a, b) => {
      if (sortKey === 'companyName') return dir * a.companyName.localeCompare(b.companyName)
      if (sortKey === 'status') return dir * a.status.localeCompare(b.status)
      if (sortKey === 'portfolioGroup') return dir * (a.portfolioGroup.join(', ')).localeCompare(b.portfolioGroup.join(', '))

      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return dir * (av - bv)
    })

    return list
  }, [data, statusFilter, groupFilter, sortKey, sortDir])

  // Footer totals from filtered data
  const totals = useMemo(() => {
    let totalInvested = 0
    let totalFMV = 0
    let totalRealized = 0
    let totalUnrealized = 0
    for (const c of filtered) {
      totalInvested += c.totalInvested
      totalFMV += c.fmv
      totalRealized += c.totalRealized
      totalUnrealized += c.unrealizedValue
    }
    const moic = totalInvested > 0 ? (totalRealized + totalUnrealized) / totalInvested : null
    return { totalInvested, totalFMV, totalRealized, moic }
  }, [filtered])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(TEXT_SORT_KEYS.includes(key) ? 'asc' : 'desc')
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null
    return sortDir === 'asc'
      ? <ChevronUp className="inline h-3 w-3 ml-0.5" />
      : <ChevronDown className="inline h-3 w-3 ml-0.5" />
  }

  const heading = (
    <div className="flex items-center gap-4 mb-6">
      <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">{fv.investments === 'admin' && <Lock className="h-4 w-4 text-amber-500" />}<span className="text-[10px] font-medium text-blue-500 bg-blue-500/10 rounded px-1.5 py-0.5 leading-none uppercase tracking-wider">beta</span> Investments</h1>
      <span className="text-sm text-muted-foreground">As of</span>
      <input
        type="date"
        value={asOfDate}
        onChange={e => setAsOfDate(e.target.value)}
        className="border rounded px-2 py-1 text-sm"
      />
      <span className="ml-auto flex items-center gap-2"><PortfolioNotesButton /><AnalystToggleButton /></span>
    </div>
  )

  if (loading) {
    return (
      <PortfolioNotesProvider>
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
        {heading}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        </div>
        <PortfolioNotesPanel />
        <AnalystPanel />
        </div>
      </div>
      </PortfolioNotesProvider>
    )
  }

  if (!data || data.companies.length === 0) {
    return (
      <PortfolioNotesProvider>
      <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
        {heading}
        <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 w-full">
          <p className="text-sm text-muted-foreground">
            No investment data yet. Add transactions from individual company pages or use the Import page.
          </p>
        </div>
        <PortfolioNotesPanel />
        <AnalystPanel />
        </div>
      </div>
      </PortfolioNotesProvider>
    )
  }

  return (
    <PortfolioNotesProvider>
    <div className="p-4 md:py-8 md:pl-8 md:pr-4 w-full">
      {heading}

      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 w-full">

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Total Invested</p>
            <p className="text-xl font-semibold">{fmt(data.totalInvested)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Total FMV</p>
            <p className="text-xl font-semibold">{fmt(data.totalFMV)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">Total Realized</p>
            <p className="text-xl font-semibold">{fmt(data.totalRealized)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">MOIC</p>
            <p className="text-xl font-semibold">{fmtMoic(data.portfolioMOIC)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground mb-1">IRR</p>
            <p className="text-xl font-semibold">{fmtIrr(data.portfolioIRR)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-4 mb-4">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="exited">Exited</option>
          <option value="written-off">Written Off</option>
        </select>
        {availableGroups.length > 0 && (
          <select
            value={groupFilter}
            onChange={e => setGroupFilter(e.target.value)}
            className="border rounded px-2 py-1 text-sm"
          >
            <option value="">All Groups</option>
            {availableGroups.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        )}
      </div>

      {/* Company table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left px-3 py-2 font-medium">
                <button onClick={() => handleSort('companyName')} className="hover:text-foreground">
                  Company<SortIcon col="companyName" />
                </button>
              </th>
              <th className="text-left px-3 py-2 font-medium">
                <button onClick={() => handleSort('status')} className="hover:text-foreground">
                  Status<SortIcon col="status" />
                </button>
              </th>
              <th className="text-left px-3 py-2 font-medium">
                <button onClick={() => handleSort('portfolioGroup')} className="hover:text-foreground">
                  Group<SortIcon col="portfolioGroup" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-medium">
                <button onClick={() => handleSort('totalInvested')} className="hover:text-foreground">
                  Invested<SortIcon col="totalInvested" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-medium">
                <button onClick={() => handleSort('fmv')} className="hover:text-foreground">
                  FMV<SortIcon col="fmv" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-medium">
                <button onClick={() => handleSort('totalRealized')} className="hover:text-foreground">
                  Realized<SortIcon col="totalRealized" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-medium">
                <button onClick={() => handleSort('moic')} className="hover:text-foreground">
                  MOIC<SortIcon col="moic" />
                </button>
              </th>
              <th className="text-right px-3 py-2 font-medium">
                <button onClick={() => handleSort('irr')} className="hover:text-foreground">
                  IRR<SortIcon col="irr" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={`${c.companyId}-${c.portfolioGroup.join('')}`} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link
                    href={`/companies/${c.companyId}`}
                    className="font-medium hover:underline"
                  >
                    {c.companyName}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs capitalize ${STATUS_COLORS[c.status]}`}>
                    {c.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {c.portfolioGroup.length > 0 ? c.portfolioGroup.join(', ') : '-'}
                </td>
                <td className="px-3 py-2 text-right font-mono">{fmtFull(c.totalInvested)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtFull(c.fmv)}</td>
                <td className="px-3 py-2 text-right font-mono">{c.totalRealized > 0 ? fmtFull(c.totalRealized) : '-'}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtMoic(c.moic)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmtIrr(c.irr)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t bg-muted/30 font-medium">
              <td className="px-3 py-2">Total ({filtered.length})</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right font-mono">{fmtFull(totals.totalInvested)}</td>
              <td className="px-3 py-2 text-right font-mono">{fmtFull(totals.totalFMV)}</td>
              <td className="px-3 py-2 text-right font-mono">{totals.totalRealized > 0 ? fmtFull(totals.totalRealized) : '-'}</td>
              <td className="px-3 py-2 text-right font-mono">{fmtMoic(totals.moic)}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
    <PortfolioNotesPanel />
    <AnalystPanel />
    </div>
    </div>
    </PortfolioNotesProvider>
  )
}
