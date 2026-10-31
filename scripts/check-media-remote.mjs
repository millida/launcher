#!/usr/bin/env bun
// Release gate for MEDIA_REMOTE=1 (docs/MEDIA.md, docs/DELTA-UPDATE.md "Media on the CDN").
//
// A build with MEDIA_REMOTE=1 leaves the music, the wallpaper clips and the Arcania page out of the installer, and the
// core downloads each object by its hash. If an object is missing from the CDN every player is left without radio,
// wallpapers and Arcania art, so the release must fail instead of shipping that.
//
//   bun scripts/check-media-remote.mjs               every object answers 200 on the CDN with the right bytes
//   bun scripts/check-media-remote.mjs --quick       only HEAD: 200 and the right Content-Length (no download)
//   bun scripts/check-media-remote.mjs --mirror      the second address (GitHub release) is required too
//   bun scripts/check-media-remote.mjs --base <url>  check this address only (a staging bucket)
//
// Exit code 0 only when every object is found at the first address (the CDN). The mirror is reported but does not fail
// the release unless --mirror is given.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { MANIFEST, objectsOf } from './media.mjs'

const TIMEOUT_MS = 60_000

/// One object at one address. Never throws: the answer says what was wrong.
export async function checkObject(base, obj, { deep = true, fetchImpl = fetch } = {}) {
  const url = base + obj.key
  try {
    const head = await fetchImpl(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (head.status !== 200) return { ok: false, why: `HTTP ${head.status}` }
    const length = Number(head.headers.get('content-length'))
    if (Number.isFinite(length) && length > 0 && length !== obj.size) return { ok: false, why: `size ${length}, the manifest says ${obj.size}` }
    if (!deep) return { ok: true }
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (res.status !== 200) return { ok: false, why: `HTTP ${res.status} on download` }
    const body = Buffer.from(await res.arrayBuffer())
    if (body.length !== obj.size) return { ok: false, why: `downloaded ${body.length} bytes, the manifest says ${obj.size}` }
    const sha = createHash('sha256').update(body).digest('hex')
    return sha === obj.sha256 ? { ok: true } : { ok: false, why: `hash ${sha.slice(0, 12)}…, the manifest says ${obj.sha256.slice(0, 12)}…` }
  } catch (e) {
    return { ok: false, why: String(e?.message ?? e) }
  }
}

/// Every object at every address, in order. `results[i]` is the list for `bases[i]`.
export async function checkAll(manifest, bases, opts = {}) {
  const objects = objectsOf(manifest)
  const results = []
  for (const base of bases) {
    const rows = []
    for (const obj of objects) rows.push({ obj, ...(await checkObject(base, obj, opts)) })
    results.push({ base, rows })
  }
  return { objects, results }
}

/// The verdict of a run: failures at the first address always fail; at the others only when `needAll`.
export function verdict(results, needAll) {
  return results.flatMap((r, i) => (i === 0 || needAll ? r.rows.filter((row) => !row.ok).map((row) => ({ base: r.base, ...row })) : []))
}

if (import.meta.main ?? process.argv[1]?.endsWith('check-media-remote.mjs')) {
  const args = process.argv.slice(2)
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const at = args.indexOf('--base')
  const bases = at >= 0 && args[at + 1] ? [args[at + 1].endsWith('/') ? args[at + 1] : args[at + 1] + '/'] : manifest.bases
  const { objects, results } = await checkAll(manifest, bases, { deep: !args.includes('--quick') })
  for (const r of results) {
    const bad = r.rows.filter((row) => !row.ok)
    console.log(`${r.base}: ${r.rows.length - bad.length}/${objects.length} objects found`)
    for (const row of bad) console.log(`  MISSING ${row.obj.key} (${row.obj.what}): ${row.why}`)
  }
  const failed = verdict(results, args.includes('--mirror'))
  if (failed.length) {
    console.error(
      `\nMEDIA_REMOTE=1 must not ship: ${failed.length} object(s) are not on the CDN. Upload them (bun scripts/media.mjs pack <dir>, docs/MEDIA.md) and run this again, or release without MEDIA_REMOTE.`,
    )
    process.exit(1)
  }
  console.log(`\nAll ${objects.length} media objects are on ${bases[0]}: MEDIA_REMOTE=1 is safe to ship.`)
}
