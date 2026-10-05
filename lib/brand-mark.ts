// Hemrock's mark: the triangle hemrock.com uses, one open path drawn as a stroke.
// public/brand/hemrock-mark.svg is the source; this is the same drawing for code that renders
// it inline (components/brand-mark.tsx) or as an image (app/api/pwa-icon). Its own module, free
// of imports, so a client component can take it.

export interface MarkPath {
  d: string
}

export const MARK_PATHS: readonly MarkPath[] = [
  { d: 'M13 14L17 9L22 18H2.84444C2.46441 18 2.2233 17.5928 2.40603 17.2596L10.0509 3.31896C10.2429 2.96885 10.7476 2.97394 10.9325 3.32786L15.122 11.3476' },
]

/** The stroke every renderer draws the paths with, in viewBox units. */
export const MARK_STROKE = { width: 2, linecap: 'round', linejoin: 'round' } as const

/** The mark's own box, tight around the stroke: for the mark beside text. */
export const MARK_VIEWBOX = '1.25 2 21.75 17'

/** A square box centred on the mark, which spans its full width: for icons. */
export const MARK_ICON_VIEWBOX = '1.25 -0.375 21.75 21.75'
