import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const UNKNOWN = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK')
const TYPES = { nsis: '__TAURI_BUNDLE_TYPE_VAR_NSS' }

const [dir, type] = process.argv.slice(2)
const marker = TYPES[type]
if (!dir || !marker) throw new Error(`usage: node mark-bundle-type.mjs <release dir> <${Object.keys(TYPES).join('|')}>`)

const marked = []
for (const name of readdirSync(dir)) {
  if (!name.toLowerCase().endsWith('.exe')) continue
  const path = join(dir, name)
  const data = readFileSync(path)
  const at = data.indexOf(UNKNOWN)
  if (at < 0) continue
  if (data.indexOf(UNKNOWN, at + 1) >= 0) throw new Error(`${name}: bundle type marker occurs more than once`)
  Buffer.from(marker).copy(data, at)
  writeFileSync(path, data)
  marked.push(name)
}

if (marked.length === 0) throw new Error(`no exe in ${dir} carries the bundle type marker, the updater would not know how to update it`)
for (const name of marked) console.log(name)
