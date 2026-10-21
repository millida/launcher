import { describe, expect, it } from 'bun:test'
import { cleanTable, fetchFixes, i18nSignedText, verifyI18nManifest, type I18nManifest } from './remote'

const b64 = (buf: ArrayBuffer) => Buffer.from(buf).toString('base64')
const SHA = 'a'.repeat(64)

async function signed(over: Partial<I18nManifest> = {}) {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  const m: I18nManifest = {
    api: 1,
    builtAt: '2026-10-20T10:00:00.000Z',
    tables: { en: { file: 'i18n/en-0123456789abcdef.json', sha256: SHA }, ru: { file: 'i18n/ru-0123456789abcdef.json', sha256: SHA } },
    sig: null,
    ...over,
  }
  m.sig = b64(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(i18nSignedText(m))))
  return { m, key: pair.publicKey }
}

describe('translation fixes manifest', () => {
  it('signs the same text as the website build script', () => {
    const tables = { ru: { file: 'i18n/ru-x.json', sha256: 'r' }, en: { file: 'i18n/en-x.json', sha256: 'e' } }
    expect(i18nSignedText({ api: 1, builtAt: 'b', tables })).toBe('millida-launcher-i18n/1\n1\nb\nen:i18n/en-x.json:e\nru:i18n/ru-x.json:r')
  })

  it('accepts a valid signature and rejects any change', async () => {
    const { m, key } = await signed()
    expect(await verifyI18nManifest(m, key)).toBe(true)
    expect(await verifyI18nManifest({ ...m, tables: { ...m.tables, en: { ...m.tables.en!, sha256: 'b'.repeat(64) } } }, key)).toBe(false)
    expect(await verifyI18nManifest({ ...m, sig: null }, key)).toBe(false)
    expect(await verifyI18nManifest(m, (await signed()).key)).toBe(false)
  })

  it('rejects a table outside the i18n folder even when signed', async () => {
    const { m, key } = await signed({ tables: { en: { file: '../ui.js', sha256: SHA } } })
    expect(await verifyI18nManifest(m, key)).toBe(false)
  })
})

describe('cleanTable', () => {
  it('keeps strings whose placeholders match the key', () => {
    const raw = { 'Привет, {name}': 'Hi, {name}', 'Осталось {n} из {max}': 'Left {n}', 'Да': '', 'Нет': 7, 'Далее': 'Next' }
    expect(cleanTable(raw)).toEqual({ 'Привет, {name}': 'Hi, {name}', 'Далее': 'Next' })
  })

  it('takes nothing that is not a plain object', () => {
    expect(cleanTable(null)).toEqual({})
    expect(cleanTable(['a'])).toEqual({})
    expect(cleanTable('x')).toEqual({})
  })
})

describe('fetchFixes outside the app', () => {
  it('never reaches the network under unit tests', async () => {
    const real = globalThis.fetch
    let calls = 0
    globalThis.fetch = (() => {
      calls++
      return Promise.reject(new Error('no network in tests'))
    }) as unknown as typeof fetch
    try {
      expect(await fetchFixes('en')).toBeNull()
      expect(calls).toBe(0)
    } finally {
      globalThis.fetch = real
    }
  })
})
