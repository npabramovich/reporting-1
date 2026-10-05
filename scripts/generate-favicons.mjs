#!/usr/bin/env node
/**
 * Generate the browser-tab icons from the mark, public/brand/hemrock-mark.svg.
 *
 *   node scripts/generate-favicons.mjs
 *
 * Both are linked from TAB_ICONS in lib/pwa.ts. Writes:
 *   public/icon.svg     the tab icon for every browser that takes an SVG one. Ink on a
 *                       light tab bar, and the light ink on a dark one, through a
 *                       prefers-color-scheme rule inside the file.
 *   public/favicon.ico  16, 32 and 48px, for browsers that ask for /favicon.ico instead
 *                       (Safari, and anything reading the site without its HTML). In ink.
 *
 * The home-screen and install icons are not files: app/api/pwa-icon draws them from
 * MARK_PATHS in lib/brand-mark.ts, in the fund's accent. Re-run this and update MARK_PATHS
 * (and MARK_ICON_VIEWBOX, the same square this computes) together when the mark changes.
 * Commit the output.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'public', 'brand', 'hemrock-mark.svg'), 'utf8')
// The mark is wider than it is tall; an icon is square. Centre its box in a square whose
// side is the longer dimension, rather than letting the renderer stretch or crop it.
const [x, y, w, h] = source.match(/viewBox="([^"]+)"/)[1].split(/[\s,]+/).map(Number)
const side = Math.max(w, h)
const viewBox = `${x - (side - w) / 2} ${y - (side - h) / 2} ${side} ${side}`
const paths = [...source.matchAll(/<path[^>]*\/>/g)].map(m => m[0]).join('')

// --foreground in app/globals.css, light and dark (lib/pwa.ts DEFAULT_MARK_HEX is the first).
const INK = '#1c1a17'
const INK_DARK = '#f1f1f3'

// The mark is a stroke, so the colour rule targets stroke; the source's own stroke colour is
// the ink already, which is what the .ico renders.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><style>path{stroke:${INK}}@media (prefers-color-scheme:dark){path{stroke:${INK_DARK}}}</style>${paths}</svg>\n`
fs.writeFileSync(path.join(root, 'public', 'icon.svg'), icon)

// A 2-unit stroke is about 1.5px at 16px, where it blurs to grey. Hold every size at a 1.75px
// stroke or more, the same trade hemrock.com's own favicon makes with a heavier stroke.
const strokeFor = size => Math.max(2, (1.75 * side) / size)
const inked = size => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${paths.replace(/stroke-width="[^"]+"/g, `stroke-width="${strokeFor(size)}"`).replace(/stroke="[^"]+"/g, `stroke="${INK}"`)}</svg>`,
)
const sizes = [16, 32, 48]
const pngs = await Promise.all(sizes.map(size => sharp(inked(size), { density: 600 }).resize(size, size).png().toBuffer()))
fs.writeFileSync(path.join(root, 'public', 'favicon.ico'), ico(sizes, pngs))
console.log('wrote public/icon.svg and public/favicon.ico (16, 32, 48)')

/** An .ico holding PNG images: a 6-byte header, a 16-byte entry per image, then the images. */
function ico(sizes, images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((image, i) => {
    const entry = 6 + 16 * i
    header.writeUInt8(sizes[i] % 256, entry)
    header.writeUInt8(sizes[i] % 256, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(image.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += image.length
  })
  return Buffer.concat([header, ...images])
}
