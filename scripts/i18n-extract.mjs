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

if (import.meta.main ?? process.argv[1]?.endsWith('i18n-extract.mjs')) {
  const keys = extractKeys()
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
