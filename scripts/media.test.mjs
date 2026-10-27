import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MANIFEST, MEDIA, bundleOf, build, crc32, render, storedZip } from './media.mjs'

// Читает zip, который мы сами написали: оглавление, имена и контрольные суммы. Если бы писатель ошибся,
// лаунчер получил бы пакет, который не распаковывается, а хеш в манифесте всё равно бы сошёлся.
function readStoredZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const out = {}
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50)
    const crc = buf.readUInt32LE(at + 16)
    const size = buf.readUInt32LE(at + 24)
    const nameLen = buf.readUInt16LE(at + 28)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    expect(buf.readUInt32LE(local)).toBe(0x04034b50)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + size)
    expect(crc32(data)).toBe(crc)
    out[name] = data
    at += 46 + nameLen
  }
  return out
}

test('пакет читается обратно, одни и те же файлы дают одни и те же байты в любом порядке', () => {
  const a = [
    { name: 'b/two.webp', data: Buffer.from('222') },
    { name: 'a/один.webp', data: Buffer.from('1') },
    { name: 'c/empty.webp', data: Buffer.alloc(0) },
  ]
  const zip = storedZip(a)
  expect(zip.equals(storedZip([...a].reverse()))).toBe(true)
  const back = readStoredZip(zip)
  expect(Object.keys(back).sort()).toEqual(['a/один.webp', 'b/two.webp', 'c/empty.webp'])
  expect(back['b/two.webp'].toString()).toBe('222')
  expect(back['c/empty.webp'].length).toBe(0)
})

test('какие файлы едут пакетом, а какие по одному', () => {
  expect(bundleOf('packs/arcania/boss-malora.webp')).toBe('arcania-art')
  expect(bundleOf('packs/arcania/world/places/61.webp')).toBe('arcania-art')
  expect(bundleOf('packs/arcania/guide.mp4')).toBeNull()
  expect(bundleOf('packs/arcania/skill-tree.webm')).toBeNull()
  expect(bundleOf('music/01-starlight-city.mp3')).toBeNull()
  expect(bundleOf('bg/bg1.mp4')).toBeNull()
})

test('манифест собирается из временной папки, а пакет — из файлов пакета', () => {
  const dir = mkdtempSync(join(tmpdir(), 'media-test-'))
  try {
    mkdirSync(join(dir, 'music'), { recursive: true })
    mkdirSync(join(dir, 'packs/arcania/world'), { recursive: true })
    writeFileSync(join(dir, 'music/a.mp3'), 'AAAA')
    writeFileSync(join(dir, 'packs/arcania/x.webp'), 'xx')
    writeFileSync(join(dir, 'packs/arcania/world/y.webp'), 'yyy')
    writeFileSync(join(dir, 'packs/arcania/clip.mp4'), 'cccc')
    writeFileSync(join(dir, 'manifest.json'), '{}')
    const { manifest, zips } = build(dir)
    expect(Object.keys(manifest.files)).toEqual(['music/a.mp3', 'packs/arcania/clip.mp4', 'packs/arcania/world/y.webp', 'packs/arcania/x.webp'].sort())
    expect(manifest.files['music/a.mp3'].bundle).toBeUndefined()
    expect(manifest.files['packs/arcania/x.webp'].bundle).toBe('arcania-art')
    expect(Object.keys(readStoredZip(zips['arcania-art'])).sort()).toEqual(['packs/arcania/world/y.webp', 'packs/arcania/x.webp'])
    expect(manifest.bundles['arcania-art'].size).toBe(zips['arcania-art'].length)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('manifest.json в репозитории совпадает с файлами в media/', () => {
  if (!existsSync(MEDIA) || !existsSync(MANIFEST)) return
  const { manifest } = build()
  expect(readFileSync(MANIFEST, 'utf8')).toBe(render(manifest))
})

import { checkAll, checkObject, verdict } from './check-media-remote.mjs'
import { createHash } from 'node:crypto'
import { objectsOf } from './media.mjs'

const hex = (buf) => createHash('sha256').update(buf).digest('hex')

// A CDN in a function: path -> bytes, everything else 404.
const cdn = (files, { lie = {} } = {}) => async (url, init = {}) => {
  const path = new URL(url).pathname.split('/').pop()
  const body = files[path]
  if (!body) return new Response(null, { status: 404 })
  const bytes = lie[path] ?? body
  return init.method === 'HEAD'
    ? new Response(null, { status: 200, headers: { 'content-length': String(body.length) } })
    : new Response(bytes, { status: 200 })
}

test('17 объектов набора: вся выкладка манифеста названа так, как их просит ядро', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  const objects = objectsOf(manifest)
  expect(objects.length).toBe(17)
  expect(new Set(objects.map((o) => o.key)).size, 'имена объектов не повторяются').toBe(17)
  expect(objects.filter((o) => o.key.endsWith('.zip')).length, 'пакет Arcania один').toBe(1)
  for (const o of objects) expect(o.key).toMatch(/^[0-9a-f]{64}\.[a-z0-9]{2,5}$/)
})

test('проверка релиза: объект на месте и с теми байтами → ок; нет объекта, не тот размер, не тот хеш → отказ', async () => {
  const good = Buffer.from('music bytes')
  const obj = { key: `${hex(good)}.mp3`, sha256: hex(good), size: good.length, what: 'music/a.mp3' }
  const base = 'https://cdn.example/media/'
  expect((await checkObject(base, obj, { fetchImpl: cdn({ [obj.key]: good }) })).ok).toBe(true)
  expect((await checkObject(base, obj, { fetchImpl: cdn({}) })).why).toBe('HTTP 404')
  const short = await checkObject(base, { ...obj, size: 99 }, { fetchImpl: cdn({ [obj.key]: good }) })
  expect(short.ok).toBe(false)
  expect(short.why).toContain('size')
  // тот же размер, другие байты: HEAD этого не видит, глубокая проверка видит
  const swapped = Buffer.from('MUSIC BYTES')
  const fake = cdn({ [obj.key]: good }, { lie: { [obj.key]: swapped } })
  expect((await checkObject(base, obj, { fetchImpl: fake, deep: false })).ok, 'быстрая проверка по HEAD доверяет длине').toBe(true)
  const deep = await checkObject(base, obj, { fetchImpl: fake })
  expect(deep.ok).toBe(false)
  expect(deep.why).toContain('hash')
})

test('вердикт: отказ первого адреса валит релиз всегда, зеркала — только по требованию', async () => {
  const a = Buffer.from('aaa')
  const manifest = { bases: [], bundles: {}, files: { 'music/a.mp3': { sha256: hex(a), size: a.length } } }
  const key = `${hex(a)}.mp3`
  const fetchImpl = async (url, init) => {
    const onCdn = url.startsWith('https://cdn.example/')
    return onCdn ? cdn({ [key]: a })(url, init) : new Response(null, { status: 404 })
  }
  const { results } = await checkAll(manifest, ['https://cdn.example/media/', 'https://mirror.example/media/'], { fetchImpl })
  expect(verdict(results, false)).toEqual([])
  expect(verdict(results, true).length, 'зеркало обязательно — нет объекта на зеркале').toBe(1)
  const none = await checkAll(manifest, ['https://cdn.example/media/'], { fetchImpl: cdn({}) })
  expect(verdict(none.results, false).length, 'на CDN пусто — релиз падает').toBe(1)
})
