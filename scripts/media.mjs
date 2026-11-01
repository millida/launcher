#!/usr/bin/env bun
// Big media (music, wallpaper clips, the Arcania page) lives in media/ and is NOT part of the installer: the launcher
// downloads each file once, by hash, the first time the window asks for it (src-tauri/src/engine/core/media.rs).
//
//   bun scripts/media.mjs gen            rewrite media/manifest.json from the files in media/
//   bun scripts/media.mjs check          fail when manifest.json does not match the files (CI)
//   bun scripts/media.mjs pack <outDir>  write the upload set: <sha256>.<ext> for every file, <sha256>.zip for every bundle
//   bun scripts/check-media-remote.mjs   before a MEDIA_REMOTE=1 release: every object of the set answers on the CDN
//
// Until the set is uploaded the media rides inside the build (the default); MEDIA_REMOTE=1 takes it out (docs/MEDIA.md).

// Upload the set to launcher-storage.millida.net/media/ (and to the GitHub release named in `bases`). Files are named by
// their hash, so nothing is ever overwritten and an old launcher keeps finding the files it knows.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

export const ROOT = join(import.meta.dirname, '..')
export const MEDIA = join(ROOT, 'media')
export const MANIFEST = join(MEDIA, 'manifest.json')

export const BASES = ['https://launcher-storage.millida.net/media/', 'https://github.com/millida/launcher/releases/download/media/']

/// Files that travel together: many small ones that the window wants at the same moment. One bundle is one download.
/// The rest of the files are single objects. First matching rule wins; null means "not in a bundle".
export function bundleOf(name) {
  if (name.startsWith('packs/arcania/') && !/\.(mp4|webm)$/.test(name)) return 'arcania-art'
  return null
}

/// The extension the core gives a downloaded single file (media.rs `ext_of`): the name's own when it is short and
/// plain, `bin` otherwise.
export function extOf(name) {
  const ext = name.includes('.') ? name.split('.').pop() : ''
  return ext && ext.length <= 5 && /^[A-Za-z0-9]+$/.test(ext) ? ext : 'bin'
}

/// Every object of the upload set that a manifest names: a single file `<sha256>.<ext>` or a bundle `<sha256>.zip`.
/// The same names `pack` writes and the core asks the CDN for.
export function objectsOf(manifest) {
  const out = []
  for (const [name, f] of Object.entries(manifest.files ?? {})) {
    if (!f.bundle) out.push({ key: `${f.sha256}.${extOf(name)}`, sha256: f.sha256, size: f.size, what: name })
  }
  for (const [id, b] of Object.entries(manifest.bundles ?? {})) out.push({ key: `${b.sha256}.zip`, sha256: b.sha256, size: b.size, what: `@${id}` })
  return out.sort((a, b) => (a.key < b.key ? -1 : 1))
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

function* walk(dir) {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

export function listFiles(dir = MEDIA) {
  return [...walk(dir)]
    .map((p) => ({ path: p, name: relative(dir, p).replaceAll('\\', '/') }))
    .filter((f) => f.name !== 'manifest.json' && !f.name.startsWith('.'))
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/// A zip that only stores: media is already compressed, and the same input must give the same bytes on every machine
/// (names sorted, one fixed timestamp, no extra fields), or the hash in the manifest would change with the builder.
export function storedZip(entries) {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const locals = []
  const centrals = []
  let offset = 0
  for (const { name, data } of sorted) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(0, 10) // time 00:00
    local.writeUInt16LE(0x0021, 12) // date 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x0021, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(sorted.length, 8)
  end.writeUInt16LE(sorted.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

/// The manifest and the bytes of every bundle, from the files on disk.
export function build(dir = MEDIA) {
  const files = {}
  const members = new Map()
  for (const f of listFiles(dir)) {
    const data = readFileSync(f.path)
    const bundle = bundleOf(f.name)
    files[f.name] = { sha256: sha256(data), size: data.length, ...(bundle ? { bundle } : {}) }
    if (bundle) {
      if (!members.has(bundle)) members.set(bundle, [])
      members.get(bundle).push({ name: f.name, data })
    }
  }
  const bundles = {}
  const zips = {}
  for (const [id, entries] of [...members].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const zip = storedZip(entries)
    bundles[id] = { sha256: sha256(zip), size: zip.length }
    zips[id] = zip
  }
  const manifest = { v: 1, bases: BASES, bundles, files }
  return { manifest, zips }
}

export const render = (manifest) => JSON.stringify(manifest, null, 1) + '\n'

function pack(outDir, dir = MEDIA) {
  const { manifest, zips } = build(dir)
  mkdirSync(outDir, { recursive: true })
  let written = 0
  for (const [name, f] of Object.entries(manifest.files)) {
    if (f.bundle) continue
    const target = join(outDir, `${f.sha256}.${extOf(name)}`)
    writeFileSync(target, readFileSync(join(dir, name)))
    written++
  }
  for (const [id, zip] of Object.entries(zips)) {
    writeFileSync(join(outDir, `${manifest.bundles[id].sha256}.zip`), zip)
    written++
  }
  return written
}

if (import.meta.main ?? process.argv[1]?.endsWith('media.mjs')) {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'gen') {
    const { manifest } = build()
    writeFileSync(MANIFEST, render(manifest))
    console.log(`media/manifest.json: ${Object.keys(manifest.files).length} files, ${Object.keys(manifest.bundles).length} bundles`)
  } else if (cmd === 'check') {
    const { manifest } = build()
    const have = existsSync(MANIFEST) ? readFileSync(MANIFEST, 'utf8') : ''
    if (have !== render(manifest)) {
      console.error('media/manifest.json does not match the files in media/: run `bun scripts/media.mjs gen` and commit it')
      process.exit(1)
    }
    console.log('media/manifest.json matches the files')
  } else if (cmd === 'pack' && arg) {
    mkdirSync(dirname(join(arg, 'x')), { recursive: true })
    console.log(`${pack(arg)} objects written to ${arg}`)
  } else {
    console.error('usage: bun scripts/media.mjs gen | check | pack <outDir>')
    process.exit(2)
  }
}
