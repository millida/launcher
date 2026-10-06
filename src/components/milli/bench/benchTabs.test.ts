import { expect, test } from 'bun:test'
import type { MilliItem, MilliPack } from '../../../lib/milli'
import {
  activeShader,
  benchChosen,
  clampOption,
  configOf,
  jvmArgsFor,
  optionOf,
  ramAdvice,
  ramCapGb,
  ramForPack,
  ramGbFor,
  requiredTitles,
  rpTiles,
  shaderCards,
  shaderLevelOf,
} from './benchTabs'

const item = (projectId: string, extra: Partial<MilliItem> = {}): MilliItem => ({
  projectId,
  slug: projectId,
  title: projectId.toUpperCase(),
  icon: null,
  why: '',
  base: false,
  source: 'modrinth',
  ...extra,
})

const pack = (p: Partial<MilliPack> = {}): MilliPack => ({
  buildId: 'b1',
  title: 'Т',
  mcVersion: '1.20.1',
  loader: 'forge',
  mods: [item('emb', { base: true }), item('ctm-mod'), item('zomb')],
  resourcepacks: [item('rp1', { requires: ['ctm-mod', 'nope'] }), item('rp2')],
  shaders: [item('compl', { level: 'medium', dh: true })],
  shaderLoader: item('oculus', { base: true }),
  maps: [],
  links: [],
  excluded: [],
  notes: '',
  locked: { extras: false },
  ...p,
})

test('шейдер: уровень с сервера, иначе по активному, без шейдера — off', () => {
  expect(shaderLevelOf(pack({ shaderLevel: 'heavy' }))).toBe('heavy')
  expect(shaderLevelOf(pack())).toBe('medium')
  expect(shaderLevelOf(pack({ shaders: [] }))).toBe('off')
  expect(activeShader(pack({ userRemoved: ['compl'] }))).toBeNull()
})

test('карточки уровня: лестница + активный, off — пусто', () => {
  const choices = [item('mk', { level: 'light' }), item('bsl', { level: 'medium' }), item('compl', { level: 'medium' })]
  const p = pack({ shaderChoices: choices })
  expect(shaderCards(p, 'medium').map((s) => s.projectId)).toEqual(['bsl', 'compl'])
  expect(shaderCards(p, 'light').map((s) => s.projectId)).toEqual(['mk'])
  expect(shaderCards(p, 'off')).toEqual([])
  // Активного нет в лестнице — он всё равно виден первым.
  expect(shaderCards(pack({ shaderChoices: [choices[1]] }), 'medium').map((s) => s.projectId)).toEqual(['compl', 'bsl'])
})

test('РП: «нужен мод» — только известные моды, призраки убранного из changes', () => {
  const p = pack({
    changes: {
      titleRu: 'x',
      by: 'user',
      added: [],
      removed: [
        { projectId: 'rp9', title: 'Старый', tab: 'resourcepacks', by: 'user' },
        { projectId: 'zz', title: 'Мод', tab: 'mods', by: 'user' },
      ],
      changed: [],
    },
  })
  expect(requiredTitles(p.resourcepacks[0], p)).toEqual(['CTM-MOD'])
  const tiles = rpTiles(p)
  expect(tiles.map((t) => [t.item.projectId, t.removed])).toEqual([
    ['rp1', false],
    ['rp2', false],
    ['rp9', true],
  ])
})

test('ключи options.txt: белый список и клэмпы', () => {
  expect(clampOption('renderDistance', '99')).toBe('32')
  expect(clampOption('renderDistance', '1')).toBe('2')
  expect(clampOption('simulationDistance', '3')).toBe('5')
  expect(clampOption('maxFps', '500')).toBe('260')
  expect(clampOption('renderClouds', 'FAST')).toBe('fast')
  expect(clampOption('renderClouds', 'yes')).toBeNull()
  expect(clampOption('entityDistanceScaling', '0.1')).toBe('0.5')
  expect(clampOption('key_jump', '57')).toBeNull()
  expect(clampOption('difficulty', '3')).toBeNull()
  expect(clampOption('toString', '1')).toBeNull()
  expect(clampOption('renderDistance', '12abc')).toBeNull()
})

test('конфиг: умолчания без поля config и значения из пресета профиля', () => {
  const c = configOf(pack())
  expect(c.profile).toBe('balanced')
  expect(c.jvm).toBe('g1')
  expect(c.ramMb).toBe(4096)
  expect(optionOf(c, 'renderDistance')).toBe('12')
  const low = configOf(pack({ config: { profile: 'low', ramMb: 3072, jvm: 'zgc', options: { maxFps: '30' }, shaderPack: null } }))
  expect(optionOf(low, 'renderDistance')).toBe('6')
  expect(optionOf(low, 'maxFps')).toBe('30')
  expect(low.jvm).toBe('zgc')
})

test('ОЗУ: по размеру сборки, потолок по машине, подсказка «из N» только с машиной', () => {
  expect(ramForPack(30, 'low')).toBe(3072)
  expect(ramForPack(30, 'high')).toBe(4096)
  expect(ramForPack(212, 'balanced')).toBe(10240)
  expect(ramForPack(150, 'balanced', true)).toBe(10240)
  expect(ramCapGb(16384)).toBe(10)
  expect(ramCapGb(8192)).toBe(5)
  expect(ramCapGb(0)).toBe(16)
  expect(ramAdvice(6144, 16384)).toBe('Советуем 6 ГБ из 16')
  expect(ramAdvice(12288, 16384)).toBe('Советуем 10 ГБ из 16')
  expect(ramAdvice(6144, 0)).toBe('Советуем 6 ГБ')
  expect(ramGbFor(12288, 8192)).toBe(5)
  expect(ramGbFor(6144, 0)).toBe(6)
  // Совпадение с сервером: его ramMb на этой машине — ровно потолок ползунка, без «Слишком много».
  for (const [total, server] of [[16384, 9728], [8192, 4608], [32768, 19456], [6144, 3072]] as const) {
    expect(Math.round(server / 1024)).toBe(ramCapGb(total))
  }
})

test('JVM: G1 оставляем автоподбору, ZGC — флаг игрока', () => {
  expect(jvmArgsFor('g1')).toBe('')
  expect(jvmArgsFor('zgc')).toContain('-XX:+UseZGC')
})

test('установка из верстака: без убранного, один шейдер, загрузчик шейдеров, база первой', () => {
  const p = pack({
    mods: [item('zomb'), item('emb', { base: true })],
    shaders: [item('compl'), item('bsl')],
    userRemoved: ['rp2', 'zomb'],
  })
  const c = benchChosen(p)
  expect(c.mods.map((m) => m.projectId)).toEqual(['emb', 'oculus'])
  expect(c.resourcepacks.map((m) => m.projectId)).toEqual(['rp1'])
  expect(c.shaders.map((m) => m.projectId)).toEqual(['compl'])
  expect(benchChosen(pack({ shaders: [] })).mods.some((m) => m.projectId === 'oculus')).toBe(false)
})

// ─── Фаза C: размер, событие «Настраиваю графику», ключи для ядра ─────────

import { clampMilliSize, modsWord, readMilliSize, saveMilliSize } from '../MilliSizePick'
import { setupLines } from '../MilliSetup'
import { milliOptionsOf } from '../../../lib/aiInstall'

test('размер: 10–400, мусор — null, запоминание без localStorage не падает', () => {
  expect(clampMilliSize(70)).toBe(70)
  expect(clampMilliSize(3)).toBe(10)
  expect(clampMilliSize(9999)).toBe(400)
  expect(clampMilliSize('150')).toBe(150)
  expect(clampMilliSize('15o')).toBeNull()
  expect(clampMilliSize(0)).toBeNull()
  expect(clampMilliSize(null)).toBeNull()
  saveMilliSize(250)
  expect([null, 250]).toContain(readMilliSize())
  expect([modsWord(1), modsWord(23), modsWord(70), modsWord(112), modsWord(251)]).toEqual(['1 мод', '23 мода', '70 модов', '112 модов', '251 мод'])
})

test('строки «Настраиваю графику»: контракт сервера, текст, мусор', () => {
  const l = setupLines({
    buildId: 'b',
    setup: {
      profile: 'balanced',
      lines: [
        { key: 'renderDistance', ru: 'Дальность прорисовки', value: '12' },
        { key: 'entityShadows', ru: 'Тени', value: 'выкл' },
        'Память 6 ГБ',
        { ru: '' },
        42,
      ],
    },
  })
  expect(l.map((x) => [x.key, x.ru, x.value, x.px])).toEqual([
    ['renderDistance', 'Дальность прорисовки', '12', 'spyglass'],
    ['entityShadows', 'Тени', 'выкл', 'torch'],
    ['ramMb', 'Память 6 ГБ', '', 'redstone'],
  ])
  expect(setupLines({ buildId: 'b' })).toEqual([])
  expect(setupLines({ buildId: 'b', setup: { lines: 'x' } })).toEqual([])
})

test('ключи options.txt для ядра: только белый список, язык по умолчанию', () => {
  const o = milliOptionsOf({ profile: 'low', ramMb: 3072, jvm: 'g1', options: { renderDistance: '40', key_jump: '1', renderClouds: 'false' }, shaderPack: null })
  expect(o).toEqual({ renderDistance: '32', renderClouds: 'false', lang: 'ru_ru' })
  expect(milliOptionsOf({ profile: 'low', ramMb: 3072, jvm: 'g1', options: { lang: 'en_us' }, shaderPack: null }).lang).toBe('en_us')
})
