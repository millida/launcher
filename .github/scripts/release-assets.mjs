import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ARTIFACTS = 'artifacts'
const ASSETS = 'assets'
const EXPECTED_TARGETS = ['x86_64-pc-windows-msvc', 'aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-unknown-linux-gnu']
const INSTALLER = /(\.exe|\.dmg|\.AppImage|\.deb|\.rpm)$/

const version = (process.env.VERSION || '').replace(/^v/, '')
const commit = process.env.COMMIT || ''
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`VERSION «${process.env.VERSION}» is not a release version`)
if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`COMMIT «${commit}» is not a full commit hash`)

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

mkdirSync(ASSETS, { recursive: true })
const taken = new Set()
const targets = {}

for (const dir of readdirSync(ARTIFACTS).filter((d) => d.startsWith('bundle-')).sort()) {
  const target = dir.slice('bundle-'.length)
  const root = join(ARTIFACTS, dir)
  const updaterPath = join(root, 'updater.json')
  if (!existsSync(updaterPath)) throw new Error(`${dir} has no updater.json`)
  const updater = JSON.parse(readFileSync(updaterPath, 'utf8'))

  const files = []
  for (const name of readdirSync(root).filter((n) => n !== 'updater.json').sort()) {
    const asset = INSTALLER.test(name) ? name : `${target}.${name}`
    if (taken.has(asset)) throw new Error(`two release assets would be named ${asset}`)
    taken.add(asset)
    const source = join(root, name)
    copyFileSync(source, join(ASSETS, asset))
    files.push({ name, asset, size: statSync(source).size, sha256: sha256(source) })
  }

  for (const { file } of [updater, ...(updater.extra || [])]) {
    if (!files.some((f) => f.name === file)) throw new Error(`${dir}: updater.json points at missing ${file}`)
  }
  targets[target] = { updater, files }
}

const missing = EXPECTED_TARGETS.filter((t) => !targets[t])
if (missing.length) throw new Error(`no bundles for ${missing.join(', ')}`)

const all = Object.values(targets).flatMap((t) => t.files)
writeFileSync(join(ASSETS, 'SHA256SUMS'), all.map((f) => `${f.sha256}  ${f.asset}`).join('\n') + '\n')
writeFileSync(join(ASSETS, 'bundles.json'), `${JSON.stringify({ version, commit, targets }, null, 2)}\n`)
console.log(all.map((f) => `${f.sha256}  ${f.asset}`).join('\n'))
