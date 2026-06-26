// Per-fund branding theme. Stored on fund_settings.theme (jsonb) and applied
// app-wide via CSS-variable overrides. An empty/absent theme = the default
// neutral look (no overrides), so the app ships looking exactly as it does
// today; the Appearance settings let an installer opt into a brand.

export interface FundTheme {
  /** Accent as an HSL triple string, e.g. "243 75% 59%". Drives primary
   *  actions, focus rings, and active states. Null = default neutral. */
  accent?: string | null
  /** UI font key (see FONT_OPTIONS). Null/'system' = the default stack. */
  font?: string | null
  /** Corner radius in rem, e.g. 0.5. */
  radius?: number | null
}

export const ACCENT_PRESETS: Array<{ key: string; label: string; hsl: string; fg: string }> = [
  { key: 'neutral', label: 'Neutral', hsl: '0 0% 9%', fg: '0 0% 98%' },
  { key: 'indigo', label: 'Indigo', hsl: '243 75% 59%', fg: '0 0% 100%' },
  { key: 'blue', label: 'Blue', hsl: '217 91% 60%', fg: '0 0% 100%' },
  { key: 'violet', label: 'Violet', hsl: '262 83% 58%', fg: '0 0% 100%' },
  { key: 'emerald', label: 'Emerald', hsl: '160 84% 39%', fg: '0 0% 100%' },
  { key: 'teal', label: 'Teal', hsl: '173 80% 36%', fg: '0 0% 100%' },
  { key: 'rose', label: 'Rose', hsl: '347 77% 50%', fg: '0 0% 100%' },
  { key: 'amber', label: 'Amber', hsl: '38 92% 50%', fg: '38 92% 12%' },
  { key: 'slate', label: 'Slate blue', hsl: '215 25% 35%', fg: '0 0% 100%' },
]

export const FONT_OPTIONS: Array<{ key: string; label: string; varName: string | null }> = [
  { key: 'system', label: 'System default', varName: null },
  { key: 'hanken', label: 'Hanken Grotesk', varName: '--font-hanken' },
  { key: 'jakarta', label: 'Plus Jakarta Sans', varName: '--font-jakarta' },
]

export const RADIUS_OPTIONS: Array<{ key: string; label: string; rem: number }> = [
  { key: 'sharp', label: 'Sharp', rem: 0.25 },
  { key: 'default', label: 'Default', rem: 0.5 },
  { key: 'rounded', label: 'Rounded', rem: 0.875 },
]

/** Foreground (text-on-accent) for a given accent HSL; falls back to white. */
function accentForeground(hsl: string): string {
  return ACCENT_PRESETS.find(p => p.hsl === hsl)?.fg ?? '0 0% 100%'
}

/**
 * Build the `:root` CSS-variable overrides for a fund theme. Returns '' when
 * nothing is set, so the default neutral theme is left fully intact.
 */
export function themeCssVars(theme: FundTheme | null | undefined): string {
  if (!theme) return ''
  const out: string[] = []
  if (theme.accent) {
    const fg = accentForeground(theme.accent)
    out.push(
      `--primary:${theme.accent}`,
      `--primary-foreground:${fg}`,
      `--ring:${theme.accent}`,
      `--brand:${theme.accent}`,
      `--brand-foreground:${fg}`,
    )
  }
  if (theme.font) {
    const f = FONT_OPTIONS.find(o => o.key === theme.font)
    if (f?.varName) out.push(`--font-sans:var(${f.varName})`)
  }
  if (typeof theme.radius === 'number' && theme.radius >= 0) {
    out.push(`--radius:${theme.radius}rem`)
  }
  return out.join(';')
}
