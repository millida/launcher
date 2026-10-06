/*
 * Милли на ПК игрока: команды ядра (milli_local.rs) с проверкой «есть ли они
 * в этой версии лаунчера», факты о сборке для сервера и дневник сборки.
 * Команд нет (старое ядро) — всё отвечает мягко: «Обнови лаунчер».
 */
import { tauri, hasTauri } from '../ipc/tauri'
import type { DiaryChange, MilliAction, MilliStep } from './milliActions'

// ─── IPC ─────────────────────────────────────────────────────────────────

export interface LocalFileMeta {
  path: string
  size: number
  mtime: number
}
export interface LocalFileText extends LocalFileMeta {
  text: string | null
  exists: boolean
  sha1: string
}
export interface LocalFileEdit {
  path: string
  text: string | null
  /** sha1 того, что видели; '' — файла не было. */
  expect?: string
}
export interface MilliSnap {
  id: string
  label: string
  at: number
  bytes: number
  disk: number
  files: number
  mods: number
  auto: boolean
}
export interface WorldBackup {
  file: string
  world: string
  at: number
  bytes: number
}

const NO_CMD = /not found|unknown command|command .* not|no tauri/i
const missing = new Set<string>()

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const T = tauri()
  if (!T) throw new Error('no tauri')
  try {
    return await T.core.invoke<T>(cmd, args)
  } catch (e) {
    if (NO_CMD.test(String((e as { message?: string })?.message ?? e))) missing.add(cmd)
    throw e
  }
}

/** Ядро умеет файлы и снимки (патч milli_local). Кэш «нет» — до перезапуска. */
let probe: Promise<boolean> | null = null
export function canLocal(): Promise<boolean> {
  if (!hasTauri()) return Promise.resolve(false)
  probe ??= call<unknown>('milli_snapshots', { profile: '\u0000probe' })
    .then(() => true)
    .catch((e) => !NO_CMD.test(String((e as { message?: string })?.message ?? e)))
  return probe
}
export const canSnapshot = canLocal

export const filesList = (profile: string) => call<LocalFileMeta[]>('milli_files_list', { profile })
export const filesRead = (profile: string, paths: string[]) => call<LocalFileText[]>('milli_files_read', { profile, paths })
export const filesWrite = (profile: string, edits: LocalFileEdit[]) =>
  call<LocalFileText[]>('milli_files_write', { profile, edits: edits.map((e) => ({ path: e.path, text: e.text, expect: e.expect ?? null })) })
export const noteRead = (profile: string, name: string) => call<string | null>('milli_note_read', { profile, name })
export const noteWrite = (profile: string, name: string, text: string) => call<void>('milli_note_write', { profile, name, text })
export const snapshot = (profile: string, label: string, auto = false) => call<MilliSnap>('milli_snapshot', { profile, label, auto })
export const snapshots = (profile: string) => call<MilliSnap[]>('milli_snapshots', { profile })
export const snapshotRestore = (profile: string, id: string) => call<MilliSnap>('milli_snapshot_restore', { profile, id })
export const snapshotDelete = (profile: string, id: string) => call<void>('milli_snapshot_delete', { profile, id })
export const worldBackups = (profile: string) => call<WorldBackup[]>('milli_world_backups', { profile })

// ─── Дневник сборки ──────────────────────────────────────────────────────

export interface DiaryEntry {
  id: string
  /** мс UNIX. */
  at: number
  by: 'milli' | 'player'
  kind: string
  /** 1–3 слова: «Графика». */
  title: string
  /** Зачем: слова игрока или причина Милли. */
  reason?: string
  changes: DiaryChange[]
  /** Обратные шаги — «верни как было». */
  undo?: MilliStep[]
  snapId?: string
  undone?: boolean
}

interface DiaryFile {
  v: 1
  entries: DiaryEntry[]
  /** Отпечаток сборки на момент последней записи — по нему видно, что игрок поменял сам. */
  print?: PackPrint
}

/** Отпечаток сборки: моды (вкл/выкл) и ключи графики. */
export interface PackPrint {
  mods: Record<string, boolean>
  opts: Record<string, string>
  ram: number
}

const DIARY_MAX = 200
/** В браузере (dev) и без ядра — дневник в localStorage. */
const lsKey = (profile: string) => 'milli-diary:' + profile

async function diaryLoad(profile: string): Promise<DiaryFile> {
  let raw: string | null = null
  if (await canLocal()) raw = await noteRead(profile, 'diary').catch(() => null)
  else {
    try {
      raw = localStorage.getItem(lsKey(profile))
    } catch {}
  }
  try {
    const d = raw ? (JSON.parse(raw) as DiaryFile) : null
    if (d && Array.isArray(d.entries)) return d
  } catch {}
  return { v: 1, entries: [] }
}

async function diarySave(profile: string, d: DiaryFile): Promise<void> {
  d.entries = d.entries.slice(-DIARY_MAX)
  const text = JSON.stringify(d)
  if (await canLocal()) await noteWrite(profile, 'diary', text)
  else {
    try {
      localStorage.setItem(lsKey(profile), text)
    } catch {}
  }
}

let diaryChain: Promise<unknown> = Promise.resolve()
/** Записи дневника идут по одной: две карточки подряд не затирают друг друга. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = diaryChain.then(fn, fn)
  diaryChain = p.catch(() => {})
  return p
}

let idSeq = 0
const newId = () => 'd' + Date.now().toString(36) + (++idSeq).toString(36)

export function diaryAdd(profile: string, e: Omit<DiaryEntry, 'id' | 'at'> & { at?: number }, print?: PackPrint): Promise<string> {
  return serial(async () => {
    const d = await diaryLoad(profile)
    const id = newId()
    d.entries.push({ ...e, id, at: e.at ?? Date.now() })
    if (print) d.print = print
    await diarySave(profile, d)
    return id
  })
}

export function diaryMarkUndone(profile: string, id: string): Promise<void> {
  return serial(async () => {
    const d = await diaryLoad(profile)
    const e = d.entries.find((x) => x.id === id)
    if (!e) return
    e.undone = true
    await diarySave(profile, d)
  })
}

export const diaryList = async (profile: string): Promise<DiaryEntry[]> => (await diaryLoad(profile)).entries

/** Сверить отпечаток: что игрок поменял сам с прошлого раза → запись «by: player». */
export function diaryCatchUp(profile: string, now: PackPrint): Promise<DiaryEntry | null> {
  return serial(async () => {
    const d = await diaryLoad(profile)
    const prev = d.print
    d.print = now
    if (!prev) {
      await diarySave(profile, d)
      return null
    }
    const changes = printDiff(prev, now)
    if (!changes.length) {
      await diarySave(profile, d)
      return null
    }
    const e: DiaryEntry = { id: newId(), at: Date.now(), by: 'player', kind: 'player', title: 'Ты поменял', changes: changes.slice(0, 30) }
    d.entries.push(e)
    await diarySave(profile, d)
    return e
  })
}

const modName = (file: string) => file.replace(/\.jar(\.disabled)?$/i, '').replace(/[-_+]?(mc)?\d[\w.+-]*$/i, '').replace(/[-_]+/g, ' ').trim() || file

export function printDiff(a: PackPrint, b: PackPrint): DiaryChange[] {
  const out: DiaryChange[] = []
  const base = (f: string) => f.replace(/\.disabled$/i, '')
  const am = new Map(Object.entries(a.mods).map(([f, on]) => [base(f), on]))
  const bm = new Map(Object.entries(b.mods).map(([f, on]) => [base(f), on]))
  for (const [f, on] of bm) {
    if (!am.has(f)) out.push({ label: modName(f), to: 'добавлен' })
    else if (am.get(f) !== on) out.push({ label: modName(f), from: am.get(f) ? 'вкл' : 'выкл', to: on ? 'вкл' : 'выкл' })
  }
  for (const f of am.keys()) if (!bm.has(f)) out.push({ label: modName(f), from: 'был', to: 'убран' })
  for (const k of new Set([...Object.keys(a.opts), ...Object.keys(b.opts)])) {
    if (a.opts[k] !== b.opts[k]) out.push({ label: k, from: a.opts[k] ?? '—', to: b.opts[k] ?? '—' })
  }
  if (a.ram !== b.ram) out.push({ label: 'Память', from: a.ram ? a.ram + ' ГБ' : 'авто', to: b.ram ? b.ram + ' ГБ' : 'авто' })
  return out
}

// ─── Факты о сборке для сервера ──────────────────────────────────────────

/** Ключи options.txt, которые Милли видит (графика и раздражители). */
export const FACT_OPTS = [
  'renderDistance',
  'simulationDistance',
  'graphicsMode',
  'maxFps',
  'enableVsync',
  'gamma',
  'fov',
  'particles',
  'renderClouds',
  'entityShadows',
  'ao',
  'biomeBlendRadius',
  'mipmapLevels',
  'entityDistanceScaling',
  'guiScale',
  'lang',
  'tutorialStep',
] as const

export interface MilliLocalFacts {
  profile: string
  mc: string
  loader: string
  /** Все сборки игрока (имя, версия, загрузчик) — чтобы понимать «в Тёмном лесу». */
  profiles: { name: string; mc: string; loader: string }[]
  /** Моды: имя файла, вкл, slug/название, если ядро знает. */
  mods: { file: string; on: boolean; id?: string; title?: string }[]
  shaders: string[]
  /** Активный шейдер (iris/oculus.properties) или ''. */
  shader: string
  opts: Record<string, string>
  ramGb: number
  worlds: { folder: string; name: string; mb: number; played: number }[]
  /** Снимки сборки: сколько, последний (мс), список (секунды). */
  snaps: { n: number; last: number; list: { id: string; label: string; at: number; bytes: number }[] }
  /** Бэкапы миров с размерами. */
  worldBackups: WorldBackup[]
  /** Date#getTimezoneOffset — «вчера» и «в понедельник» по часам игрока. */
  tz: number
  /** Хвост дневника: 6 последних записей коротко. */
  diary: { id: string; at: number; by: string; title: string; reason?: string; changes: string[]; undone?: boolean; undo?: MilliStep[] }[]
  /** Конфиги модов (пути, ≤160) — для «поменяй настройку мода». */
  configs: string[]
  /** Ядро умеет файлы/снимки. */
  local: boolean
}

let factsCache: { key: string; at: number; facts: MilliLocalFacts } | null = null

/** Факты о выбранной сборке (кэш 20 с). null — нет ядра или сборки. */
export async function gatherFacts(profile: string | null): Promise<MilliLocalFacts | null> {
  if (!hasTauri() || !profile) return null
  if (factsCache && factsCache.key === profile && Date.now() - factsCache.at < 20_000) return factsCache.facts
  const c = await import('../ipc/commands')
  const { useProfiles } = await import('../state/profiles')
  const all = useProfiles.getState().profiles
  const p = all.find((x) => x.name === profile)
  if (!p) return null
  const local = await canLocal()
  const [mods, shaders, worlds, opts, snaps, diary, configs, shader, wbs] = await Promise.all([
    c.listContent(profile, 'mod').catch(() => []),
    c.listContent(profile, 'shader').catch(() => []),
    c.worldDetails(profile).catch(() => []),
    local ? readOpts(profile) : Promise.resolve({} as Record<string, string>),
    local ? snapshots(profile).catch(() => [] as MilliSnap[]) : Promise.resolve([] as MilliSnap[]),
    diaryList(profile).catch(() => [] as DiaryEntry[]),
    local ? filesList(profile).catch(() => [] as LocalFileMeta[]) : Promise.resolve([] as LocalFileMeta[]),
    local ? activeShader(profile) : Promise.resolve(''),
    local ? worldBackups(profile).catch(() => [] as WorldBackup[]) : Promise.resolve([] as WorldBackup[]),
  ])
  let ramGb = 0
  try {
    ramGb = parseInt(localStorage.getItem('m-ram-' + profile) || '0', 10) || 0
  } catch {}
  const facts: MilliLocalFacts = {
    profile,
    mc: p.version,
    loader: p.loader || (p.fabric ? 'fabric' : 'vanilla'),
    profiles: all.slice(0, 20).map((x) => ({ name: x.name, mc: x.version, loader: x.loader || (x.fabric ? 'fabric' : 'vanilla') })),
    mods: mods.slice(0, 400).map((m) => ({ file: m.name, on: m.enabled, ...(m.project_id ? { id: m.project_id } : {}), ...(m.title ? { title: m.title } : {}) })),
    shaders: shaders.map((s) => s.name).slice(0, 30),
    shader,
    opts,
    ramGb,
    worlds: worlds.slice(0, 20).map((w) => ({ folder: w.folder, name: w.name, mb: Math.round(w.sizeBytes / 1048576), played: w.lastPlayed })),
    snaps: { n: snaps.length, last: snaps[0] ? snaps[0].at * 1000 : 0, list: snaps.slice(0, 12).map((x) => ({ id: x.id, label: x.label, at: x.at, bytes: x.bytes })) },
    worldBackups: wbs.slice(0, 20),
    tz: new Date().getTimezoneOffset(),
    diary: diary
      .slice(-20)
      .map((e) => ({ id: e.id, at: e.at, by: e.by, title: e.title, ...(e.reason ? { reason: e.reason } : {}), changes: e.changes.slice(0, 5).map(changeText), ...(e.undone ? { undone: true } : {}), ...(e.undo?.length ? { undo: e.undo.slice(0, 40) } : {}) })),
    configs: configs
      .map((f) => f.path)
      .filter((x) => x.startsWith('config/'))
      .slice(0, 160),
    local,
  }
  try {
    const d = await import('./milliDoctor')
    ;(facts as MilliLocalFacts & { doctor?: unknown }).doctor = d.doctorMemos().slice(0, 6)
  } catch {}
  factsCache = { key: profile, at: Date.now(), facts }
  // Попутно: что игрок поменял сам с прошлого раза — в дневник.
  void diaryCatchUp(profile, { mods: Object.fromEntries(mods.map((m) => [m.name, m.enabled])), opts, ram: ramGb }).catch(() => {})
  return facts
}

export const dropFactsCache = () => {
  factsCache = null
}

export const changeText = (c: DiaryChange) => c.label + (c.from != null || c.to != null ? ': ' + (c.from ?? '—') + ' → ' + (c.to ?? '—') : '')

async function readOpts(profile: string): Promise<Record<string, string>> {
  const [f] = await filesRead(profile, ['options.txt']).catch(() => [] as LocalFileText[])
  const out: Record<string, string> = {}
  if (!f?.text) return out
  const want = new Set<string>(FACT_OPTS)
  for (const line of f.text.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const k = line.slice(0, i)
    if (want.has(k)) out[k] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1')
  }
  return out
}

async function activeShader(profile: string): Promise<string> {
  const files = await filesRead(profile, ['config/iris.properties', 'config/oculus.properties']).catch(() => [] as LocalFileText[])
  for (const f of files) {
    if (!f.text) continue
    const on = /^\s*enableShaders\s*=\s*true/m.test(f.text)
    const pack = /^\s*shaderPack\s*=\s*(.+)$/m.exec(f.text)?.[1]?.trim() ?? ''
    if (on && pack) return pack.replace(/\\(.)/g, '$1')
  }
  return ''
}

// ─── Удобства для карточек ───────────────────────────────────────────────

/** «340 МБ», «1,2 ГБ». */
export function sizeText(bytes: number): string {
  const mb = bytes / 1048576
  if (mb < 1) return '<1 МБ'
  if (mb < 1000) return Math.round(mb) + ' МБ'
  return (mb / 1024).toFixed(1).replace('.', ',') + ' ГБ'
}

/** «сегодня 14:05», «вчера 21:30», «пн 12:00», «3 окт». */
export function whenText(ms: number, now = Date.now()): string {
  const d = new Date(ms)
  const n = new Date(now)
  const hm = d.toTimeString().slice(0, 5)
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60000) / 86400000)
  const diff = day(n) - day(d)
  if (diff === 0) return 'сегодня ' + hm
  if (diff === 1) return 'вчера ' + hm
  if (diff < 7) return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getDay()] + ' ' + hm
  return d.getDate() + ' ' + ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][d.getMonth()]
}

export type { MilliAction }
