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
const CORE_STRING = /"((?:[^"\\]|\\.)*)"/g
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

export function extractCoreKeys() {
  const keys = new Map()
  for (const file of coreFiles(CORE)) {
    let text = readFileSync(file, 'utf8')
    const tests = text.search(/#\[cfg\(test\)\]/)
    if (tests >= 0) text = text.slice(0, tests)
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '')
      if (!CYRILLIC.test(code) || CORE_SKIP_LINE.test(code)) return
      for (const m of code.matchAll(CORE_STRING)) {
        if (!CYRILLIC.test(m[1]) || CORE_MATCHER_BEFORE.test(code.slice(0, m.index))) continue
        const key = coreKey(m[1])
        if (!/[А-Яа-яЁё]{2}/.test(key.replace(/\{\d+\}/g, ''))) continue
        if (!keys.has(key)) keys.set(key, relative(ROOT, file).replaceAll('\\', '/') + ':' + (i + 1))
      }
    })
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
