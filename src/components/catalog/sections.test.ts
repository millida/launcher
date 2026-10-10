import { describe, expect, it } from 'bun:test'
import { LAUNCHER_HIDDEN,
  CATALOG_GROUPS,
  CATALOG_TABS,
  SECTION_SOURCE,
  SECTION_VISUAL,
  SITE_INSTALL_SECTIONS,
  curatedTitle,
  foreignTailAllowed,
  groupOf,
  hasFeed,
  listingQuery,
  siteSectionPath,
} from './sections'
import { ALL_SECTIONS, SERVER_SECTIONS, SITE_SECTIONS, sectionBySlug } from './site'
import { INSTALL_SECTIONS, KIND_OF_SECTION } from '../../lib/millidaCatalog'
import { hasPx } from '../pxArt'

/*
 * Каталог лаунчера = каталог сайта (приказ владельца 30.09.2026). Эталон —
 * CATALOG_NAV_GROUPS из src/lib/catalog-type-tabs.ts сайта: состав и порядок
 * групп переписаны сюда дословно, тест держит их от случайной правки.
 */
const SITE_GROUPS: [string, string, [string, string][]][] = [
  ['all', 'Все', [['all', 'Все']]],
  ['packs', 'Сборки', [['modpacks', 'Сборки модов']]],
  ['mods', 'Моды', [['mods', 'Моды'], ['plugins', 'Плагины'], ['data-packs', 'Дата-паки'], ['addons', 'Аддоны']]],
  ['graphics', 'Графика', [['texture-packs', 'Ресурс-паки'], ['shaders', 'Шейдеры']]],
  ['worlds', 'Карты', [['maps', 'Карты'], ['seeds', 'Сиды']]],
  ['looks', 'Скины', [['skins', 'Скины'], ['capes', 'Плащи']]],
]

describe('группы разделов как на сайте', () => {
  it('состав, порядок и подписи совпадают с шапкой сайта', () => {
    expect(CATALOG_GROUPS.map((g) => [g.key, g.label, g.tabs.map((t) => [t.slug, t.label])])).toEqual(SITE_GROUPS)
  })

  it('у каждого раздела есть значок, цвет раздела сайта и источник ленты', () => {
    for (const t of CATALOG_TABS) {
      const v = SECTION_VISUAL[t.slug]
      expect(hasPx(v.px), t.slug + ': пиксельный значок ' + v.px).toBe(true)
      expect(v.tint).toBe('var(--m-sec-' + t.slug + ')')
      expect(SECTION_SOURCE[t.slug]).toBeDefined()
    }
  })

  it('каждый раздел описан в модели лаунчера, группа находится по разделу', () => {
    expect(ALL_SECTIONS.map((s) => s.slug).filter((s) => !LAUNCHER_HIDDEN.has(s))).toEqual(CATALOG_TABS.map((t) => t.slug))
    expect(groupOf('shaders').key).toBe('graphics')
    expect(groupOf('capes').key).toBe('looks')
    expect(groupOf('нет-такого').key).toBe('all')
  })

  it('мелкие плитки — только у того, что выбирают глазами (10.10.2026)', () => {
    const small = new Set(['texture-packs', 'shaders', 'maps', 'seeds', 'capes', 'heads'])
    for (const s of ALL_SECTIONS) expect(s.gallery).toBe(small.has(s.slug))
  })

  it('шесть разделов сборки и шесть серверных не сдвинулись', () => {
    expect(SITE_SECTIONS.map((s) => s.kind)).toEqual(['mod', 'modpack', 'resourcepack', 'shader', 'datapack', 'world'])
    expect(SERVER_SECTIONS.map((s) => s.slug)).toEqual(['modpacks', 'server-packs', 'plugins', 'mods', 'data-packs', 'maps'])
    expect(sectionBySlug('нет').slug).toBe('mods')
  })

  it('адрес раздела на сайте', () => {
    expect(siteSectionPath('skins')).toBe('/skins/katalog')
    expect(siteSectionPath('heads')).toBe('/tools/golovy')
    expect(siteSectionPath('seeds')).toBe('/seeds')
  })
})

describe('«Скачать в лаунчере» с сайта ставится в нужное место', () => {
  it('каждый раздел с кнопкой лаунчера на сайте понимает millida://install', () => {
    for (const s of SITE_INSTALL_SECTIONS) expect((INSTALL_SECTIONS as readonly string[]).includes(s), s).toBe(true)
  })

  it('папка сборки по разделу; скины и плащи — в гардероб, мимо папок', () => {
    expect(KIND_OF_SECTION).toMatchObject({
      mods: 'mod',
      modpacks: 'modpack',
      'texture-packs': 'resourcepack',
      shaders: 'shader',
      'data-packs': 'datapack',
      maps: 'world',
      cheats: 'mod',
    })
    expect(KIND_OF_SECTION.skins).toBeUndefined()
    expect(KIND_OF_SECTION.capes).toBeUndefined()
  })
})

describe('запрос листинга — те же параметры, что у сайта', () => {
  it('издание, «Для чего», цена, сортировка, страница', () => {
    const q = new URLSearchParams(
      listingQuery('maps', { edition: 'BEDROCK', use: 'friends', price: 'free', sort: 'new', page: 2, perPage: 20, q: ' замок ' }),
    )
    expect(Object.fromEntries(q)).toEqual({ section: 'maps', q: 'замок', price: 'free', edition: 'BEDROCK', use: 'friends', sort: 'new', page: '2', perPage: '20' })
  })

  it('пустые фильтры не попадают в адрес, одна буква поиска — тоже', () => {
    expect(listingQuery('all', { sort: 'recommended', page: 1, q: 'a', version: null })).toBe('section=all')
  })

  it('хвост Modrinth/CurseForge — только без Bedrock, платного и задач', () => {
    expect(foreignTailAllowed({})).toBe(true)
    expect(foreignTailAllowed({ edition: 'JAVA', price: 'free' })).toBe(true)
    expect(foreignTailAllowed({ edition: 'BEDROCK' })).toBe(false)
    expect(foreignTailAllowed({ price: 'paid' })).toBe(false)
    expect(foreignTailAllowed({ use: 'lowpc' })).toBe(false)
  })
})

describe('разделы без своей ленты', () => {
  it('сиды, головы, плащи ведут на сайт или в гардероб', () => {
    expect(['seeds', 'heads', 'capes'].every((s) => !hasFeed(s as never))).toBe(true)
    expect(hasFeed('skins')).toBe(true)
    expect(hasFeed('cheats')).toBe(true)
  })

  it('название чита из адреса', () => {
    expect(curatedTitle('meteor-client')).toBe('Meteor Client')
    expect(curatedTitle('wurst')).toBe('Wurst')
  })
})
