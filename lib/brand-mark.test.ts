import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { MARK_ICON_VIEWBOX, MARK_PATHS, MARK_STROKE, MARK_VIEWBOX } from './brand-mark'

/**
 * lib/brand-mark.ts is a hand copy of public/brand/hemrock-mark.svg, for code that draws the
 * mark without reading a file. Pin the copy to the source, so a new mark can't reach the
 * tab icon (generated from the file) and miss the sign-in screen and install icons.
 */
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'hemrock-mark.svg'), 'utf8')
const paths = [...source.matchAll(/<path([^>]*)\/>/g)].map(m => m[1])
const attr = (s: string, name: string) => s.match(new RegExp(`\\s${name}="([^"]+)"`))?.[1]

describe('brand mark', () => {
  it('draws the same paths as the SVG source', () => {
    expect(MARK_PATHS.map(p => p.d)).toEqual(paths.map(p => attr(p, 'd')!.replace(/\s+/g, ' ').trim()))
  })

  it('strokes them the way the source does', () => {
    for (const p of paths) {
      expect(attr(p, 'fill')).toBe('none')
      expect(Number(attr(p, 'stroke-width'))).toBe(MARK_STROKE.width)
      expect(attr(p, 'stroke-linecap')).toBe(MARK_STROKE.linecap)
      expect(attr(p, 'stroke-linejoin')).toBe(MARK_STROKE.linejoin)
    }
  })

  it('uses the source viewBox inline, and the square centred on it for icons', () => {
    expect(source.match(/viewBox="([^"]+)"/)![1]).toBe(MARK_VIEWBOX)
    const [x, y, w, h] = MARK_VIEWBOX.split(' ').map(Number)
    const side = Math.max(w, h)
    expect(MARK_ICON_VIEWBOX).toBe(`${x - (side - w) / 2} ${y - (side - h) / 2} ${side} ${side}`)
  })
})
