import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SRC = join(ROOT, 'src')
const SKIP_DIRS = new Set(['vendor', 'i18n'])
const CALL = /(?<![\w$.])t\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* files(path)
      continue
    }
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path
  }
}

const ESCAPES = { n: '\n', t: '\t' }
const unescape = (raw) => raw.replace(/\\(.)/g, (_, c) => ESCAPES[c] ?? c)

export function extractKeys() {
  const keys = new Map()
  for (const file of files(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(CALL)) {
      const raw = m[1] ?? m[2] ?? m[3] ?? ''
      if (!raw) continue
      const key = unescape(raw)
      if (!keys.has(key)) keys.set(key, relative(ROOT, file).replaceAll('\\', '/'))
    }
  }
  return keys
}

const CORE = join(ROOT, 'src-tauri', 'src')
const CYRILLIC = /[А-Яа-яЁё]/
const CORE_SKIP_LINE = /\b(log::|tracing::|debug!|info!|warn!|error!|trace!|eprintln!|println!)/
const CORE_MATCHER_BEFORE = /(contains|starts_with|ends_with|strip_prefix|strip_suffix|find|rfind|split)\(\s*$/

function* coreFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* coreFiles(path)
    else if (name.endsWith('.rs')) yield path
  }
}

export function coreKey(literal) {
  let n = 0
  return literal
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\{\{|\}\}|\{[^{}]*\}/g, (m) => (m === '{{' ? '\u0000' : m === '}}' ? '\u0001' : '{' + n++ + '}'))
    .replace(/\u0000/g, '{')
    .replace(/\u0001/g, '}')
}

/// Skips a raw string, plain string or char literal starting at `i`; returns the index after it, or `i` if none starts there.
function skipRustLiteral(text, i) {
  const raw = /^b?r(#*)"/.exec(text.slice(i, i + 10))
  if (raw) {
    const end = text.indexOf('"' + raw[1], i + raw[0].length)
    return end < 0 ? text.length : end + 1 + raw[1].length
  }
  if (text[i] === '"') {
    let j = i + 1
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
    return j + 1
  }
  if (text[i] === "'") {
    const ch = /^'(?:\\.[^']{0,8}|[^\\'])'/.exec(text.slice(i, i + 12))
    if (ch) return i + ch[0].length
  }
  return i
}

/// A `#[cfg(test)]` item is test code wherever it sits: a test-only helper in the middle
/// of a file must not hide every message after it. Blanks the item, keeping line numbers.
export function blankTestItems(text) {
  let out = text
  const marker = /#\[cfg\(test\)\]/g
  let m
  while ((m = marker.exec(out))) {
    let i = m.index + m[0].length
    let depth = 0
    let end = out.length
    while (i < out.length) {
      const next = skipRustLiteral(out, i)
      if (next !== i) {
        i = next
        continue
      }
      const c = out[i]
      if (c === '/' && out[i + 1] === '/') {
        while (i < out.length && out[i] !== '\n') i++
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          end = i + 1
          break
        }
      } else if (c === ';' && depth === 0) {
        end = i + 1
        break
      }
      i++
    }
    out = out.slice(0, m.index) + out.slice(m.index, end).replace(/[^\n]/g, ' ') + out.slice(end)
    marker.lastIndex = end
  }
  return out
}

/// Every plain string literal of a Rust file with the place it starts. A literal may span
/// lines: a trailing backslash continues it, and such a message is one key as a whole.
function* rustStrings(text) {
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      const e = text.indexOf('*/', i + 2)
      i = e < 0 ? text.length : e + 2
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      yield { start: i, body: text.slice(i + 1, j).replace(/\\\r?\n\s*/g, '') }
      i = j + 1
      continue
    }
    const next = /[rb']/.test(c) && !/\w/.test(text[i - 1] ?? '') ? skipRustLiteral(text, i) : i
    i = next !== i ? next : i + 1
  }
}

const STATEMENT_EDGE = /[;{},](?=[^;{},]*$)/

export function extractCoreKeys() {
  const keys = new Map()
  for (const file of coreFiles(CORE)) {
    const text = blankTestItems(readFileSync(file, 'utf8'))
    for (const { start, body } of rustStrings(text)) {
      if (!CYRILLIC.test(body)) continue
      const before = text.slice(Math.max(0, start - 400), start)
      const edge = before.search(STATEMENT_EDGE)
      if (CORE_SKIP_LINE.test(edge < 0 ? before : before.slice(edge + 1))) continue
      if (CORE_MATCHER_BEFORE.test(before)) continue
      const key = coreKey(body)
      if (!/[А-Яа-яЁё]{2}/.test(key.replace(/\{\d+\}/g, ''))) continue
      if (!keys.has(key)) keys.set(key, relative(ROOT, file).replaceAll('\\', '/') + ':' + text.slice(0, start).split('\n').length)
    }
  }
  return keys
}

if (import.meta.main ?? process.argv[1]?.endsWith('i18n-extract.mjs')) {
  const keys = process.argv.includes('--core') ? extractCoreKeys() : extractKeys()
  const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null
  const sorted = [...keys.keys()].sort((a, b) => a.localeCompare(b, 'ru'))
  if (out) {
    writeFileSync(out, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
    console.log(`${sorted.length} keys -> ${out}`)
  } else {
    for (const k of sorted) console.log(k)
    console.error(`${sorted.length} keys`)
  }
}
