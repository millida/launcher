// Screens shipped from the website: millida.net/launcher-ui serves a signed JS/CSS bundle built from the
// millida-web repo. Network: only GET of the manifest and two files from that folder, nothing is sent.
// Disk: the last verified bundle is kept in IndexedDB so a screen opens instantly and offline.
// Code runs only after the Ed25519 signature and the sha256 of every file match; a bundle that crashes is skipped.
// The module is split: the core (ui.js and the chunks it imports statically) is fetched with the manifest, every
// other chunk (a hosting section, the server wizard...) on first use. All chunk hashes sit under the signature.
import * as React from 'react'
import * as ReactJsx from 'react/jsx-runtime'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import type { RemoteUiBridge } from './remoteUiRules'

export const REMOTE_UI_API = 1
// Public half of the signing key (raw Ed25519, base64). The private key never leaves the site's CI.
export const REMOTE_UI_PUBLIC_KEY = 'TgYsbCG1NTtZWwyTeaj2dozeEUWkBxqgNmbhrr9frjE='
const MANIFEST_TAG = 'millida-launcher-ui/1'
const FLAG_KEY = 'm-remote-ui'
const BAD_KEY = 'm-remote-ui-bad'

export const REMOTE_UI_BASE: string =
  (import.meta.env.DEV && typeof localStorage !== 'undefined' && localStorage.getItem('m-ui-base')) ||
  (import.meta.env.DEV ? '/mlu-site/launcher-ui' : 'https://millida.net/launcher-ui')

export interface RemoteUiChunk {
  file: string
  sha256: string
  /** Statically imported by ui.js: fetched together with the manifest. */
  core?: 1
}

export interface RemoteUiManifest {
  api: number
  version: string
  file: string
  sha256: string
  css: string
  cssSha256: string
  builtAt: string
  chunks?: RemoteUiChunk[]
  sig: string | null
}

export interface RemoteUiBundle {
  manifest: RemoteUiManifest
  js: string
  css: string
}

export interface RemoteUiModule {
  UI_API: number
  screens: Record<string, unknown>
  mount: (el: HTMLElement, bridge: RemoteUiBridge, opts: { screen: string; onReady?: () => void }) => { unmount: () => void }
}

export function remoteUiEnabled(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === '1'
  } catch {
    return false
  }
}

export function chunksText(chunks: RemoteUiChunk[] | undefined): string {
  return (chunks ?? []).map((c) => `${c.file}:${c.sha256}${c.core ? ':1' : ''}`).join(',')
}

export function signedText(m: RemoteUiManifest): string {
  const base = [MANIFEST_TAG, m.api, m.version, m.file, m.sha256, m.css, m.cssSha256, m.builtAt]
  // A manifest without chunks is signed byte for byte as before; chunk hashes are appended only when there are any.
  if (m.chunks && m.chunks.length) base.push(chunksText(m.chunks))
  return base.join('\n')
}

const CHUNK_NAME = /^[\w.-]+\.(?:js|css)$/

export function chunkName(m: RemoteUiManifest, c: RemoteUiChunk): string {
  return c.file.slice(m.version.length + 1)
}

const b64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

let verifyKey: Promise<CryptoKey | null> | null = null

function publicKey(): Promise<CryptoKey | null> {
  verifyKey ??= crypto.subtle
    .importKey('raw', b64(REMOTE_UI_PUBLIC_KEY), { name: 'Ed25519' }, false, ['verify'])
    .catch(() => null)
  return verifyKey
}

export async function verifyManifest(m: RemoteUiManifest, key?: CryptoKey | null): Promise<boolean> {
  if (!m || m.api !== REMOTE_UI_API || typeof m.sig !== 'string' || !/^[0-9a-f]{16}$/.test(m.version)) return false
  if (!m.file.startsWith(m.version + '/') || !m.css.startsWith(m.version + '/')) return false
  if (m.chunks !== undefined) {
    if (!Array.isArray(m.chunks)) return false
    for (const c of m.chunks) {
      if (!c || typeof c.file !== 'string' || !/^[0-9a-f]{64}$/.test(c.sha256) || !c.file.startsWith(m.version + '/') || !CHUNK_NAME.test(chunkName(m, c))) return false
    }
  }
  const k = key === undefined ? await publicKey() : key
  if (!k) return false
  try {
    return await crypto.subtle.verify({ name: 'Ed25519' }, k, b64(m.sig), new TextEncoder().encode(signedText(m)))
  } catch {
    return false
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

function badVersions(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(BAD_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export async function bundleOk(b: RemoteUiBundle | null | undefined): Promise<boolean> {
  if (!b || !b.manifest || typeof b.js !== 'string' || typeof b.css !== 'string') return false
  if (badVersions().includes(b.manifest.version)) return false
  if (!(await verifyManifest(b.manifest))) return false
  const [js, css] = await Promise.all([sha256Hex(b.js), sha256Hex(b.css)])
  if (js !== b.manifest.sha256 || css !== b.manifest.cssSha256) return false
  // The core chunks must be on disk too; a missing one means the cache is incomplete, so the bundle is fetched again.
  for (const c of coreChunks(b.manifest)) if ((await cachedChunk(c)) === null) return false
  return true
}

function coreChunks(m: RemoteUiManifest): RemoteUiChunk[] {
  return (m.chunks ?? []).filter((c) => c.core)
}

const DB_NAME = 'millida-remote-ui'
const STORE = 'kv'
let opening: Promise<IDBDatabase | null> | null = null

function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return opening
}

async function idbGet<T>(key: string): Promise<T | null> {
  const d = await db()
  if (!d) return null
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as T) ?? null)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function idbSet(entries: Record<string, unknown>): Promise<void> {
  const d = await db()
  if (!d) return
  await new Promise<void>((resolve) => {
    try {
      const tx = d.transaction(STORE, 'readwrite')
      for (const [k, v] of Object.entries(entries)) {
        if (v === undefined) tx.objectStore(STORE).delete(k)
        else tx.objectStore(STORE).put(v, k)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch {
      resolve()
    }
  })
}

async function idbKeys(): Promise<string[]> {
  const d = await db()
  if (!d) return []
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).filter((k): k is string => typeof k === 'string'))
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

const chunkKey = (c: RemoteUiChunk) => 'chunk:' + c.sha256

// A chunk text from disk, only if its hash still matches. Content-addressed: unchanged chunks survive an update.
async function cachedChunk(c: RemoteUiChunk): Promise<string | null> {
  const t = await idbGet<string>(chunkKey(c))
  return typeof t === 'string' && (await sha256Hex(t)) === c.sha256 ? t : null
}

async function fetchChunk(base: string, c: RemoteUiChunk): Promise<string> {
  const t = await fetchText(base + '/' + c.file)
  if ((await sha256Hex(t)) !== c.sha256) throw new Error('chunk hash mismatch ' + c.file)
  return t
}

// Disk first, then the network; a fresh download is written to disk for the next time.
async function chunkText(c: RemoteUiChunk, base = REMOTE_UI_BASE): Promise<string> {
  const hit = await cachedChunk(c)
  if (hit !== null) return hit
  const t = await fetchChunk(base, c)
  void idbSet({ [chunkKey(c)]: t })
  return t
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(url + ' ' + r.status)
  return r.text()
}

export async function downloadBundle(base = REMOTE_UI_BASE, known?: string): Promise<RemoteUiBundle | 'same' | null> {
  try {
    const manifest = JSON.parse(await fetchText(base + '/manifest.json', { cache: 'no-cache' })) as RemoteUiManifest
    if (known && manifest.version === known) return 'same'
    if (!(await verifyManifest(manifest))) return null
    if (badVersions().includes(manifest.version)) return null
    const [js, css] = await Promise.all([fetchText(base + '/' + manifest.file), fetchText(base + '/' + manifest.css)])
    const b = { manifest, js, css }
    const [jsSha, cssSha] = await Promise.all([sha256Hex(js), sha256Hex(css)])
    if (jsSha !== manifest.sha256 || cssSha !== manifest.cssSha256) return null
    await Promise.all(coreChunks(manifest).map((c) => chunkText(c, base)))
    return b
  } catch (e) {
    console.warn('[remote-ui] download', e)
    return null
  }
}

let refreshing: Promise<RemoteUiBundle | null> | null = null

// The new bundle becomes current for the next opening; the running one is kept as the fallback.
export function refreshRemoteUi(current?: RemoteUiBundle | null): Promise<RemoteUiBundle | null> {
  refreshing ??= downloadBundle(REMOTE_UI_BASE, current?.manifest.version)
    .then(async (b) => {
      if (!b || b === 'same') return null
      await idbSet({ current: b, prev: current ?? undefined })
      void collectChunks([b.manifest, current?.manifest])
      return b
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

// Chunks of the new and the previous version stay on disk; everything else goes.
async function collectChunks(keep: Array<RemoteUiManifest | undefined>): Promise<void> {
  const keys = new Set(keep.flatMap((m) => (m?.chunks ?? []).map(chunkKey)))
  const stale = (await idbKeys()).filter((k) => k.startsWith('chunk:') && !keys.has(k))
  if (stale.length) await idbSet(Object.fromEntries(stale.map((k) => [k, undefined])))
}

const loaded = new Map<string, Promise<RemoteUiModule>>()

function shareReact() {
  const g = globalThis as unknown as { __MILLIDA_UI_SHARED__?: Record<string, unknown> }
  g.__MILLIDA_UI_SHARED__ ??= Object.freeze({
    react: React,
    'react/jsx-runtime': ReactJsx,
    'react-dom': ReactDOM,
    'react-dom/client': ReactDOMClient,
  })
}

function applyCss(version: string, css: string) {
  let el = document.getElementById('mlu-css') as HTMLStyleElement | null
  if (el && el.dataset.version === version) return
  if (!el) {
    el = document.createElement('style')
    el.id = 'mlu-css'
    document.head.appendChild(el)
  }
  el.dataset.version = version
  el.textContent = css
}

export const STATIC_IMPORT = /\b(from|import)\s*(["'])\.\/([\w.-]+\.js)\2/g
const DYNAMIC_IMPORT = /\bimport\(\s*(["'])\.\/([\w.-]+\.js)\1\s*\)/g

/** Static names a chunk needs, relative `from "./x.js"` / `import "./x.js"` only. */
export function staticDeps(text: string, known: (name: string) => boolean): string[] {
  return [...new Set([...text.matchAll(STATIC_IMPORT)].map((x) => x[3]).filter(known))]
}

/** Points static imports at the blob URLs of verified chunks and routes import() through the loader. */
export function rewriteChunk(text: string, urls: Map<string, string>, known: (name: string) => boolean): string {
  return text
    .replace(STATIC_IMPORT, (all, kw: string, q: string, n: string) => (urls.has(n) ? `${kw} ${q}${urls.get(n)}${q}` : all))
    .replace(DYNAMIC_IMPORT, (all, _q: string, n: string) => (known(n) ? `globalThis.__MLU_CHUNK__(${JSON.stringify(n)})` : all))
}

declare global {
  // eslint-disable-next-line no-var
  var __MLU_CHUNK__: ((name: string) => Promise<unknown>) | undefined
}

// Chunks reference each other by relative names, which mean nothing inside a blob URL. Every chunk is verified,
// its static imports are pointed at the blob URLs of the (verified) chunks they need, and its import() calls are
// routed through __MLU_CHUNK__, which fetches a chunk on first use. The core blob URLs stay alive on purpose:
// a chunk that imports the same URL gets the same module instance.
export function makeChunkLoader(b: RemoteUiBundle, base = REMOTE_UI_BASE) {
  const m = b.manifest
  const known = new Map((m.chunks ?? []).map((c) => [chunkName(m, c), c]))
  const urls = new Map<string, Promise<string>>()
  const mods = new Map<string, Promise<unknown>>()
  let ext: Promise<void> | null = null

  const textOf = async (name: string): Promise<string> => {
    if (name === 'ui.js') return b.js
    const c = known.get(name)
    if (!c || !name.endsWith('.js')) throw new Error('unknown chunk ' + name)
    return chunkText(c, base)
  }

  const urlOf = (name: string): Promise<string> => {
    let p = urls.get(name)
    if (!p) {
      p = (async () => {
        const text = await textOf(name)
        const deps = staticDeps(text, (n) => known.has(n))
        const depUrls = new Map(await Promise.all(deps.map(async (n) => [n, await urlOf(n)] as const)))
        const code = rewriteChunk(text, depUrls, (n) => known.has(n))
        return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
      })()
      urls.set(name, p)
      p.catch(() => urls.delete(name))
    }
    return p
  }

  // Styles for lazy chunks come as one more verified file, applied before the first chunk runs.
  const extCss = (): Promise<void> => {
    ext ??= (async () => {
      const c = known.get('ui-ext.css')
      if (!c) return
      const css = await chunkText(c, base)
      let el = document.getElementById('mlu-css-ext') as HTMLStyleElement | null
      if (!el) {
        el = document.createElement('style')
        el.id = 'mlu-css-ext'
        document.head.appendChild(el)
      }
      el.textContent = css
    })()
    ext.catch(() => (ext = null))
    return ext
  }

  const load = (name: string): Promise<unknown> => {
    let p = mods.get(name)
    if (!p) {
      p = (async () => {
        await extCss()
        // The URL is awaited outside import(): Vite wraps import() in a plain arrow for preloading, where await is a parse error.
        const url = await urlOf(name)
        // Runs website code inside the launcher window. Only verified text gets here.
        return import(/* @vite-ignore */ url)
      })()
      mods.set(name, p)
      p.catch(() => mods.delete(name))
    }
    return p
  }

  return { load, urlOf }
}

function importBundle(b: RemoteUiBundle): Promise<RemoteUiModule> {
  const v = b.manifest.version
  let p = loaded.get(v)
  if (!p) {
    shareReact()
    const loader = makeChunkLoader(b)
    globalThis.__MLU_CHUNK__ = loader.load
    // Runs website code inside the launcher window. Only bundles that passed bundleOk/downloadBundle get here.
    p = loader.urlOf('ui.js').then((url) => import(/* @vite-ignore */ url) as Promise<RemoteUiModule>)
    loaded.set(v, p)
    p.catch(() => loaded.delete(v))
  }
  applyCss(v, b.css)
  return p.then((m) => {
    if (m.UI_API !== REMOTE_UI_API || typeof m.mount !== 'function') throw new Error('remote ui api mismatch')
    return m
  })
}

export interface RemoteUiLoad {
  module: RemoteUiModule
  version: string
  source: 'disk' | 'network'
}

// From disk at once (refreshing in the background) or, with an empty cache, from the network. null = use the built-in screen.
export async function loadRemoteUi(): Promise<RemoteUiLoad | null> {
  let current = await idbGet<RemoteUiBundle>('current')
  if (!(await bundleOk(current))) {
    const prev = await idbGet<RemoteUiBundle>('prev')
    current = (await bundleOk(prev)) ? prev : null
    if (current) void idbSet({ current, prev: undefined })
  }
  let source: RemoteUiLoad['source'] = 'disk'
  if (current) void refreshRemoteUi(current)
  else {
    source = 'network'
    current = await refreshRemoteUi(null)
  }
  if (!current) return null
  const module = await importBundle(current)
  return { module, version: current.manifest.version, source }
}

// A bundle that failed to start is never taken again; the previous one comes back.
export async function markRemoteUiBad(version: string): Promise<void> {
  try {
    localStorage.setItem(BAD_KEY, JSON.stringify([...badVersions(), version].slice(-20)))
  } catch {
    // no localStorage: the bundle will simply be retried
  }
  const current = await idbGet<RemoteUiBundle>('current')
  if (current?.manifest.version === version) {
    const prev = await idbGet<RemoteUiBundle>('prev')
    await idbSet({ current: prev ?? undefined, prev: undefined })
  }
}
