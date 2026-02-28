'use client'

import { useState, KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { X } from 'lucide-react'
import type { Company } from '@/lib/types/database'

interface Props {
  company?: Company
  initialName?: string
  onSuccess: (company: Company) => void
  onCancel: () => void
}

export function CompanyForm({ company, initialName, onSuccess, onCancel }: Props) {
  const isEdit = !!company

  const [name, setName] = useState(company?.name ?? initialName ?? '')
  const [aliases, setAliases] = useState<string[]>(company?.aliases ?? [])
  const [aliasInput, setAliasInput] = useState('')
  const [stage, setStage] = useState(company?.stage ?? '')
  const [industry, setIndustry] = useState(company?.industry ?? '')
  const [tags, setTags] = useState<string[]>(company?.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [notes, setNotes] = useState(company?.notes ?? '')
  const [overview, setOverview] = useState(company?.overview ?? '')
  const [founders, setFounders] = useState(company?.founders ?? '')
  const [whyInvested, setWhyInvested] = useState(company?.why_invested ?? '')
  const [currentUpdate, setCurrentUpdate] = useState(company?.current_update ?? '')
  const [contactEmail, setContactEmail] = useState(company?.contact_email ?? '')
  const [status, setStatus] = useState(company?.status ?? 'active')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addTag() {
    const trimmed = tagInput.trim()
    if (!trimmed || tags.includes(trimmed)) return
    setTags(prev => [...prev, trimmed])
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags(prev => prev.filter(t => t !== tag))
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag()
    }
  }

  function addAlias() {
    const trimmed = aliasInput.trim()
    if (!trimmed || aliases.includes(trimmed)) return
    setAliases(prev => [...prev, trimmed])
    setAliasInput('')
  }

  function removeAlias(alias: string) {
    setAliases(prev => prev.filter(a => a !== alias))
  }

  function handleAliasKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addAlias()
    }
  }

  async function submit() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setError(null)
    setSaving(true)

    try {
      const url = isEdit ? `/api/companies/${company.id}` : '/api/companies'
      const method = isEdit ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          aliases: aliases.length > 0 ? aliases : null,
          tags: tags.length > 0 ? tags : [],
          stage: stage.trim() || null,
          industry: industry.trim() || null,
          notes: notes.trim() || null,
          overview: overview.trim() || null,
          founders: founders.trim() || null,
          why_invested: whyInvested.trim() || null,
          current_update: currentUpdate.trim() || null,
          contact_email: contactEmail.trim() || null,
          ...(isEdit ? { status } : {}),
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
      onSuccess(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="company-name">Name</Label>
        <Input
          id="company-name"
          placeholder="Acme Corp"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label>Aliases</Label>
        {aliases.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {aliases.map(alias => (
              <Badge key={alias} variant="secondary" className="gap-1 pr-1">
                {alias}
                <button
                  type="button"
                  onClick={() => removeAlias(alias)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <Input
          placeholder="Add alias and press Enter"
          value={aliasInput}
          onChange={e => setAliasInput(e.target.value)}
          onKeyDown={handleAliasKeyDown}
          onBlur={addAlias}
        />
        <p className="text-xs text-muted-foreground">
          Alternative names Claude might see in emails (e.g. abbreviations, trading names).
        </p>
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map(tag => (
              <Badge key={tag} variant="outline" className="gap-1 pr-1">
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <Input
          placeholder="Add tag and press Enter (e.g. Fund I)"
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={handleTagKeyDown}
          onBlur={addTag}
        />
        <p className="text-xs text-muted-foreground">
          Tags for organizing companies (e.g. fund name, cohort).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="stage">Stage</Label>
          <Input
            id="stage"
            placeholder="Series A"
            value={stage}
            onChange={e => setStage(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="industry">Industry</Label>
          <Input
            id="industry"
            placeholder="SaaS"
            value={industry}
            onChange={e => setIndustry(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="founders">Founders</Label>
        <Input
          id="founders"
          placeholder="Jane Doe, John Smith"
          value={founders}
          onChange={e => setFounders(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-email">Contact Email</Label>
        <Input
          id="contact-email"
          type="email"
          placeholder="founder@company.com"
          value={contactEmail}
          onChange={e => setContactEmail(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="overview">Overview</Label>
        <Textarea
          id="overview"
          placeholder="Brief description of the company..."
          value={overview}
          onChange={e => setOverview(e.target.value)}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="why-invested">Why We Invested</Label>
        <Textarea
          id="why-invested"
          placeholder="Investment thesis..."
          value={whyInvested}
          onChange={e => setWhyInvested(e.target.value)}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="current-update">Current Business Update</Label>
        <Textarea
          id="current-update"
          placeholder="Latest update on the business..."
          value={currentUpdate}
          onChange={e => setCurrentUpdate(e.target.value)}
          rows={2}
        />
      </div>

      {isEdit && (
        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="exited">Exited</SelectItem>
              <SelectItem value="written-off">Written off</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          placeholder="Any notes about this company…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add company'}
        </Button>
      </div>
    </div>
  )
}
