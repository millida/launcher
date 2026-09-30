import { expect, test } from 'bun:test'
import {
  accessState,
  buyLabel,
  isPaid,
  livePriceKopecks,
  paidVerdict,
  pickFile,
  priceTag,
  purchasesFrom,
  sectionOfType,
  shortfallKopecks,
  verdictText,
} from './paid'
import type { CatalogFile } from './paid'

test('цена на строке: разово, подписка, бесплатно', () => {
  expect(priceTag('ONE_TIME', 30000)).toBe('300 ₽')
  expect(priceTag('SUBSCRIPTION', 25900)).toBe('259 ₽/мес')
  expect(priceTag('ONE_TIME', 129050)).toBe('1 290,50 ₽')
  expect(priceTag('FREE', 30000)).toBe('')
  expect(priceTag('ONE_TIME', 0)).toBe('')
  expect(priceTag(undefined, null)).toBe('')
  expect(isPaid('SUBSCRIPTION', 100)).toBe(true)
  expect(buyLabel('SUBSCRIPTION')).toBe('Подписаться')
  expect(buyLabel('ONE_TIME')).toBe('Купить')
})

test('доступ и живая цена — как на сайте', () => {
  expect(accessState({ hasAccess: true })).toBe('open')
  expect(accessState({ hasAccess: false, isOwner: true })).toBe('open')
  expect(accessState({ hasAccess: false })).toBe('locked')
  expect(accessState(null)).toBe('locked')
  expect(livePriceKopecks({ pricing: 'ONE_TIME', priceKopecks: 35000 })).toBe(35000)
  expect(livePriceKopecks({ pricing: 'FREE', priceKopecks: 35000 })).toBe(null)
  expect(livePriceKopecks({ pricing: 'ONE_TIME', priceKopecks: 1.5 })).toBe(null)
  expect(shortfallKopecks(30000, 12000)).toBe(18000)
  expect(shortfallKopecks(30000, 50000)).toBe(0)
  expect(shortfallKopecks(30000, null)).toBe(null)
})

test('отказы: строка ядра и код браузера дают один вердикт', () => {
  expect(paidVerdict('http 401').kind).toBe('login')
  expect(paidVerdict(new Error('unauthorized')).kind).toBe('login')
  expect(paidVerdict('Не хватает денег на балансе').kind).toBe('funds')
  expect(paidVerdict(new Error('http 402')).kind).toBe('funds')
  expect(paidVerdict('Цена изменилась').kind).toBe('price-changed')
  expect(paidVerdict('Файл доступен после покупки').kind).toBe('no-access')
  expect(paidVerdict('http 403').kind).toBe('no-access')
  expect(paidVerdict('pack-access: Сборка доступна по подписке — оформите её в лаунчере или на millida.net').kind).toBe('no-access')
  expect(paidVerdict('Доступ уже есть').kind).toBe('owned')
  expect(paidVerdict('Баланс заморожен — оплата недоступна').kind).toBe('frozen')
  expect(paidVerdict('Покупка уже идёт').kind).toBe('busy')
  const other = paidVerdict('Материал не продаётся')
  expect(other).toEqual({ kind: 'error', raw: 'Материал не продаётся' })
  expect(verdictText(other)).toBe(null)
  expect(verdictText({ kind: 'funds' })).toBe('Не хватает денег на балансе')
  expect(verdictText({ kind: 'no-access' })).toBe('Сначала купи — потом установка')
})

const f = (id: string, gv: string[], loaders: string[], at: string | null): CatalogFile => ({
  id,
  version: id,
  gameVersions: gv,
  loaders,
  fileName: id + '.jar',
  size: 1,
  sha1: null,
  releasedAt: at,
})

test('файл под сборку: свежий под версию и загрузчик', () => {
  const files = [
    f('old-fabric', ['1.20.1'], ['fabric'], '2026-01-01T00:00:00Z'),
    f('new-forge', ['1.20.1'], ['forge'], '2026-05-01T00:00:00Z'),
    f('new-fabric', ['1.20.1', '1.20.2'], ['fabric'], '2026-04-01T00:00:00Z'),
    f('newest-121', ['1.21.1'], ['fabric'], '2026-09-01T00:00:00Z'),
  ]
  expect(pickFile(files, { version: '1.20.1', loader: 'fabric' }, 'mod')!.file.id).toBe('new-fabric')
  expect(pickFile(files, { version: '1.20.1', loader: 'quilt' }, 'mod')!.file.id).toBe('new-fabric')
  expect(pickFile(files, { version: '1.20.1', loader: 'forge' }, 'mod')!.file.id).toBe('new-forge')
  const miss = pickFile(files, { version: '1.19.2', loader: 'fabric' }, 'mod')!
  expect(miss.fits).toBe(false)
  expect(miss.file.id).toBe('newest-121')
  expect(miss.versions).toContain('1.21.1')
  // Ресурс-паку загрузчик сборки не важен.
  expect(pickFile([f('rp', ['1.20.1'], ['minecraft'], null)], { version: '1.20.1', loader: 'forge' }, 'resourcepack')!.fits).toBe(true)
  expect(pickFile([], { version: '1.20.1', loader: 'fabric' }, 'mod')).toBe(null)
  expect(pickFile(files, null, 'mod')!.file.id).toBe('newest-121')
})

test('покупки: без возвратов, истёкших и подборок, по одной на материал', () => {
  const now = Date.parse('2026-09-30T00:00:00Z')
  const rows = purchasesFrom(
    [
      { id: '1', item: { slug: 'arcania', title: 'Arcania', type: 'MODPACK', iconUrl: null }, kind: 'SUBSCRIPTION', status: 'SPENT', amountKopecks: 25900, accessUntil: '2026-10-30T00:00:00Z' },
      { id: '2', item: { slug: 'arcania', title: 'Arcania', type: 'MODPACK', iconUrl: null }, kind: 'SUBSCRIPTION', status: 'SETTLED', accessUntil: '2026-08-30T00:00:00Z' },
      { id: '3', item: { slug: 'cool-mod', title: 'Cool', type: 'MOD', iconUrl: 'https://x/i.png' }, kind: 'ONE_TIME', status: 'SETTLED', accessUntil: null },
      { id: '4', item: { slug: 'gone', title: 'Gone', type: 'MOD' }, status: 'REFUNDED' },
      { id: '5', item: { slug: 'mcsborki', title: 'Все сборки', type: 'BUNDLE' }, status: 'SPENT' },
      { id: '6', item: { slug: 'old', title: 'Old', type: 'SHADER' }, status: 'SPENT', accessUntil: '2026-01-01T00:00:00Z' },
    ],
    now,
  )
  expect(rows.map((r) => r.slug)).toEqual(['arcania', 'cool-mod'])
  expect(rows[1]!.iconUrl).toBe('https://x/i.png')
  expect(purchasesFrom({ nope: 1 })).toEqual([])
  expect(sectionOfType('TEXTURE_PACK')).toBe('texture-packs')
  expect(sectionOfType('PLUGIN')).toBe(null)
})
