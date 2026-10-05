import postcss from 'postcss'

// The Intel bundle runs on macOS 10.13-11, whose system WebKit (Safari 13-14.1)
// knows neither color-mix() (Safari 16.2) nor aspect-ratio (Safari 15). A
// color-mix() inside var() is accepted at parse time and fails at computed time,
// so a plain fallback declaration placed before it is lost: the fallback has to
// live in an @supports block that modern engines skip entirely.
export const NO_COLOR_MIX = 'not (color: color-mix(in srgb, red, red))'
export const NO_ASPECT_RATIO = 'not (aspect-ratio: 1 / 1)'
export const ASPECT_CARRIER = '--old-webkit-ar'

const NAMED = {
  transparent: { r: 0, g: 0, b: 0, a: 0 },
  white: { r: 255, g: 255, b: 255, a: 1 },
  black: { r: 0, g: 0, b: 0, a: 1 },
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function splitTop(text, sep) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && (sep === ' ' ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim() || sep !== ' ') out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim() || (sep !== ' ' && out.length)) out.push(cur.trim())
  return out
}

function closingParen(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')' && --depth === 0) return i
  }
  return -1
}

function channel(part, scale) {
  const m = /^(-?[\d.]+)(%?)$/.exec(part)
  if (!m) return null
  const n = Number(m[1])
  return m[2] ? (n / 100) * scale : n
}

function alpha(part) {
  if (part === undefined) return 1
  const v = channel(part, 1)
  return v === null ? null : clamp(v, 0, 1)
}

function hue(part) {
  const m = /^(-?[\d.]+)(deg|turn|rad)?$/.exec(part)
  if (!m) return null
  const n = Number(m[1])
  if (m[2] === 'turn') return n * 360
  if (m[2] === 'rad') return (n * 180) / Math.PI
  return n
}

function channels(args) {
  const parts = args.includes(',') ? splitTop(args, ',') : splitTop(args.replace('/', ' / '), ' ')
  const slash = parts.indexOf('/')
  return slash >= 0 ? [...parts.slice(0, slash), parts[slash + 1]] : parts
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 }
}

export function parseColor(input) {
  const text = input.trim().toLowerCase()
  if (text in NAMED) return { ...NAMED[text] }
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)
  if (hex) {
    const h = hex[1]
    if (h.length === 5 || h.length === 7) return null
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h
    const n = (i) => parseInt(full.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: full.length === 8 ? n(6) / 255 : 1 }
  }
  const fn = /^(rgba?|hsla?)\((.*)\)$/.exec(text)
  if (!fn) return null
  const parts = channels(fn[2])
  if (parts.length < 3 || parts.length > 4) return null
  const a = alpha(parts[3])
  if (a === null) return null
  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => channel(p, 255))
    if ([r, g, b].some((v) => v === null)) return null
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a }
  }
  const h = hue(parts[0])
  const s = channel(parts[1].endsWith('%') ? parts[1] : parts[1] + '%', 1)
  const l = channel(parts[2].endsWith('%') ? parts[2] : parts[2] + '%', 1)
  if (h === null || s === null || l === null) return null
  return { ...hslToRgb(((h % 360) + 360) % 360, clamp(s, 0, 1), clamp(l, 0, 1)), a }
}

export function formatColor({ r, g, b, a }) {
  const byte = (v) => Math.round(clamp(v, 0, 255))
  if (a >= 0.9995) return '#' + [r, g, b].map((v) => byte(v).toString(16).padStart(2, '0')).join('')
  return `rgba(${byte(r)},${byte(g)},${byte(b)},${Number(a.toFixed(3))})`
}

function mixPart(part) {
  const lead = /^([\d.]+)%\s+(.+)$/.exec(part)
  const tail = /^(.+?)\s+([\d.]+)%$/.exec(part)
  const [colorText, pct] = lead ? [lead[2], lead[1]] : tail ? [tail[1], tail[2]] : [part, null]
  return { colorText, p: pct === null ? null : Number(pct) / 100 }
}

/**
 * CSS Color 5 color-mix() in srgb: premultiplied alpha, percentages normalised,
 * a sum under 100% fades the result. `resolve` turns an operand's text into a
 * concrete color; an operand it cannot resolve (a tint set per element) takes
 * the other operand's color, so the base surface survives without the tint.
 */
export function mixSrgb(args, resolve = (t) => t, onGuess = () => {}) {
  const parts = splitTop(args, ',')
  if (parts.length !== 3 || !/^in\s+srgb$/i.test(parts[0])) return null
  const one = mixPart(parts[1])
  const two = mixPart(parts[2])
  if (!one || !two) return null
  for (const side of [one, two]) {
    const text = resolve(side.colorText)
    side.color = text === null ? null : parseColor(text)
  }
  if (!one.color && !two.color) return null
  if (!one.color || !two.color) {
    onGuess()
    one.color ??= two.color
    two.color ??= one.color
  }
  let p1 = one.p
  let p2 = two.p
  if (p1 === null && p2 === null) p1 = p2 = 0.5
  else if (p1 === null) p1 = 1 - p2
  else if (p2 === null) p2 = 1 - p1
  const sum = p1 + p2
  if (!(sum > 0)) return null
  const fade = Math.min(sum, 1)
  p1 /= sum
  p2 /= sum
  const a = one.color.a * p1 + two.color.a * p2
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
  const mix = (k) => (one.color[k] * one.color.a * p1 + two.color[k] * two.color.a * p2) / a
  return { r: mix('r'), g: mix('g'), b: mix('b'), a: a * fade }
}

function substituteVars(text, lookup, seen) {
  let out = text
  for (;;) {
    const at = out.lastIndexOf('var(')
    if (at < 0) return out
    const end = closingParen(out, at + 3)
    if (end < 0) return null
    const [name, ...rest] = splitTop(out.slice(at + 4, end), ',')
    const fallback = rest.length ? rest.join(',') : null
    let value = seen.has(name) ? null : lookup(name)
    if (value !== null && value !== undefined) value = resolveColorMixes(value, lookup, new Set([...seen, name]))
    if (value === null || value === undefined) value = fallback
    if (value === null) return null
    out = out.slice(0, at) + value + out.slice(end + 1)
  }
}

/**
 * Evaluates every color-mix() in `value`, innermost first. Variables are only
 * substituted inside color-mix(): elsewhere they keep working on old WebKit.
 * Returns null when any color-mix() cannot be computed statically.
 */
export function resolveColorMixes(value, lookup, seen = new Set(), onGuess = () => {}) {
  let out = value
  for (;;) {
    const at = out.lastIndexOf('color-mix(')
    if (at < 0) return out
    const end = closingParen(out, at + 9)
    if (end < 0) return null
    const mixed = mixSrgb(out.slice(at + 10, end), (text) => substituteVars(text, lookup, seen), onGuess)
    if (!mixed) return null
    out = out.slice(0, at) + formatColor(mixed) + out.slice(end + 1)
  }
}

/** `aspect-ratio` value → carrier text: "<w/h> w|h" or "none". */
export function aspectCarrier(value, decls) {
  const v = value.replace(/!important/i, '').trim().toLowerCase()
  const ratioText = v.replace(/\bauto\b/, '').trim()
  if (!ratioText) return 'none'
  const [w, h = '1'] = ratioText.split('/').map((s) => s.trim())
  const ratio = Number(w) / Number(h)
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null
  const set = (prop) => decls.some((d) => d.prop === prop && !/^auto\b/i.test(d.value.trim()))
  const widthSet = set('width')
  const heightSet = set('height')
  if (widthSet && heightSet) return 'none'
  const axis = heightSet || (!widthSet && set('top') && set('bottom')) ? 'h' : 'w'
  return `${Number(ratio.toFixed(4))} ${axis}`
}

function insideKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return true
  return false
}

function rootTokens(root, tokens = new Map()) {
  root.walkRules((rule) => {
    if (rule.parent?.type !== 'root') return
    if (!rule.selectors.every((s) => s.trim() === ':root')) return
    rule.each((d) => {
      if (d.type === 'decl' && d.prop.startsWith('--')) tokens.set(d.prop, d.value)
    })
  })
  return tokens
}

/**
 * Adds old-WebKit fallbacks after every rule that uses color-mix() or
 * aspect-ratio. The original rules are left untouched, so engines that support
 * both features render exactly what they rendered before.
 */
export function collectRootTokens(sources) {
  const tokens = new Map()
  for (const css of sources) rootTokens(postcss.parse(css), tokens)
  return tokens
}

/** `inherited` are :root tokens from the other stylesheets: a lazy chunk's CSS uses them without defining them. */
export function lowerForOldWebKit(css, inherited = new Map()) {
  const root = postcss.parse(css)
  const tokens = rootTokens(root, new Map(inherited))
  const stats = { colorMix: 0, colorMixLowered: 0, untinted: 0, aspectRatio: 0, unresolved: [] }
  const rules = []
  root.walkRules((rule) => rules.push(rule))
  for (const rule of rules) {
    if (insideKeyframes(rule)) continue
    const decls = rule.nodes.filter((n) => n.type === 'decl')
    const local = new Map(decls.filter((d) => d.prop.startsWith('--')).map((d) => [d.prop, d.value]))
    const lookup = (name) => local.get(name) ?? tokens.get(name) ?? null
    const colors = []
    const ratios = []
    for (const d of decls) {
      if (d.value.includes('color-mix(')) {
        stats.colorMix++
        let guessed = false
        const value = resolveColorMixes(d.value, lookup, new Set(), () => (guessed = true))
        if (value === null) stats.unresolved.push(`${rule.selector} { ${d.prop}: ${d.value} }`)
        else {
          stats.colorMixLowered++
          if (guessed) stats.untinted++
          colors.push(postcss.decl({ prop: d.prop, value, important: d.important }))
        }
      }
      if (d.prop === 'aspect-ratio') {
        const carrier = aspectCarrier(d.value, decls)
        if (carrier !== null) {
          stats.aspectRatio++
          ratios.push(postcss.decl({ prop: ASPECT_CARRIER, value: carrier }))
        }
      }
    }
    let anchor = rule
    for (const [params, nodes] of [
      [NO_COLOR_MIX, colors],
      [NO_ASPECT_RATIO, ratios],
    ]) {
      if (!nodes.length) continue
      const block = postcss.atRule({ name: 'supports', params })
      block.append(postcss.rule({ selector: rule.selector, nodes }))
      anchor.after(block)
      anchor = block
    }
  }
  return { css: root.toString(), stats }
}

export function oldWebKitCss() {
  return {
    name: 'millida:old-webkit-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const sheets = Object.values(bundle).filter((f) => f.type === 'asset' && f.fileName.endsWith('.css'))
      const tokens = collectRootTokens(sheets.map((f) => String(f.source)))
      for (const file of sheets) {
        const { css, stats } = lowerForOldWebKit(String(file.source), tokens)
        file.source = css
        this.info(
          `${file.fileName}: color-mix ${stats.colorMixLowered}/${stats.colorMix} (без подкраски ${stats.untinted}), aspect-ratio ${stats.aspectRatio}` +
            (stats.unresolved.length ? `; без запасного цвета: ${stats.unresolved.length}` : ''),
        )
      }
    },
  }
}
