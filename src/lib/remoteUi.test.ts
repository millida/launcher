import { describe, expect, it } from 'bun:test'
import { REMOTE_UI_PUBLIC_KEY, chunksText, rewriteChunk, staticDeps, sha256Hex, signedText, verifyManifest, type RemoteUiManifest } from './remoteUi'

const b64 = (buf: ArrayBuffer) => Buffer.from(buf).toString('base64')

async function signed(over: Partial<RemoteUiManifest> = {}) {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const m: RemoteUiManifest = {
    api: 1,
    version: '0123456789abcdef',
    file: '0123456789abcdef/ui.js',
    sha256: await sha256Hex('export const x = 1'),
    css: '0123456789abcdef/ui.css',
    cssSha256: await sha256Hex(''),
    builtAt: '2026-10-20T10:00:00.000Z',
    sig: null,
    ...over,
  }
  m.sig = b64(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(signedText(m))))
  return { m, key: pair.publicKey }
}

describe('remote ui manifest', () => {
  it('signs the same text as the website build script', () => {
    const text = signedText({ api: 1, version: 'v', file: 'f', sha256: 's', css: 'c', cssSha256: 'cs', builtAt: 'b', sig: null })
    expect(text).toBe('millida-launcher-ui/1\n1\nv\nf\ns\nc\ncs\nb')
  })

  it('accepts a valid signature', async () => {
    const { m, key } = await signed()
    expect(await verifyManifest(m, key)).toBe(true)
  })

  it('rejects a changed file hash, a foreign key, a missing signature and a path outside its version', async () => {
    const { m, key } = await signed()
    expect(await verifyManifest({ ...m, sha256: '0'.repeat(64) }, key)).toBe(false)
    expect(await verifyManifest(m, (await signed()).key)).toBe(false)
    expect(await verifyManifest({ ...m, sig: null }, key)).toBe(false)
    const outside = await signed({ file: '../evil.js' })
    expect(await verifyManifest(outside.m, outside.key)).toBe(false)
  })

  it('accepts the old manifest format and refuses an unknown api', async () => {
    const old = await signed()
    expect(old.m.chunks).toBeUndefined()
    expect(await verifyManifest(old.m, old.key)).toBe(true)
    expect(signedText({ ...old.m, chunks: [] })).toBe(signedText(old.m))
    const future = await signed({ api: 2 })
    expect(await verifyManifest(future.m, future.key)).toBe(false)
  })

  it('puts every chunk hash under the signature', async () => {
    const chunks = [
      { file: '0123456789abcdef/c-a.js', sha256: 'a'.repeat(64), core: 1 as const },
      { file: '0123456789abcdef/c-b.js', sha256: 'b'.repeat(64) },
    ]
    expect(chunksText(chunks)).toBe(`0123456789abcdef/c-a.js:${'a'.repeat(64)}:1,0123456789abcdef/c-b.js:${'b'.repeat(64)}`)
    const { m, key } = await signed({ chunks })
    expect(await verifyManifest(m, key)).toBe(true)
    expect(await verifyManifest({ ...m, chunks: [chunks[0], { ...chunks[1], sha256: 'c'.repeat(64) }] }, key)).toBe(false)
    expect(await verifyManifest({ ...m, chunks: [chunks[0]] }, key)).toBe(false)
    const outside = await signed({ chunks: [{ file: '../evil.js', sha256: 'a'.repeat(64) }] })
    expect(await verifyManifest(outside.m, outside.key)).toBe(false)
  })

  it('ships a 32-byte public key', () => {
    expect(Buffer.from(REMOTE_UI_PUBLIC_KEY, 'base64').length).toBe(32)
  })
})

describe('remote ui chunks', () => {
  const known = (n: string) => n.startsWith('c-') || n === 'ui.js'

  it('finds static imports of known chunks, however the bundler spaces them', () => {
    const text = 'import { a as e } from "./c-x.js";import"./c-y.js";export * from "./ui.js";import {z} from"./other.js";const m = import("./c-lazy.js");'
    expect(staticDeps(text, known)).toEqual(['c-x.js', 'c-y.js', 'ui.js'])
  })

  it('points static imports at blob urls and routes import() through the loader', () => {
    const text = 'import { a } from "./c-x.js";\nexport const go = () => import("./c-lazy.js");\nimport("./other.js");'
    const out = rewriteChunk(text, new Map([['c-x.js', 'blob:one']]), known)
    expect(out).toContain('from "blob:one"')
    expect(out).toContain('globalThis.__MLU_CHUNK__("c-lazy.js")')
    expect(out).toContain('import("./other.js")')
  })

  it('leaves an import of a name outside the manifest alone', () => {
    const out = rewriteChunk('import { a } from "./evil.js";', new Map(), known)
    expect(out).toBe('import { a } from "./evil.js";')
  })
})

describe('site off-switch', () => {
  it('an "off" manifest sends launchers back to the built-in screens', async () => {
    const { downloadBundle } = await import('./remoteUi')
    const real = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ off: true }), { status: 200 })) as unknown as typeof fetch
    try {
      expect(await downloadBundle('https://example.invalid/launcher-ui')).toBe('off')
    } finally {
      globalThis.fetch = real
    }
  })
})
