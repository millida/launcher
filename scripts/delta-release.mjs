#!/usr/bin/env bun
// Patch updates of the launcher (Windows). Makes, for a new release, a small patch from each of the last few releases'
// executables to the new one, signs the new executable, and adds an offer to latest.json next to the installer.
// The client side is src-tauri/src/engine/core/selfdelta.rs; the description for CI is docs/DELTA-UPDATE.md.
//
//   bun scripts/delta-release.mjs build --new <new-setup.exe> --version 2.0.280 \
//        --prev 2.0.279=<old-setup.exe> --prev 2.0.278=<old-setup.exe> ... \
//        --out artifacts/bundle-windows-x86_64/delta --url-base https://launcher-storage.millida.net/2.0.280/windows-x86_64/delta/ \
//        [--mirror-base https://github.com/millida/launcher/releases/download/v2.0.280/] [--sign-cmd 'npx @tauri-apps/cli@2.11.4 signer sign {file}']
//   bun scripts/delta-release.mjs merge --manifest v2-latest.json --offer <out>/offer.json [--platform windows-x86_64]
//
// Needs 7z (to take millida-launcher.exe out of an NSIS installer) and zstd (>= 1.5) on the machine. The signing command
// is the one the release already uses for the installer, run on the new executable; it must write <file>.sig.
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'

export const EXE_NAME = 'millida-launcher.exe'
/// A patch bigger than this share of the executable saves too little to be worth a second road.
export const MAX_PATCH_SHARE = 0.6
/// Files that are rewritten by every NSIS build and say nothing about what the release changed.
const NOISE = [/^uninstall\.exe$/i, /^\$PLUGINSDIR\//i, /^\[NSIS\]/i, /^\$\d+\//i]

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/// name -> sha256 of every file of an extracted installer, noise and the executable itself left out.
export function companions(files, exeRel) {
  const out = {}
  for (const [rel, hash] of Object.entries(files)) {
    if (rel === exeRel || NOISE.some((re) => re.test(rel))) continue
    out[rel] = hash
  }
  return out
}

/// A patch replaces only the executable. If the release also changed another file the installer lays down (a DLL, a
/// resource), the installer has to run, so no patch is offered from that older release.
export function sameCompanions(a, b) {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

/// The `delta` object of the manifest entry (selfdelta.rs `parse_offer` reads exactly this).
export function buildOffer({ exe, signature, patches, urlBase, mirrorBase }) {
  const slash = (b) => (b.endsWith('/') ? b : b + '/')
  return {
    v: 1,
    exe: { size: exe.length, sha256: sha256(exe), signature },
    patches: patches.map((p) => ({
      from: p.from,
      version: p.version,
      url: slash(urlBase) + p.file,
      size: p.size,
      sha256: p.sha256,
      ...(mirrorBase ? { mirror: slash(mirrorBase) + p.file } : {}),
    })),
  }
}

/// Puts the offer into a platform entry of latest.json; the installer fields stay as they are.
export function mergeOffer(manifest, platform, offer) {
  const entry = manifest.platforms?.[platform]
  if (!entry) throw new Error(`the manifest has no ${platform} entry`)
  return { ...manifest, platforms: { ...manifest.platforms, [platform]: { ...entry, delta: offer } } }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts })
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr || r.stdout}`)
  return r.stdout
}

function* walk(dir) {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* walk(p)
    else yield p
  }
}

/// Unpacks an NSIS installer with 7z and returns the executable's path and the hashes of everything else.
export function unpackInstaller(setup, workDir) {
  mkdirSync(workDir, { recursive: true })
  run('7z', ['x', '-y', `-o${workDir}`, setup])
  const files = {}
  let exe = null
  for (const p of walk(workDir)) {
    const rel = relative(workDir, p).replaceAll('\\', '/')
    if (rel.split('/').pop().toLowerCase() === EXE_NAME) exe = { path: p, rel }
    files[rel] = sha256(readFileSync(p))
  }
  if (!exe) throw new Error(`${EXE_NAME} is not inside ${setup}`)
  return { exePath: exe.path, exeRel: exe.rel, companions: companions(files, exe.rel) }
}

export function build(opts) {
  const { newSetup, version, prev, out, urlBase, mirrorBase, signCmd } = opts
  const work = mkdtempSync(join(tmpdir(), 'delta-'))
  try {
    mkdirSync(out, { recursive: true })
    const fresh = unpackInstaller(newSetup, join(work, 'new'))
    const exe = readFileSync(fresh.exePath)
    // The signature of the finished executable: same key, same command as the installer.
    const signed = join(work, `millida-launcher_${version}.exe`)
    copyFileSync(fresh.exePath, signed)
    run('sh', ['-c', signCmd.replaceAll('{file}', `'${signed}'`)])
    const signature = readFileSync(`${signed}.sig`, 'utf8').trim()

    const patches = []
    const skipped = []
    for (const { version: from, setup } of prev) {
      const old = unpackInstaller(setup, join(work, `old-${from}`))
      if (!sameCompanions(old.companions, fresh.companions)) {
        skipped.push(`${from}: the release also changed other installed files`)
        continue
      }
      const oldExe = readFileSync(old.exePath)
      const file = `${sha256(oldExe)}-to-${version}.zst`
      const target = join(out, file)
      run('zstd', ['-19', '--long=27', `--patch-from=${old.exePath}`, fresh.exePath, '-o', target, '-f', '-q'])
      const data = readFileSync(target)
      if (data.length > exe.length * MAX_PATCH_SHARE) {
        rmSync(target)
        skipped.push(`${from}: the patch is ${data.length} of ${exe.length} bytes, not worth it`)
        continue
      }
      patches.push({ from: sha256(oldExe), version: from, file, size: data.length, sha256: sha256(data) })
    }
    if (!patches.length) throw new Error(`no patch was made${skipped.length ? ': ' + skipped.join('; ') : ''}`)
    const offer = buildOffer({ exe, signature, patches, urlBase, mirrorBase })
    writeFileSync(join(out, 'offer.json'), JSON.stringify(offer, null, 2) + '\n')
    return { offer, skipped }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function args(argv) {
  const o = { prev: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    if (a === '--new') o.newSetup = next()
    else if (a === '--version') o.version = next()
    else if (a === '--prev') {
      const [version, setup] = next().split('=')
      o.prev.push({ version, setup })
    } else if (a === '--out') o.out = next()
    else if (a === '--url-base') o.urlBase = next()
    else if (a === '--mirror-base') o.mirrorBase = next()
    else if (a === '--sign-cmd') o.signCmd = next()
    else if (a === '--manifest') o.manifest = next()
    else if (a === '--offer') o.offer = next()
    else if (a === '--platform') o.platform = next()
    else throw new Error(`unknown argument ${a}`)
  }
  return o
}

if (import.meta.main ?? process.argv[1]?.endsWith('delta-release.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2)
  try {
    const o = args(rest)
    if (cmd === 'build') {
      for (const k of ['newSetup', 'version', 'out', 'urlBase', 'signCmd']) if (!o[k]) throw new Error(`--${k} is required`)
      const { offer, skipped } = build(o)
      for (const p of offer.patches) console.log(`patch from ${p.version}: ${p.size} bytes (exe ${offer.exe.size})`)
      for (const s of skipped) console.log(`skipped ${s}`)
    } else if (cmd === 'merge') {
      if (!o.manifest || !o.offer) throw new Error('--manifest and --offer are required')
      const merged = mergeOffer(JSON.parse(readFileSync(o.manifest, 'utf8')), o.platform || 'windows-x86_64', JSON.parse(readFileSync(o.offer, 'utf8')))
      writeFileSync(o.manifest, JSON.stringify(merged, null, 2) + '\n')
      console.log(`${o.manifest}: delta offer added to ${o.platform || 'windows-x86_64'}`)
    } else {
      console.error('usage: bun scripts/delta-release.mjs build|merge ... (see the header of the file)')
      process.exit(2)
    }
  } catch (e) {
    console.error(String(e.message || e))
    process.exit(1)
  }
}
