import { describe, expect, it } from 'bun:test'
import {
  CHEATS,
  FALLBACK_BLOCKS,
  SERVER_TINTS,
  blockFor,
  cheatBody,
  cheatName,
  cmpGameVersion,
  defaultPick,
  filesFor,
  loaderOptions,
  serverTint,
  sizeLabel,
  spanOf,
  versionOptions,
} from './itemView'
import type { VerFile } from './itemView'
import { readdirSync } from 'node:fs'

const f = (id: string, gameVersions: string[], loaders: string[]): VerFile => ({ id, name: id, gameVersions, loaders, size: 1000, date: null })

const FILES = [
  f('a', ['26.2', '1.21.11'], ['fabric', 'quilt']),
  f('b', ['1.21.1'], ['fabric']),
  f('c', ['1.21.1'], ['neoforge']),
  f('d', ['1.20.1', '24w14potato'], ['forge']),
]

describe('версии игры', () => {
  it('сортирует от новой к старой по числам, а не по строке', () => {
    expect(['1.21.9', '26.2', '1.21.10', '1.8'].sort(cmpGameVersion)).toEqual(['26.2', '1.21.10', '1.21.9', '1.8'])
  })
  it('снапшоты — после релизов и прячутся, если релизы есть', () => {
    expect(versionOptions(FILES)).toEqual(['26.2', '1.21.11', '1.21.1', '1.20.1'])
    expect(versionOptions([f('x', ['24w14potato'], [])])).toEqual(['24w14potato'])
  })
  it('диапазон «старая — новая» в любом порядке входа', () => {
    expect(spanOf(['1.21.1', '26.2', '1.16.5'])).toBe('1.16.5 — 26.2')
    expect(spanOf(['1.20.1'])).toBe('1.20.1')
    expect(spanOf([])).toBeNull()
  })
})

describe('выбор версии и загрузчика', () => {
  it('загрузчики — только под выбранную версию, без «minecraft»', () => {
    expect(loaderOptions(FILES, '1.21.1')).toEqual(['fabric', 'neoforge'])
    expect(loaderOptions([f('r', ['1.21'], ['minecraft'])], '1.21')).toEqual([])
  })
  it('файлы сужаются версией и загрузчиком', () => {
    expect(filesFor(FILES, '1.21.1', 'neoforge').map((x) => x.id)).toEqual(['c'])
    expect(filesFor(FILES, '1.21.1', null).map((x) => x.id)).toEqual(['b', 'c'])
    expect(filesFor(FILES, null, null)).toHaveLength(4)
  })
  it('сначала — версия и загрузчик сборки, если под неё есть файл', () => {
    expect(defaultPick(FILES, { version: '1.21.1', loader: 'neoforge' })).toEqual({ version: '1.21.1', loader: 'neoforge' })
  })
  it('сборка без подходящего файла — самая свежая версия, загрузчик сборки, если он есть', () => {
    expect(defaultPick(FILES, { version: '1.12.2', loader: 'quilt' })).toEqual({ version: '26.2', loader: 'quilt' })
    expect(defaultPick(FILES, null)).toEqual({ version: '26.2', loader: 'fabric' })
    expect(defaultPick([], null)).toEqual({ version: null, loader: null })
  })
})

describe('заглушки', () => {
  it('блок один и тот же для одного slug и из набора', () => {
    expect(blockFor('wurst')).toBe(blockFor('wurst'))
    expect(FALLBACK_BLOCKS).toContain(blockFor('meteor-client'))
    expect(SERVER_TINTS).toContain(serverTint('mc.example.net'))
  })
  it('разные slug дают не один блок на всех', () => {
    const got = new Set(['wurst', 'meteor-client', 'baritone', 'liquidbounce', 'kami-blue', 'forgehax', 'bleachhack'].map(blockFor))
    expect(got.size).toBeGreaterThan(3)
  })
  it('каждый блок заглушки есть в public/block-icons', () => {
    const have = new Set(readdirSync('public/block-icons'))
    for (const n of FALLBACK_BLOCKS) expect(have.has('Block' + n + 'Millida.png')).toBe(true)
  })
})

describe('читы', () => {
  it('имя из справочника, иначе из slug', () => {
    expect(cheatName('meteor-client')).toBe('Meteor Client')
    expect(cheatName('some-new-client')).toBe('Some New Client')
  })
  it('у каждого чита справочника есть описание, функции и официальный адрес', () => {
    for (const [slug, c] of Object.entries(CHEATS)) {
      expect(c.summary.length).toBeGreaterThan(40)
      expect(c.features.length).toBeGreaterThan(0)
      expect(c.officialUrl.startsWith('https://')).toBe(true)
      expect(cheatBody(slug)).toContain('## Что умеет')
    }
    expect(cheatBody('unknown')).toBe('')
  })
})

describe('размер файла', () => {
  it('КБ и МБ по-русски', () => {
    expect(sizeLabel(2048)).toBe('2 КБ')
    expect(sizeLabel(2.5 * 1024 * 1024)).toBe('2,5 МБ')
    expect(sizeLabel(0)).toBe('')
  })
})
