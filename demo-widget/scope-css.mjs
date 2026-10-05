/**
 * Scope the app's compiled stylesheet to the demo widget, without changing what it says.
 *
 * The widget ships app/globals.css as the app compiles it — Tailwind's real preflight, every base
 * rule, the tokens, the utilities — and this rewrites only the selectors, so the rules match
 * inside the widget and nowhere else on the host page:
 *
 *   - `:root`, `html`, `:host`, `body`  →  `.oa-demo-root.oa-demo-root`  (the widget's frame, and every portal
 *     it renders under <body>, which index.tsx marks with the same class; the non-inherited
 *     declarations of the body rule — background, margin — go to the frame alone, since a
 *     portal is a child of <body> in the app, not <body> itself)
 *   - `.dark`                          →  `.dark .oa-demo-root`
 *   - anything else                    →  the same selector with `:is(.oa-demo-root.oa-demo-root,
 *     .oa-demo-root.oa-demo-root *)` added to the element it matches. That adds the SAME two
 *     classes of specificity to every rule, so the app's rules keep their order among
 *     themselves and the app's own specificity arguments (the select chevron beating `.px-2`,
 *     for one) still hold, while each one outweighs a host rule of up to two classes: an
 *     unlayered host stylesheet (Tailwind v3's, with @tailwindcss/forms restyling every
 *     `[type='text']` and `select`, as on hemrock.com) loses to it instead of winning.
 *
 * One value changes: rem. The app's sizes are rem against its own <html>, which is the browser's
 * 16px; in the widget a rem would be the HOST's root size, and a host that sets `html { font-size:
 * 18px }` would scale the whole demo by an eighth. So each `Nrem` becomes the `N×16px` the app
 * renders at. Keyframes are left alone. Nothing is added or dropped, so a change to the app's
 * stylesheet reaches the demo on its next build with no copy to update.
 */
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

export const ROOT = 'oa-demo-root'
export const FRAME = 'oa-demo-frame'
const R2 = `.${ROOT}.${ROOT}`
const SCOPE = `:is(${R2},${R2} *)`
const ROOT_SELECTORS = new Set([':root', 'html', ':host', 'body'])
const FRAME_ONLY = /^(background|margin)/

function scopeSelector(sel) {
  const trimmed = sel.trim()
  if (ROOT_SELECTORS.has(trimmed)) return R2
  if (trimmed === '.dark') return `.dark .${ROOT}`
  return selectorParser(root => {
    root.each(selector => {
      // The last compound: the nodes after the last combinator.
      const nodes = selector.nodes
      let start = 0
      for (let i = 0; i < nodes.length; i++) if (nodes[i].type === 'combinator') start = i + 1
      // Before a pseudo-element, since `:is()` belongs to the element, not to `::before`.
      let at = nodes.length
      for (let i = start; i < nodes.length; i++) {
        const n = nodes[i]
        if (n.type === 'pseudo' && (n.value.startsWith('::') || /^:(before|after|first-line|first-letter)$/.test(n.value))) { at = i; break }
      }
      const where = selectorParser.pseudo({ value: ':is' })
      where.append(selectorParser.selector({ nodes: [selectorParser.className({ value: ROOT }), selectorParser.className({ value: ROOT })] }))
      where.append(selectorParser.selector({ nodes: [
        selectorParser.className({ value: ROOT }),
        selectorParser.className({ value: ROOT }),
        selectorParser.combinator({ value: ' ' }),
        selectorParser.universal(),
      ] }))
      if (at === nodes.length) selector.append(where)
      else selector.insertBefore(nodes[at], where)
    })
  }).processSync(trimmed)
}

const REM = /(-?(?:\d+\.?\d*|\.\d+))rem\b/g
const px = n => `${+(parseFloat(n) * 16).toFixed(4)}px`

export function scopeCss(css) {
  const ast = postcss.parse(css)
  const inserted = []
  ast.walkDecls(d => { if (d.value.includes('rem') && !d.value.includes('url(')) d.value = d.value.replace(REM, (_m, n) => px(n)) })
  ast.walkRules(rule => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    const selectors = rule.selectors
    const isRoot = selectors.every(s => ROOT_SELECTORS.has(s.trim()))
    if (isRoot && selectors.some(s => s.trim() === 'body')) {
      // body: inherited declarations on every root, the rest on the frame only. The root is the
      // app's html AND body at once, so body's `line-height: inherit` (which in the app reads
      // html's 1.5) would reach past it to the host page; html's value already stands.
      const frameDecls = []
      rule.walkDecls(d => {
        if (FRAME_ONLY.test(d.prop)) { frameDecls.push(d.clone()); d.remove() }
        else if (d.prop === 'line-height' && d.value === 'inherit') d.remove()
      })
      // Inserted after the walk, so the walk does not visit (and scope) the rule it just made.
      // Three classes: the frame is also a root, and the reset reverts it at two.
      if (frameDecls.length) inserted.push([rule, postcss.rule({ selector: `${R2}.${FRAME}`, nodes: frameDecls })])
    }
    rule.selectors = [...new Set(selectors.map(scopeSelector))]
  })
  for (const [after, frame] of inserted) after.after(frame)
  ast.walkRules(rule => { if (rule.nodes.length === 0) rule.remove() })
  return ast.toString()
}

/**
 * What makes the widget's elements start where the app's do: from the browser's defaults, with
 * nothing of the host page's in between. It comes BEFORE the app's rules, at the same two classes
 * of specificity every scoped app rule carries, so a tie goes to the app's rule by source order.
 *
 *   1. `all: revert` on every HTML element of the widget (and its pseudo-elements): the host's
 *      stylesheet is discarded and each property falls back to the browser default, which is
 *      what the app's own rules are written on top of. A Tailwind v4 site's base layer loses to
 *      it because an unlayered rule beats every layered one; an unlayered v3 site's element and
 *      attribute rules (`select`, `[type='text']`) lose on specificity. The app's rules, later
 *      and never lighter, then apply as in the app.
 *   2. The root is not the top of a document, so what <html> and <body> would give it by
 *      inheritance is set here: the text properties back to the app's html defaults, and the
 *      font variable the app's tokens name pointed at the host's Inter.
 *
 * What it cannot stop is an unlayered host rule heavier than two classes (`[type='checkbox']:
 * checked:hover`), or one loaded after the widget's stylesheet at equal weight;
 * scripts/demo-styles.mjs with DEMO_HOST_CSS set to the host's stylesheet would show it.
 */
// Left out: anything whose own markup styles it. SVG presentation attributes (a rect's width, a
// path's stroke) and the width/height attributes of images and other embedded media are
// author-level styles that `all: revert` would discard, collapsing icons and images; the app's
// own reset covers what a host's does for media (display, max-width, height). Table cells get
// their 1px default padding the same way, from the table, so it is restored explicitly below.
const NOT_SELF_STYLED = ':not(svg,svg *,img,video,canvas,iframe,embed,object,picture,audio)'
// Exactly two classes: `:is()` carries the root's weight, `:where()` keeps the exclusions weightless.
const HTML_SCOPE = `:is(${R2},${R2} *):where(${NOT_SELF_STYLED})`

// SVG can't take `all: revert`, but a host's utility classes still match the app's class names
// on icons: a Tailwind v4 host's `-translate-y-1/2` sets the `translate` property, the app's v3
// sets `transform`, and the icon moves twice. So on SVG, every property a host rule might set
// that is NOT one of SVG's presentation attributes (those carry the icon's own geometry and
// paint) is reverted by name.
const SVG_REVERT = [
  'translate', 'rotate', 'scale', 'position', 'inset', 'z-index', 'float', 'margin', 'padding',
  'border', 'border-radius', 'box-shadow', 'background', 'outline', 'box-sizing', 'flex', 'order',
  'align-self', 'justify-self', 'place-self', 'grid-area', 'min-width', 'max-width', 'min-height',
  'max-height', 'vertical-align', 'animation', 'transition', 'object-fit', 'object-position',
  'aspect-ratio', 'content-visibility', 'contain', 'will-change', 'backdrop-filter',
].map(prop => `${prop}:revert`).join(';')
// Chrome's parts of a date input, which a host's form styles reach (@tailwindcss/forms pads and
// sizes them, so a date field is 2px shorter than in the app). Their own rule: a pseudo-element a
// browser doesn't know invalidates every selector in its list, and Firefox knows none of these.
const WEBKIT_DATE = ['::-webkit-datetime-edit', '::-webkit-datetime-edit-fields-wrapper', '::-webkit-date-and-time-value',
  ...['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond', 'meridiem'].map(f => `::-webkit-datetime-edit-${f}-field`)]
export const ROOT_RESET = `
${HTML_SCOPE},${HTML_SCOPE}::before,${HTML_SCOPE}::after,${HTML_SCOPE}::placeholder,${HTML_SCOPE}::selection,${HTML_SCOPE}::marker,${HTML_SCOPE}::file-selector-button{all:revert}
${WEBKIT_DATE.map(p => `${HTML_SCOPE}${p}`).join(',')}{all:revert}
:where(td,th):is(${R2} *){padding:1px}
:where(svg,svg *):is(${R2},${R2} *){${SVG_REVERT}}
${R2}{--font-inter:var(--font-sans-face,Inter);font-size:16px;font-weight:400;font-style:normal;font-variant:normal;font-stretch:normal;letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0;text-align:start;text-shadow:none;white-space:normal;cursor:auto;-webkit-font-smoothing:auto}
`.trim()
