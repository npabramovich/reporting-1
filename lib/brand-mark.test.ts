import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { MARK_ICON_VIEWBOX, MARK_PATHS, MARK_VIEWBOX } from './brand-mark'

/**
 * lib/brand-mark.ts is a hand copy of public/brand/welden-mark.svg, for code that draws the
 * mark without reading a file. Pin the copy to the source, so a new mark can't reach the
 * tab icon (generated from the file) and miss the sign-in screen and install icons.
 */
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'brand', 'welden-mark.svg'), 'utf8')

describe('brand mark', () => {
  it('draws the same paths, with the same fill rules, as the SVG source', () => {
    const paths = [...source.matchAll(/<path([^>]*)\/>/g)].map(m => ({
      d: m[1].match(/\sd="([^"]+)"/)![1].replace(/\s+/g, ' ').trim(),
      fillRule: m[1].match(/fill-rule="([^"]+)"/)?.[1],
    }))
    expect(MARK_PATHS.map(p => ({ d: p.d, fillRule: p.fillRule }))).toEqual(paths)
  })

  it('uses the source viewBox inline, and the square centred on it for icons', () => {
    expect(source.match(/viewBox="([^"]+)"/)![1]).toBe(MARK_VIEWBOX)
    const [x, y, w, h] = MARK_VIEWBOX.split(' ').map(Number)
    const side = Math.max(w, h)
    expect(MARK_ICON_VIEWBOX).toBe(`${x - (side - w) / 2} ${y - (side - h) / 2} ${side} ${side}`)
  })
})
