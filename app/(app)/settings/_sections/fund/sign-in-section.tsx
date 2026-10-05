'use client'

import { useState } from 'react'
import { AlertCircle, Check, ImagePlus, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Section } from '@/components/settings/section'
import { AuthBrandProvider, AuthWordmark } from '@/components/auth-brand'
import { AUTH_TITLE_MAX } from '@/lib/auth-brand-shared'

const MAX_BYTES = 200 * 1024

/**
 * What the signed-out screens (sign-in, sign-up, password reset, MFA, the OAuth consent screen)
 * show above the form. Defaults: Hemrock's mark and no text.
 */
export function SignInSection({ logo, title, onSaved }: { logo: string | null; title: string | null; onSaved: () => void }) {
  const [logoValue, setLogoValue] = useState<string | null>(logo)
  const [titleValue, setTitleValue] = useState(title ?? '')
  const [savedTitle, setSavedTitle] = useState(title ?? '')
  const [busy, setBusy] = useState<'logo' | 'title' | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (patch: { signInLogo?: string | null; signInTitle?: string | null }) => {
    const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Could not save')
      return false
    }
    onSaved()
    return true
  }

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    if (file.size > MAX_BYTES) { setError('File must be under 200KB'); return }
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      const previous = logoValue
      setLogoValue(dataUrl)
      setBusy('logo')
      if (!(await save({ signInLogo: dataUrl }))) setLogoValue(previous)
      setBusy(null)
    }
    reader.readAsDataURL(file)
  }

  const resetLogo = async () => {
    setError(null)
    setBusy('logo')
    if (await save({ signInLogo: null })) setLogoValue(null)
    setBusy(null)
  }

  const saveTitle = async () => {
    setError(null)
    setBusy('title')
    const next = titleValue.trim()
    if (await save({ signInTitle: next || null })) {
      setSavedTitle(next)
      setTitleValue(next)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
    setBusy(null)
  }

  return (
    <Section title="Sign-in screen">
      <p className="text-xs text-muted-foreground mb-4">
        What the sign-in, sign-up and password screens show above the form. Without a logo it is
        Hemrock&apos;s mark; without text, nothing else.
      </p>

      <div className="rounded-lg border bg-muted/40 py-6 mb-4" aria-label="Preview">
        <AuthBrandProvider brand={{ logo: logoValue, title: savedTitle || null }}>
          <AuthWordmark />
        </AuthBrandProvider>
      </div>

      <Label>Logo</Label>
      <p className="text-xs text-muted-foreground mb-2">Shown up to 40px tall. Max 200KB.</p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer border rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors">
          <ImagePlus className="h-4 w-4" />
          {logoValue ? 'Replace' : 'Choose file'}
          <input type="file" accept="image/*" onChange={onFile} className="hidden" />
        </label>
        {logoValue && (
          <Button variant="ghost" size="sm" onClick={resetLogo} disabled={busy !== null}>
            <RotateCcw className="h-3.5 w-3.5" /> Use Hemrock&apos;s mark
          </Button>
        )}
        {busy === 'logo' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>

      <div className="mt-4 pt-4 border-t">
        <Label htmlFor="sign-in-title">Text under the logo</Label>
        <p className="text-xs text-muted-foreground mb-2">Optional, such as your fund&apos;s name. Leave it empty to show none.</p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
          <Input
            id="sign-in-title"
            className="flex-1"
            value={titleValue}
            maxLength={AUTH_TITLE_MAX}
            placeholder="None"
            onChange={(e) => setTitleValue(e.target.value)}
          />
          <Button onClick={saveTitle} disabled={busy !== null || titleValue.trim() === savedTitle} size="sm">
            {busy === 'title' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive mt-2 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> {error}
        </p>
      )}
    </Section>
  )
}
