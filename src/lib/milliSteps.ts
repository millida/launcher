/*
 * Шаги Pair B: графика (options.txt, шейдер, память, FPS-режим), конфиги модов,
 * снимки и откат сборки, бэкапы миров, импорт чужой сборки. Каждый runner
 * проверяет значение сам (белый список + тип ключа в файле), пишет атомарно
 * с проверкой «файл не поменялся», возвращает обратный шаг и строки дневника.
 * Подключается один раз: `import './milliSteps'` (side effect).
 */
import { registerStep, setActionHooks, setDefaultProfileGetter, pushMilliAction } from './milliActions'
import type { DiaryChange, MilliStep, StepResult } from './milliActions'
import { cfgSet, type CfgSpec } from './milliCfg'
import { canLocal, diaryAdd, diaryMarkUndone, dropFactsCache, filesRead, filesWrite, sizeText, snapshot, snapshotRestore } from './milliLocal'
import { milliEmote } from '../components/milli/milliEmotions'

type Step<O extends MilliStep['op']> = Extract<MilliStep, { op: O }>

// ─── Белый список options.txt (тот же, что `op config` сервера) ─────────────

interface OptRule extends CfgSpec {
  ru: string
  /** Minecraft 1.19+ пишет в кавычках. */
  quoted?: boolean
}

export const OPT_RULES: Record<string, OptRule> = {
  renderDistance: { ru: 'Дальность', type: 'int', min: 2, max: 32 },
  simulationDistance: { ru: 'Симуляция', type: 'int', min: 5, max: 32 },
  maxFps: { ru: 'Макс. FPS', type: 'int', min: 10, max: 260 },
  graphicsMode: { ru: 'Графика', type: 'enum', values: ['0', '1', '2'] },
  particles: { ru: 'Частицы', type: 'enum', values: ['0', '1', '2'] },
  biomeBlendRadius: { ru: 'Смешение биомов', type: 'int', min: 0, max: 7 },
  mipmapLevels: { ru: 'Мипмапы', type: 'int', min: 0, max: 4 },
  renderClouds: { ru: 'Облака', type: 'enum', values: ['true', 'fast', 'false'], quoted: true },
  entityShadows: { ru: 'Тени мобов', type: 'bool' },
  ao: { ru: 'Мягкий свет', type: 'bool' },
  enableVsync: { ru: 'V-Sync', type: 'bool' },
  entityDistanceScaling: { ru: 'Дальность мобов', type: 'float', min: 0.5, max: 5 },
  gamma: { ru: 'Яркость', type: 'float', min: 0, max: 1 },
  fov: { ru: 'Обзор', type: 'float', min: -1, max: 1 },
  fovEffectScale: { ru: 'Качка обзора', type: 'float', min: 0, max: 1 },
  screenEffectScale: { ru: 'Искажения', type: 'float', min: 0, max: 1 },
  bobView: { ru: 'Покачивание', type: 'bool' },
  guiScale: { ru: 'Размер меню', type: 'int', min: 0, max: 6 },
  lang: { ru: 'Язык', type: 'enum', values: ['ru_ru', 'en_us', 'uk_ua'] },
  tutorialStep: { ru: 'Подсказки', type: 'enum', values: ['none', 'movement', 'find_tree', 'punch_tree', 'open_inventory', 'craft_planks'] },
  autoJump: { ru: 'Автопрыжок', type: 'bool' },
  narrator: { ru: 'Диктор', type: 'enum', values: ['0', '1', '2', '3'] },
  skipMultiplayerWarning: { ru: 'Предупреждение сети', type: 'bool' },
  joinedFirstServer: { ru: 'Первый сервер', type: 'bool' },
  onboardAccessibility: { ru: 'Экран доступности', type: 'bool' },
}

/** Значение для человека: «0.5» яркости → «50%», fov → градусы. */
export function optHuman(key: string, v: string | null | undefined): string {
  if (v == null || v === '') return '—'
  const s = v.replace(/^"(.*)"$/, '$1')
  if (key === 'gamma') return Math.round(Number(s) * 100) + '%'
  if (key === 'fov') return String(Math.round(70 + Number(s) * 40))
  if (key === 'graphicsMode') return ['быстро', 'красиво', 'супер'][Number(s)] ?? s
  if (key === 'particles') return ['все', 'меньше', 'минимум'][Number(s)] ?? s
  if (key === 'renderClouds') return s === 'true' ? 'красиво' : s === 'fast' ? 'быстро' : 'выкл'
  if (key === 'maxFps' && s === '260') return 'без лимита'
  if (s === 'true') return 'вкл'
  if (s === 'false') return 'выкл'
  return s
}

// ─── Общая правка файла ────────────────────────────────────────────────────

const LOCAL_NEEDED: StepResult = { ok: false, detail: 'Обнови лаунчер' }

/**
 * Прочитать файл, поменять ключ, записать с проверкой sha1. Обратный шаг —
 * прежний текст (или удаление, если файла не было).
 */
async function editFile(profile: string, path: string, edit: (text: string, exists: boolean) => ReturnType<typeof cfgSet>, label: string, human = (v: string | null) => v ?? '—'): Promise<StepResult> {
  if (!(await canLocal())) return LOCAL_NEEDED
  const [f] = await filesRead(profile, [path])
  if (!f) return { ok: false, detail: 'нет файла' }
  if (f.exists && f.text == null) return { ok: false, detail: 'файл не читается' }
  const r = edit(f.text ?? '', f.exists)
  if (!r.ok) return { ok: false, detail: r.error }
  if (r.text === (f.text ?? '')) return { ok: true, detail: 'уже так' }
  const [w] = await filesWrite(profile, [{ path, text: r.text, expect: f.exists ? f.sha1 : '' }])
  dropFactsCache()
  return {
    ok: true,
    detail: human(r.from) + ' → ' + human(r.to),
    undo: [{ op: 'file_put', path, text: f.exists ? f.text : null, expect: w?.sha1 }],
    changes: [{ label, from: human(r.from), to: human(r.to) }],
  }
}

registerStep('opt', {
  run: async (s, { profile }) => {
    const { key, to } = s as Step<'opt'>
    const rule = OPT_RULES[key]
    if (!rule) return { ok: false, detail: 'эту настройку Милли не трогает' }
    return editFile(
      profile,
      'options.txt',
      (text, exists) => {
        const r = cfgSet(text, 'txt-kv', key, to.replace(/^"(.*)"$/, '$1'), rule, true)
        // Новый ключ с кавычками там, где их ждёт игра.
        if (r.ok && r.from === null && rule.quoted) return { ...r, text: r.text.replace(new RegExp('^' + key + ':' + r.to + '$', 'm'), key + ':"' + r.to + '"') }
        if (!exists && r.ok) return r
        return r
      },
      rule.ru,
      (v) => optHuman(key, v),
    )
  },
})

registerStep('cfg', {
  run: async (s, { profile }) => {
    const st = s as Step<'cfg'>
    const spec: CfgSpec = { ...(st.type ? { type: st.type } : {}), ...(st.min != null ? { min: st.min } : {}), ...(st.max != null ? { max: st.max } : {}), ...(st.values ? { values: st.values } : {}) }
    const label = st.path.split('.').pop() || st.path
    return editFile(profile, st.file, (text, exists) => (exists ? cfgSet(text, st.format, st.path, st.to, spec, false) : { ok: false, error: 'нет файла — запусти игру разок' }), label)
  },
})

registerStep('file_put', {
  run: async (s, { profile }) => {
    const { path, text, expect } = s as Step<'file_put'>
    if (!(await canLocal())) return LOCAL_NEEDED
    await filesWrite(profile, [{ path, text, ...(expect ? { expect } : {}) }])
    dropFactsCache()
    return { ok: true }
  },
})

/** Шейдер: Iris или Oculus — смотрим, чей конфиг есть (или какой мод стоит). */
registerStep('shader', {
  run: async (s, { profile }) => {
    const { file } = s as Step<'shader'>
    if (!(await canLocal())) return LOCAL_NEEDED
    const c = await import('../ipc/commands')
    const mods = await c.listContent(profile, 'mod').catch(() => [])
    const oculus = mods.some((m) => m.enabled && /oculus/i.test(m.name))
    const iris = mods.some((m) => m.enabled && /iris/i.test(m.name))
    if (!oculus && !iris && file) return { ok: false, detail: 'нужен Iris' }
    const path = oculus ? 'config/oculus.properties' : 'config/iris.properties'
    // '*' — только что поставленный шейдер: берём Complementary или первый zip в shaderpacks.
    if (file === '*') {
      const packs = (await c.listContent(profile, 'shader').catch(() => [])).map((x) => x.name).filter((n) => /\.zip$/i.test(n))
      const pick = packs.find((n) => /complementary/i.test(n)) ?? packs[0]
      if (!pick) return { ok: false, detail: 'шейдер не скачался' }
      return applyShader(profile, path, pick)
    }
    return applyShader(profile, path, file)
  },
})

function applyShader(profile: string, path: string, file: string | null): Promise<StepResult> {
  {
    return editFile(
      profile,
      path,
      (text) => {
        let r = cfgSet(text, 'properties', 'enableShaders', file ? 'true' : 'false', { type: 'bool' }, true)
        if (r.ok && file) {
          const r2 = cfgSet(r.text, 'properties', 'shaderPack', file, { type: 'string' }, true)
          if (!r2.ok) return r2
          r = { ...r2, from: r.from === 'true' ? r2.from : null, to: file }
        }
        return r
      },
      'Шейдеры',
      (v) => (v == null || v === 'false' ? 'выкл' : v === 'true' ? 'вкл' : v.replace(/\.zip$/i, '')),
    )
  }
}

const ramKey = (p: string) => 'm-ram-' + p

registerStep('ram', {
  run: async (s, { profile }) => {
    const { mb } = s as Step<'ram'>
    const c = await import('../ipc/commands')
    const total = await c
      .deviceSpecs()
      .then((d) => d.ram_mb || 0)
      .catch(() => 0)
    // Не больше половины ОЗУ ПК (и не больше 16 ГБ), не меньше 2 ГБ; 0 — авто.
    const cap = total ? Math.max(2, Math.min(16, Math.floor(total / 1024 / 2))) : 16
    const gb = mb <= 0 ? 0 : Math.max(2, Math.min(cap, Math.round(mb / 1024)))
    let prev = 0
    try {
      prev = parseInt(localStorage.getItem(ramKey(profile)) || '0', 10) || 0
      if (gb) localStorage.setItem(ramKey(profile), String(gb))
      else localStorage.removeItem(ramKey(profile))
    } catch {
      return { ok: false, detail: 'не сохранилось' }
    }
    const h = (g: number) => (g ? g + ' ГБ' : 'авто')
    if (prev === gb) return { ok: true, detail: 'уже так' }
    dropFactsCache()
    return { ok: true, detail: h(prev) + ' → ' + h(gb), undo: [{ op: 'ram', mb: prev * 1024 }], changes: [{ label: 'Память', from: h(prev), to: h(gb) }] }
  },
})

registerStep('fpsboost', {
  run: async (s, { profile }) => {
    const { on } = s as Step<'fpsboost'>
    const c = await import('../ipc/commands')
    const before = await c.fpsBoostState(profile).catch(() => null)
    if (before && before.applicable === false) return { ok: false, detail: 'автор сборки уже настроил' }
    if (before?.enabled === on) return { ok: true, detail: 'уже так' }
    const st = await c.setFpsBoost(profile, on)
    return {
      ok: st.enabled === on,
      detail: on ? '+' + st.mods.length + ' модов скорости' : 'выкл',
      undo: [{ op: 'fpsboost', on: !on }],
      changes: [{ label: 'Режим FPS', from: on ? 'выкл' : 'вкл', to: on ? 'вкл' : 'выкл' }],
    }
  },
  risky: true,
})

registerStep('add', {
  run: async (s, { profile }) => {
    const st = s as Step<'add'>
    const c = await import('../ipc/commands')
    const { useProfiles } = await import('../state/profiles')
    const p = useProfiles.getState().profiles.find((x) => x.name === profile)
    if (!p) return { ok: false, detail: 'нет сборки' }
    const r = await c.installContent(st.projectId, p.version, profile, st.kind)
    if (!r.file) return { ok: false, detail: r.mismatch ? 'нет под ' + p.version : 'не скачалось' }
    dropFactsCache()
    return { ok: true, detail: 'поставлено', undo: [{ op: 'mod_off', file: r.file }], changes: [{ label: st.title, to: 'добавлен' }] }
  },
})

// Pair A регистрирует mod_off сам; если его нет — простое выключение, чтобы «Отменить» после add работал.
registerStep('mod_off', {
  run: async (s, { profile }) => {
    const { file } = s as Step<'mod_off'>
    const c = await import('../ipc/commands')
    await c.toggleContent(profile, 'mod', file, false)
    return { ok: true, undo: [{ op: 'mod_on', file }], changes: [{ label: file.replace(/\.jar$/, ''), to: 'выкл' }] }
  },
})
registerStep('mod_on', {
  run: async (s, { profile }) => {
    const { file } = s as Step<'mod_on'>
    const c = await import('../ipc/commands')
    await c.toggleContent(profile, 'mod', file, true)
    return { ok: true, undo: [{ op: 'mod_off', file }], changes: [{ label: file.replace(/\.jar$/, ''), to: 'вкл' }] }
  },
})

// ─── Снимки и бэкапы ───────────────────────────────────────────────────────

registerStep('snapshot', {
  run: async (s, { profile }) => {
    const st = s as Step<'snapshot'>
    if (st.scope === 'world') {
      if (!st.world) return { ok: false, detail: 'какой мир?' }
      const c = await import('../ipc/commands')
      const path = await c.backupWorld(profile, st.world)
      const file = path.split(/[\\/]/).pop() || path
      return { ok: true, detail: 'сохранён', changes: [{ label: 'Бэкап мира', to: st.world }], snapId: file }
    }
    if (!(await canLocal())) return LOCAL_NEEDED
    const snap = await snapshot(profile, st.label || 'Сохранено', false)
    return { ok: true, detail: sizeText(snap.bytes), changes: [{ label: 'Снимок сборки', to: sizeText(snap.bytes) }], snapId: snap.id }
  },
})

registerStep('restore', {
  run: async (s, { profile }) => {
    const { id } = s as Step<'restore'>
    if (!(await canLocal())) return LOCAL_NEEDED
    const before = await snapshotRestore(profile, id)
    dropFactsCache()
    return { ok: true, detail: 'вернула', undo: [{ op: 'restore', id: before.id }], changes: [{ label: 'Сборка', to: 'откат' }], snapId: before.id }
  },
})

registerStep('world_restore', {
  run: async (s, { profile }) => {
    const { file } = s as Step<'world_restore'>
    const c = await import('../ipc/commands')
    const w = await c.restoreWorldBackup(profile, file)
    return { ok: true, detail: 'новый мир «' + w.name + '»', changes: [{ label: 'Мир из бэкапа', to: w.name }] }
  },
})

// ─── Импорт чужой сборки ───────────────────────────────────────────────────

/** Ссылка → источник: modrinth.com/modpack/<slug>, curseforge …/modpacks/<slug> (нужен id), код Millida. */
export function parsePackRef(text: string): { source: Step<'import'>['source']; ref: string } | null {
  const t = text.trim()
  const mr = /modrinth\.com\/(?:modpack|project)\/([A-Za-z0-9_.-]+)/i.exec(t)
  if (mr) return { source: 'modrinth', ref: mr[1] }
  const cfId = /curseforge\.com\/[^\s]*?(?:projects?|modpacks?)\/(\d{3,9})/i.exec(t) ?? /(?:curseforge|cf)[^\d]{0,20}(\d{4,9})/i.exec(t)
  if (cfId) return { source: 'curseforge', ref: cfId[1] }
  return null
}

registerStep('import', {
  run: async (s) => {
    const st = s as Step<'import'>
    const c = await import('../ipc/commands')
    const { useProfiles, refreshProfiles } = await import('../state/profiles')
    let p
    if (st.source === 'modrinth') p = await c.installModpack(st.ref)
    else if (st.source === 'curseforge') {
      const id = Number(st.ref)
      if (!Number.isInteger(id) || id <= 0) return { ok: false, detail: 'нужна ссылка с номером проекта' }
      p = await c.cfInstallModpack(id)
    } else if (st.source === 'code') p = await c.installSharedPack(st.ref)
    else p = await c.importPackFile()
    if (!p?.name) return { ok: false, detail: 'не вышло' }
    await refreshProfiles().catch(() => {})
    useProfiles.getState().setSelected(p.name)
    dropFactsCache()
    // Сразу доктор (Pair A): скан только читает, карточка предложит улучшения.
    void pushMilliAction(
      'Поставила «' + p.name + '». Сделать легче, под твой ПК или на русском?',
      { id: 'imp-' + Date.now().toString(36), kind: 'doctor', profile: p.name, title: 'Проверка', rows: [], steps: [{ op: 'scan', mode: 'import' }], auto: true },
      ['Сделай легче', 'Под мой ПК', 'На русском'],
    )
    return { ok: true, detail: p.name, undo: [], changes: [{ label: 'Импорт', to: p.name }] }
  },
})

// ─── Хуки: профиль по умолчанию, снимок перед риском, дневник, эмоции ───────

setDefaultProfileGetter(() => {
  try {
    // Без статического импорта state/profiles (цикл через commands): читаем через глобальный zustand при вызове.
    return profileGetter?.() ?? null
  } catch {
    return null
  }
})
let profileGetter: (() => string | null) | null = null
void import('../state/profiles').then((m) => {
  profileGetter = () => m.useProfiles.getState().selected
})

let stopLoop: (() => void) | null = null

setActionHooks({
  snapshot: async (profile, label) => {
    if (!(await canLocal())) return null
    const s = await snapshot(profile, label, true)
    return s.id
  },
  diary: async ({ profile, action, changes, undo, snapId }) =>
    diaryAdd(profile, { by: 'milli', kind: action.kind, title: action.title, ...(action.reason ? { reason: action.reason } : {}), changes: changes.slice(0, 40), undo: undo.slice(0, 60), ...(snapId ? { snapId } : {}) }),
  diaryUndone: (profile, id) => diaryMarkUndone(profile, id),
  mood: (m) => {
    stopLoop?.()
    stopLoop = null
    try {
      if (m === 'tuning' || m === 'saving' || m === 'rewind') stopLoop = milliEmote(m === 'tuning' ? 'fix' : m === 'saving' ? 'save' : 'rewind', { hold: true })
      else if (m === 'proud' || m === 'oops') milliEmote(m === 'oops' ? 'worry' : 'proud')
    } catch {}
  },
})

export const STEPS_READY = true
export type { DiaryChange }
