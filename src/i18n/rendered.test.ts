import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PL_STAGES, REPAIR_STAGES } from '../lib/launchView'
import { MILLI_STAGE_ORDER, MILLI_THINK_STEPS } from '../components/milli/MilliGlobe'
import { EXTRA_LOCALES, EXTRA_LOCALES_PUBLIC, type Locale } from './locales'
import type { Table } from './core'
import { blankTestItems } from '../../scripts/i18n-extract.mjs'

const ROOT = join(import.meta.dir, '..', '..')
const SRC = join(ROOT, 'src')
const CORE = join(ROOT, 'src-tauri', 'src')
const SKIP_DIRS = new Set(['vendor', 'i18n'])
const PUBLIC: Locale[] = ['en', ...(EXTRA_LOCALES_PUBLIC ? EXTRA_LOCALES : [])]
const table = (code: Locale): Table => JSON.parse(readFileSync(join(SRC, 'i18n', 'locales', code + '.json'), 'utf8')) as Table

function* walk(dir: string, keep: (name: string) => boolean, skip: Set<string> = new Set()): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!skip.has(name)) yield* walk(path, keep, skip)
    } else if (keep(name)) yield path
  }
}

/// Comments are blanked rather than removed, so line numbers in a report stay true.
function blankComments(src: string): string {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' '
        i++
      }
      out += '\n'
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      const end = e < 0 ? src.length : e + 2
      out += src.slice(i, end).replace(/[^\n]/g, ' ')
      i = end - 1
      continue
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1
      out += src.slice(i, j + 1)
      i = j
      continue
    }
    out += c
  }
  return out
}

function closing(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      i++
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1
      continue
    }
    if (c === '(' || c === '{' || c === '[') depth++
    else if (c === ')' || c === '}' || c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length
const escapeRe = (s: string) => s.replace(/[$]/g, '\\$')

interface Source {
  rel: string
  text: string
}

function sources(): Source[] {
  const out: Source[] = []
  for (const path of walk(SRC, (n) => /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n), SKIP_DIRS)) {
    out.push({ rel: relative(ROOT, path).replaceAll('\\', '/'), text: blankComments(readFileSync(path, 'utf8')) })
  }
  return out
}

const RAW_CYRILLIC_LITERAL = /(['"`])((?:(?!\1)[^\\]|\\.)*?[А-Яа-яЁё]{2}(?:(?!\1)[^\\]|\\.)*?)\1/g

/// Module-level constants holding Russian text that is not already passed through t(), by file.
export function russianConstants(all: Source[]): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const { rel, text } of all) {
    for (const m of text.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:new\s+(?:Set|Map)\(\s*)?([[{])/gm)) {
      const open = m.index + m[0].length - 1
      const close = closing(text, open)
      if (close < 0) continue
      const init = text.slice(open, close + 1)
      const raw = [...init.matchAll(RAW_CYRILLIC_LITERAL)].some((s) => !/(?<![\w$.])(t|tx)\(\s*$/.test(init.slice(Math.max(0, s.index - 12), s.index)))
      if (!raw) continue
      if (!found.has(rel)) found.set(rel, new Set())
      found.get(rel)!.add(m[1]!)
    }
  }
  for (let pass = 0; pass < 2; pass++)
    for (const source of all)
      for (const m of source.text.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const owner = moduleAt(source.rel, m[2]!, found)
        if (!owner) continue
        for (const item of m[1]!.split(',')) {
          const [orig, alias] = item.trim().split(/\s+as\s+/)
          if (!orig || !owner.has(orig)) continue
          if (!found.has(source.rel)) found.set(source.rel, new Set())
          found.get(source.rel)!.add(alias ?? orig)
        }
      }
  return found
}

const MODULE_EXT = ['.ts', '.tsx', '/index.ts']

function moduleAt(from: string, spec: string, byFile: Map<string, Set<string>>): Set<string> | undefined {
  const parts = from.split('/').slice(0, -1)
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  const base = parts.join('/')
  return MODULE_EXT.map((ext) => byFile.get(base + ext)).find(Boolean)
}

/// The Russian constants a file can name: its own and those it imports from the module that has them.
function visibleConstants(source: Source, byFile: Map<string, Set<string>>): Set<string> {
  const names = new Set(byFile.get(source.rel) ?? [])
  for (const m of source.text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const owner = moduleAt(source.rel, m[2]!, byFile)
    if (!owner) continue
    for (const item of m[1]!.split(',')) {
      const [orig, alias] = item.trim().split(/\s+as\s+/)
      if (orig && owner.has(orig)) names.add(alias ?? orig)
    }
  }
  return names
}

const TEXT_ATTR = /\b(title|aria-label|placeholder|alt|label|data-tip|hint|sub|caption)=$/

/// JSX that shows an element of such a constant as is: `{X.map((s) => <b>{s}</b>)}` or `{X[i]}`.
export function untranslatedConstantRenders(all: Source[]): string[] {
  const byFile = russianConstants(all)
  const hits: string[] = []
  for (const source of all) {
    const { rel, text } = source
    if (!rel.endsWith('.tsx')) continue
    for (const name of visibleConstants(source, byFile)) {
      if (!text.includes(name)) continue
      const mapRe = new RegExp('(?<![\\w$.])' + escapeRe(name) + '(?:\\.\\w+\\([^()]*\\))*\\.map\\(', 'g')
      for (const m of text.matchAll(mapRe)) {
        const open = m.index + m[0].length - 1
        const close = closing(text, open)
        if (close < 0) continue
        const body = text.slice(open + 1, close)
        const arrow = body.indexOf('=>')
        if (arrow < 0) continue
        const params = [...body.slice(0, arrow).replace(/:\s*[\w.<>[\]|' ]+/g, '').matchAll(/[A-Za-z_$][\w$]*/g)].map((p) => p[0])
        const rest = body.slice(arrow + 2)
        for (const p of params) {
          for (const u of rest.matchAll(new RegExp('\\{\\s*' + escapeRe(p) + '(?:\\.\\w+|\\[\\d+\\])?\\s*\\}', 'g'))) {
            const before = rest.slice(Math.max(0, u.index - 24), u.index)
            if (/=\s*$/.test(before) && !TEXT_ATTR.test(before.trimEnd())) continue
            hits.push(`${rel}:${lineOf(text, open + 1 + arrow + 2 + u.index)} ${name} → ${u[0]}`)
          }
        }
      }
      for (const u of text.matchAll(new RegExp('\\{\\s*' + escapeRe(name) + '(?:\\[[^\\]]+\\]|\\.\\w+)+\\s*\\}', 'g'))) {
        const before = text.slice(Math.max(0, u.index - 24), u.index)
        if (/=\s*$/.test(before) && !TEXT_ATTR.test(before.trimEnd())) continue
        hits.push(`${rel}:${lineOf(text, u.index)} ${u[0]}`)
      }
    }
  }
  return hits
}

const RAW_ERROR_VALUE = /^(String\([^()]*\)|[\w.]*\.(message|msg|reason|error)|e|err|er|error|msg|reason)$/

/// t('… {error}', { error: String(e) }) translates the sentence but leaves the core's Russian reason inside it.
export function rawErrorsInTranslations(all: Source[]): string[] {
  const hits: string[] = []
  for (const { rel, text } of all) {
    for (const m of text.matchAll(/(?<![\w$.])t\(\s*(['"`])/g)) {
      const open = m.index + m[0].indexOf('(')
      const close = closing(text, open)
      if (close < 0) continue
      const call = text.slice(open, close + 1)
      const head = /^\(\s*(['"`])(?:[^\\]|\\.)*?\1\s*,\s*/.exec(call)
      if (!head || call[head[0].length] !== '{') continue
      const varsEnd = closing(call, head[0].length)
      const vars = call.slice(head[0].length + 1, varsEnd)
      for (const part of vars.split(/,(?![^()]*\))/)) {
        const kv = /^\s*(\w+)\s*(?::\s*([\s\S]+?))?\s*$/.exec(part)
        if (!kv) continue
        const value = (kv[2] ?? kv[1]!).trim()
        if (RAW_ERROR_VALUE.test(value)) hits.push(`${rel}:${lineOf(text, m.index)} ${kv[1]}: ${value}`)
      }
    }
  }
  return hits
}

/// The webview translates a core message only as a whole line or a template with slots;
/// a Russian piece glued onto another string matches neither.
export function gluedCoreTexts(): string[] {
  const hits: string[] = []
  const GLUE = [
    /push_str\(\s*&?format!\(\s*"[^"]*[А-Яа-яЁё]/,
    /push_str\(\s*"[^"]*[А-Яа-яЁё]/,
    /\+\s*"[^"]*[А-Яа-яЁё]/,
    /\.replacen?\([^)]*"[^"]*[А-Яа-яЁё]/,
    /format!\(\s*"(\.|\s—)\s[А-Яа-яЁё]/,
    /=>\s*"(\.|\s—)\s[А-Яа-яЁё]/,
    /format!\(\s*"[^"]*[А-Яа-яЁё][^"]*\{\}\{\}/,
  ]
  for (const path of walk(CORE, (n) => n.endsWith('.rs'))) {
    const rel = relative(ROOT, path).replaceAll('\\', '/')
    blankTestItems(readFileSync(path, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '')
        if (/\b(log::|tracing::|debug!|info!|warn!|error!|trace!|eprintln!|println!)/.test(code)) return
        if (!GLUE.some((re) => re.test(code))) return
        if (NOT_SHOWN.some(([file, text]) => rel === file && code.includes(text))) return
        hits.push(`${rel}:${i + 1} ${code.trim().slice(0, 120)}`)
      })
  }
  return hits
}

/// Russian lines the core writes into files for support, never onto a screen.
const NOT_SHOWN: Array<[file: string, text: string]> = [['src-tauri/src/engine/game/launch.rs', '[показаны последние']]

describe('no Russian text reaches a non-Russian screen untranslated', () => {
  const all = sources()

  test('the scans see the code they guard', () => {
    expect(russianConstants(all).get('src/lib/launchView.ts')?.has('PL_STAGES'), 'the constant scan lost PL_STAGES: it would pass while seeing nothing').toBe(true)
    expect(all.length, 'the source walk found almost nothing').toBeGreaterThan(300)
  })

  test('constants with Russian text are rendered through t()', () => {
    expect(
      untranslatedConstantRenders(all),
      'These places put an element of a constant with Russian text straight into the interface, so an English player reads Russian (the "Запуск игры" stage on the Play button). Wrap the value in t().',
    ).toEqual([])
  })

  test('errors placed into a translated sentence are translated too', () => {
    expect(
      rawErrorsInTranslations(all),
      'A core or network error is passed raw into t(): the sentence is translated, the reason inside stays Russian. Pass tx(e) instead of String(e) or the bare field.',
    ).toEqual([])
  })

  test('the core never glues Russian pieces onto a message', () => {
    expect(
      gluedCoreTexts(),
      'These core messages are built by concatenation, so the webview finds no key or template for them and shows them in Russian. Write one format! template with {} slots instead.',
    ).toEqual([])
  })
})

describe('texts the interface takes from lists have translations', () => {
  const lists: Array<[string, readonly string[]]> = [
    ['PL_STAGES', PL_STAGES],
    ['REPAIR_STAGES', REPAIR_STAGES],
    ['MILLI_THINK_STEPS', MILLI_THINK_STEPS.map(([, text]) => text)],
    ['MILLI_STAGE_ORDER', MILLI_STAGE_ORDER.map(([, text]) => text)],
  ]
  for (const code of PUBLIC)
    test(code, () => {
      const own = table(code)
      const missing = lists.flatMap(([name, list]) => list.filter((key) => /[А-Яа-яЁё]/.test(key) && !own[key]).map((key) => `${name}: ${key}`))
      expect(missing, `${code}.json lacks launch and build stage names, so a ${code} player sees them in Russian`).toEqual([])
    })
})
