'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

interface ImportResult {
  companiesCreated: number
  companiesMatched: number
  metricsCreated: number
  metricsMatched: number
  metricValuesCreated: number
  metricValuesSkipped: number
  sendersCreated: number
  errors: string[]
}

export default function ImportPage() {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleImport() {
    if (!text.trim()) return
    setImporting(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Import failed')
        return
      }

      setResult(data)
    } catch {
      setError('Something went wrong')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight mb-2">Bulk Import</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Paste CSV or spreadsheet data from Google Sheets. Claude will parse it to create companies, metrics, and historical values.
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <Alert className="mb-4">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>
            <div className="space-y-1">
              <p className="font-medium">Import complete</p>
              <ul className="text-sm space-y-0.5">
                <li>{result.companiesCreated} companies created{result.companiesMatched > 0 ? `, ${result.companiesMatched} matched existing` : ''}</li>
                <li>{result.metricsCreated} metrics created{result.metricsMatched > 0 ? `, ${result.metricsMatched} matched existing` : ''}</li>
                <li>{result.metricValuesCreated} metric values imported{result.metricValuesSkipped > 0 ? `, ${result.metricValuesSkipped} skipped (already exist)` : ''}</li>
                {result.sendersCreated > 0 && (
                  <li>{result.sendersCreated} authorized senders added</li>
                )}
              </ul>
              {result.errors.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm font-medium text-destructive">Issues:</p>
                  <ul className="text-sm text-destructive space-y-0.5">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <Textarea
          placeholder={`Paste your spreadsheet data here...\n\nExample:\nCompany, Fund, Sector, Stage, Email, MRR Q1 2025, MRR Q2 2025\nAcme Corp, Fund I, SaaS, Series A, cfo@acme.com, 50000, 65000\nBeta Inc, Fund II, Fintech, Seed, founder@beta.io, 12000, 15000`}
          value={text}
          onChange={e => setText(e.target.value)}
          rows={16}
          className="font-mono text-sm"
        />

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Supports CSV, tab-separated, or any tabular text format.
          </p>
          <Button onClick={handleImport} disabled={importing || !text.trim()}>
            {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {importing ? 'Importing...' : 'Import'}
          </Button>
        </div>
      </div>
    </div>
  )
}
