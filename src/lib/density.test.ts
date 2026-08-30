import { expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const read = (name: string) => readFileSync(new URL('../styles/' + name, import.meta.url), 'utf8')

const BASE_FILES = ['02-kit.css', '03-mods.css', '04-hosting.css', '05-media.css', '06-onboarding.css', '08-themes.css']
const DENSITY_FILE = '07-density.css'

type Rule = { selector: string; props: string[]; spec: number; order: number }

const stripAtRules = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@(media|supports|container)[^{]*\{/g, '')
    .replace(/@(keyframes|font-face)[^{]*\{[\s\S]*?\}\s*\}/g, '')

const propsOf = (body: string) =>
  body
    .split(';')
    .map((d) => d.split(':')[0].trim().toLowerCase())
    .filter((p) => p && !p.startsWith('/'))

const specificity = (sel: string) => {
  const ids = (sel.match(/#[\w-]+/g) || []).length
  const classes = (sel.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)(?!root\b)[\w-]+(\([^)]*\))?/g) || []).length
  const roots = (sel.match(/:root\b/g) || []).length
  return ids * 10000 + (classes + roots) * 100
}

const parse = (css: string): Rule[] => {
  const out: Rule[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripAtRules(css)))) {
    const props = propsOf(m[2])
    if (!props.length) continue
    for (const sel of m[1].split(',')) {
      const s = sel.trim().replace(/\s+/g, ' ')
      if (!s || s.startsWith('@') || s.includes('%')) continue
      out.push({ selector: s, props, spec: specificity(s), order: out.length })
    }
  }
  return out
}

const compounds = (sel: string) =>
  sel
    .split(/\s*[>+~]\s*|\s+/)
    .filter(Boolean)
    .map((c) => new Set((c.match(/\.[\w-]+/g) || []).map((x) => x.slice(1))))

/// True when every element matched by `narrow` is also matched by `wide`:
/// the compounds of `wide` appear in order inside `narrow` with the last ones
/// aligned, and each carries a subset of the classes.
const covers = (wide: string, narrow: string) => {
  if (wide === narrow) return false
  const w = compounds(wide)
  const n = compounds(narrow)
  if (!w.length || w.length > n.length) return false
  const isSubset = (a: Set<string>, b: Set<string>) => a.size > 0 && [...a].every((c) => b.has(c))
  if (!isSubset(w[w.length - 1], n[n.length - 1])) return false
  let i = n.length - 2
  for (let j = w.length - 2; j >= 0; j--) {
    while (i >= 0 && !isSubset(w[j], n[i])) i--
    if (i < 0) return false
    i--
  }
  return true
}

const conflicts = (a: string, b: string) => a === b || a.startsWith(b + '-') || b.startsWith(a + '-')

const DENSITY_PREFIX = /^:root\[data-density="(compact|roomy)"\]\s*/

/// A density rule outranks the base kit by two classes, so any base rule that
/// refines the same element with an extra class silently loses its override.
/// Every such pair has to be answered inside the density block or the modifier
/// stops existing at that density.
test('density overrides never outrank the base modifiers they cover', () => {
  const base = BASE_FILES.flatMap((f) => parse(read(f)))
  const density = parse(read(DENSITY_FILE))
  const misses: string[] = []
  for (const d of density) {
    const mode = d.selector.match(DENSITY_PREFIX)?.[1]
    if (!mode) continue
    const target = d.selector.replace(DENSITY_PREFIX, '')
    for (const b of base) {
      if (b.spec > d.spec) continue
      if (!covers(target, b.selector)) continue
      const shared = b.props.filter((p) => d.props.some((q) => conflicts(p, q)))
      if (!shared.length) continue
      const answer = `:root[data-density="${mode}"] ${b.selector}`
      const answered = density.filter((r) => r.selector === answer).flatMap((r) => r.props)
      const lost = shared.filter((p) => !answered.some((q) => conflicts(p, q)))
      if (lost.length) misses.push(`${answer} — shadowed on ${lost.join(', ')} by "${d.selector}"`)
    }
  }

  expect([...new Set(misses)].sort()).toEqual([])
})

const tsxFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : [],
  )

/// Class sets that end up on one element: `className={'card build-card' + …}`
/// means `.card` and `.build-card` compete on that node even though no selector
/// ever writes them together.
const classSets = (): Set<string>[] => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const out: Set<string>[] = []
  for (const f of tsxFiles(root)) {
    const src = readFileSync(f, 'utf8')
    const re = /className\s*=\s*(?:(["'`])((?:(?!\1).)*)\1|\{((?:[^{}]|\{[^{}]*\})*)\})/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const raw = m[2] !== undefined ? [m[2]] : [...(m[3] || '').matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map((x) => x[2])
      const set = new Set(raw.flatMap((s) => s.split(/\s+/)).filter((c) => /^[a-z][\w-]*$/.test(c)))
      if (set.size > 1) out.push(set)
    }
  }
  return out
}

/// The kit relies on source order between two classes worn by the same element
/// — `.build-card{padding:0}` after `.card{padding:20px}`. A density rule on the
/// first class jumps ahead of both and the later one silently loses.
test('density overrides never outrank a later class on the same element', () => {
  const base = BASE_FILES.flatMap((f) => parse(read(f))).map((r, i) => ({ ...r, order: i }))
  const density = parse(read(DENSITY_FILE))
  const sets = classSets()

  const misses: string[] = []
  for (const d of density) {
    const mode = d.selector.match(DENSITY_PREFIX)?.[1]
    if (!mode) continue
    const target = d.selector.replace(DENSITY_PREFIX, '')
    const cls = target.match(/^\.([\w-]+)$/)?.[1]
    if (!cls) continue
    const covered = base.filter((b) => b.selector === '.' + cls).map((b) => b.order)
    if (!covered.length) continue
    const first = Math.min(...covered)
    for (const set of sets) {
      if (!set.has(cls)) continue
      for (const other of set) {
        if (other === cls) continue
        for (const b of base) {
          if (b.selector !== '.' + other || b.order < first || b.spec > d.spec) continue
          const shared = b.props.filter((p) => d.props.some((q) => conflicts(p, q)))
          if (!shared.length) continue
          const prefix = `:root[data-density="${mode}"] `
          const answer = density
            .filter(
              (r) =>
                (r.selector === `${prefix}.${cls}.${other}` || r.selector === `${prefix}.${other}.${cls}`) ||
                (r.selector === `${prefix}.${other}` && r.order > d.order),
            )
            .flatMap((r) => r.props)
          const lost = shared.filter((p) => !answer.some((q) => conflicts(p, q)))
          if (lost.length)
            misses.push(`:root[data-density="${mode}"] .${cls}.${other} — shadowed on ${lost.join(', ')} by "${d.selector}"`)
        }
      }
    }
  }

  expect([...new Set(misses)].sort()).toEqual([])
})

/// Both densities have to move the same surfaces: a half-filled block leaves
/// half the interface drawn at the other density's scale.
test('compact and roomy cover the same components', () => {
  const density = parse(read(DENSITY_FILE))
  const targets = (mode: string) =>
    new Set(
      density
        .filter((r) => r.selector.startsWith(`:root[data-density="${mode}"]`))
        .map((r) => r.selector.replace(DENSITY_PREFIX, '')),
    )
  const compact = targets('compact')
  const roomy = targets('roomy')
  expect([...compact].filter((s) => !roomy.has(s)).sort()).toEqual([])
  expect([...roomy].filter((s) => !compact.has(s)).sort()).toEqual([])
})
