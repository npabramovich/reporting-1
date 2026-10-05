// The Welden mark: a pair of eyeglasses. The frame is one path with the two lenses cut out
// (evenodd); the bridge is drawn again on top so it stays substantial at small sizes.
// public/brand/welden-mark.svg is the source; this is the same drawing for code that
// renders it inline (components/brand-mark.tsx) or as an image (app/api/pwa-icon). Its own
// module, free of imports, so a client component can take it.

export interface MarkPath {
  d: string
  /** The frame needs evenodd, or the lenses fill in solid. */
  fillRule?: 'evenodd'
}

export const MARK_PATHS: readonly MarkPath[] = [
  {
    fillRule: 'evenodd',
    d: 'M38 48C91 36 163 35 218 42 C239 45 252 56 270 72 C281 82 293 86 320 86 C347 86 359 82 370 72 C388 56 401 45 422 42 C477 35 549 36 602 48V82 C591 88 584 98 581 114L567 174 C559 207 538 220 501 223 C465 226 426 225 402 213 C381 202 370 182 364 158L354 118 C350 102 341 96 320 96 C299 96 290 102 286 118L276 158 C270 182 259 202 238 213 C214 225 175 226 139 223 C102 220 81 207 73 174L59 114 C56 98 49 88 38 82Z M82 73C119 66 172 65 211 70 C231 73 241 85 244 103 C246 116 242 137 237 157 C231 181 218 190 195 193 C170 196 138 195 119 190 C101 185 94 174 89 153L77 105 C73 89 74 78 82 73Z M558 73C521 66 468 65 429 70 C409 73 399 85 396 103 C394 116 398 137 403 157 C409 181 422 190 445 193 C470 196 502 195 521 190 C539 185 546 174 551 153L563 105 C567 89 566 78 558 73Z',
  },
  {
    d: 'M244 70 C264 73 278 78 288 87 H352 C362 78 376 73 396 70 L392 105 C376 101 365 103 357 112 H283 C275 103 264 101 248 105Z',
  },
]

/** The glasses' own box, tight around the drawing (about 3:1): for the mark beside text. */
export const MARK_VIEWBOX = '38 37 564 188'

/** A square box centred on the glasses, which span its full width: for icons. */
export const MARK_ICON_VIEWBOX = '38 -151 564 564'
