/*
 * «Доктор сборки» в чате Милли (Pair A): осмотр установленной сборки,
 * безопасные обновления, перенос на другую версию, вылет → объяснение и
 * починка. Лаунчер собирает факты (моды, обновления, аудит зависимостей,
 * план переноса, железо), сервер решает и объясняет
 * (`POST /catalog/milli/doctor`), а выполняет — только этот файл, после
 * «Применить», через существующие команды ядра. Каждый шаг возвращает
 * обратные шаги (выключить вместо удалить, прежняя версия мода), а перед
 * рискованным milliActions делает снимок сборки, когда ядро это умеет.
 */
import {
  applyCrashFix,
  auditDeps,
  checkUpdates,
  contentVersions,
  installDepItems,
  listContent,
  listProfiles,
  loadProfileSettings,
  migratePlan,
  migrateProfile,
  scanContent,
  setContentVersion,
  toggleContent,
  type ModFile,
  type Profile,
} from '../ipc/commands'
import type { CrashInfo } from '../ipc/events'
import { api, hasMillidaAccount } from './api'
import { milliPc } from './milli'
import { pushMilliAction, registerStep, type MilliAction, type MilliActionRow, type MilliStep, type StepResult } from './milliActions'

// ─── Контракт сервера (milli-server/src/doctor.ts) ─────────────────────────

export type DocMode = 'scan' | 'update' | 'port'
type DocStep =
  | { op: 'mod_off'; file: string }
  | { op: 'mod_on'; file: string }
  | { op: 'mod_update'; file: string; to: string; toNum: string; from?: string }
  | { op: 'dep_add'; projectId: string; versionId?: string; title: string }
  | { op: 'ram'; mb: number }
  | { op: 'port'; mc: string; loader: string; name: string; add: { projectId: string; title: string }[] }

export interface DocRow {
  id: string
  kind: string
  sev: 'red' | 'yellow' | 'info'
  text: string
  mods: { file?: string; projectId?: string; title: string; icon?: string | null }[]
  steps: DocStep[]
  on: boolean
  note?: string
}

export interface DoctorReport {
  mode: DocMode
  profile: string
  mc: string
  loader: string
  scanned: number
  title: string
  say: string
  rows: DocRow[]
  counts: { red: number; yellow: number; info: number }
  port?: { to: { mc: string; loader: string }; ready: number; replaced: { from: string; to: { title: string } ; why: string }[]; lost: string[]; name: string }
}

const KIND: Record<DocMode, MilliAction['kind']> = { scan: 'doctor', update: 'update', port: 'port' }
const CTA: Record<DocMode, string> = { scan: 'Починить', update: 'Обновить', port: 'Перенести' }

/** Отчёт сервера → карточка действия. Строка без шагов (всё в порядке) — просто строка. */
export function reportAction(r: DoctorReport, id = 'doc-' + Date.now().toString(36)): MilliAction {
  const steps: MilliStep[] = []
  const rows: MilliActionRow[] = r.rows.map((row) => {
    const idx = row.steps.map((s) => steps.push(s as MilliStep) - 1)
    const icon = row.mods.find((m) => m.icon)?.icon ?? undefined
    const names = row.mods.map((m) => m.title)
    const extra = names.length > 1 ? names.slice(0, 6).join(', ') + (names.length > 6 ? ' и ещё ' + (names.length - 6) : '') : ''
    return {
      id: row.id,
      label: row.text,
      sev: row.sev,
      ...(icon ? { icon } : {}),
      ...(row.note || extra ? { note: [extra, row.note].filter(Boolean).join(' · ') } : {}),
      optional: true,
      on: row.on,
      steps: idx,
    }
  })
  if (r.port) {
    for (const x of r.port.replaced.slice(0, 8)) rows.push({ id: 'rep:' + x.from, label: `${x.from} → ${x.to.title}`, note: x.why, sev: 'info' })
    if (r.port.lost.length) rows.push({ id: 'lost', label: `Не найдутся: ${r.port.lost.length}`, note: r.port.lost.slice(0, 8).join(', '), sev: 'yellow' })
  }
  return {
    id,
    kind: KIND[r.mode],
    profile: r.profile,
    title: r.title,
    reason: r.say,
    rows,
    steps,
    risky: steps.some((s) => s.op !== 'ram'),
    cta: steps.length ? CTA[r.mode] : undefined,
    restart: steps.length > 0,
  }
}

// ─── Факты ─────────────────────────────────────────────────────────────────

async function post<T>(path: string, body: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST', body: JSON.stringify(body) }
  if (import.meta.env.DEV && import.meta.env.VITE_MILLI_TEST === '1') {
    const r = await fetch('/milli-test' + path, { ...init, headers: { 'Content-Type': 'application/json' } })
    if (!r.ok) throw new Error('http ' + r.status)
    return r.json() as Promise<T>
  }
  return api<T>(path, init)
}

const loaderOf = (p: Profile) => (p.loader || (p.fabric ? 'fabric' : 'vanilla')).toLowerCase()

async function profileOf(name: string): Promise<Profile> {
  const p = (await listProfiles()).find((x) => x.name === name)
  if (!p) throw new Error('Сборка не найдена')
  return p
}

/** Моды сборки; неузнанных много — опознать по хэшу (сеть ядра). */
async function modsOf(profile: string): Promise<ModFile[]> {
  const list = await listContent(profile, 'mod')
  const unknown = list.filter((m) => !m.project_id).length
  if (list.length && unknown / list.length > 0.3) {
    try {
      return (await scanContent(profile, 'mod')).items
    } catch {}
  }
  return list
}

const modFacts = (list: ModFile[]) =>
  list.map((m) => ({
    file: m.name,
    on: m.enabled,
    ...(m.project_id ? { projectId: m.project_id } : {}),
    ...(m.version_number ? { version: m.version_number } : {}),
    ...(m.title ? { title: m.title } : {}),
    ...(m.mc ? { mc: m.mc } : {}),
    ...(m.loaders?.length ? { loaders: m.loaders } : m.loader ? { loaders: [m.loader] } : {}),
    size: m.size,
  }))

const settle = async <T,>(p: Promise<T>, def: T): Promise<T> => {
  try {
    return await p
  } catch {
    return def
  }
}

/** Последний осмотр по сборке — для разговора («у тебя в … 3 мода устарели»). */
const LAST_KEY = 'm-milli-doc'
export interface DoctorMemo {
  profile: string
  at: number
  red: number
  yellow: number
  say: string
}
export function doctorMemos(): DoctorMemo[] {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) || '[]')
    return Array.isArray(v) ? v.slice(0, 8) : []
  } catch {
    return []
  }
}
function remember(r: DoctorReport) {
  if (r.mode !== 'scan') return
  try {
    const list = doctorMemos().filter((m) => m.profile !== r.profile)
    list.unshift({ profile: r.profile, at: Date.now(), red: r.counts.red, yellow: r.counts.yellow, say: r.say.slice(0, 160) })
    localStorage.setItem(LAST_KEY, JSON.stringify(list.slice(0, 8)))
  } catch {}
}

/** Собрать факты и спросить сервер. target для переноса: «1.21.1|fabric». */
export async function runDoctor(profile: string, mode: DocMode, target?: { mc: string; loader: string }): Promise<DoctorReport> {
  const p = await profileOf(profile)
  const list = await modsOf(profile)
  const [updates, audit, pc, settings, plan] = await Promise.all([
    mode === 'port' ? Promise.resolve([]) : settle(checkUpdates(profile, 'mod'), []),
    mode === 'scan' ? settle(auditDeps(profile), null) : Promise.resolve(null),
    settle(milliPc(), null),
    mode === 'scan' ? settle(loadProfileSettings(profile), null) : Promise.resolve(null),
    mode === 'port' && target ? migratePlan(profile, target.mc, target.loader) : Promise.resolve(null),
  ])
  const body = {
    mode,
    profile: { name: p.name, mc: p.version, loader: loaderOf(p) },
    mods: modFacts(list),
    updates: updates.map((u) => ({ file: u.file_name, to: u.new_version_id, toNum: u.new_version_number })),
    audit: (audit?.issues ?? []).map((i) => ({
      kind: i.kind,
      title: i.title,
      detail: i.detail,
      file: i.file_name,
      ...(i.fix ? { fixId: i.fix.project_id, fixVersion: i.fix.version_id, fixTitle: i.fix.title } : {}),
      ...(i.dep ? { dep: i.dep } : {}),
    })),
    ...(pc ? { pc } : {}),
    ...((settings as { ramMb?: number } | null)?.ramMb ? { ramMb: (settings as { ramMb?: number }).ramMb } : {}),
    ...(target ? { target: { mc: target.mc, loader: target.loader } } : {}),
    ...(plan
      ? {
          migrate: {
            items: plan.items.map((i) => ({ file: i.file_name, title: i.title, projectId: i.project_id, ok: i.ok, note: i.note })),
            unlinked: plan.unlinked,
            name: plan.suggested_name,
          },
        }
      : {}),
  }
  const r = await post<DoctorReport>('/catalog/milli/doctor', body)
  remember(r)
  return r
}

// ─── Шаги (выполняет лаунчер, только после «Применить») ───────────────────

const titleOf = async (profile: string, file: string) => (await listContent(profile, 'mod')).find((m) => m.name === file)

function parseTarget(t: string | undefined): { mc: string; loader: string } | undefined {
  const [mc, loader] = String(t || '').split('|')
  return mc && loader ? { mc, loader } : undefined
}

export function registerDoctorSteps() {
  registerStep('scan', {
    readOnly: true,
    run: async (step, ctx): Promise<StepResult> => {
      const s = step as Extract<MilliStep, { op: 'scan' }>
      const mode = (s.mode === 'update' || s.mode === 'port' ? s.mode : 'scan') as DocMode
      const r = await runDoctor(ctx.profile, mode, parseTarget(s.target))
      return { ok: true, replace: reportAction(r, ctx.action.id) }
    },
  })
  const toggle = (on: boolean) => async (step: MilliStep, ctx: { profile: string }): Promise<StepResult> => {
    const file = (step as { file: string }).file
    await toggleContent(ctx.profile, 'mod', file, on)
    // Проверка кодом: мод правда в нужном состоянии.
    const now = await titleOf(ctx.profile, file)
    const ok = !!now && now.enabled === on
    return {
      ok,
      detail: ok ? (on ? 'включён' : 'выключен') : 'не вышло',
      undo: [{ op: on ? 'mod_off' : 'mod_on', file }],
      changes: [{ label: now?.title || file, from: on ? 'выкл' : 'вкл', to: on ? 'вкл' : 'выкл' }],
    }
  }
  registerStep('mod_off', { run: toggle(false) })
  registerStep('mod_on', { run: toggle(true) })
  registerStep('mod_update', {
    risky: true,
    run: async (step, ctx) => {
      const s = step as Extract<MilliStep, { op: 'mod_update' }>
      let from = s.from
      if (!from) from = (await settle(contentVersions(ctx.profile, 'mod', s.file), [])).find((v) => v.current)?.id
      const before = await titleOf(ctx.profile, s.file)
      const file = await setContentVersion(ctx.profile, 'mod', s.file, s.to)
      const after = await titleOf(ctx.profile, file)
      const ok = !!after
      return {
        ok,
        detail: ok ? (s.toNum ? '→ ' + s.toNum.slice(0, 16) : 'обновлён') : 'не встал',
        undo: from ? [{ op: 'mod_update', file, to: from, toNum: before?.version_number }] : [],
        changes: [{ label: before?.title || s.file, from: before?.version_number, to: after?.version_number || s.toNum }],
      }
    },
  })
  registerStep('dep_add', {
    run: async (step, ctx) => {
      const s = step as Extract<MilliStep, { op: 'dep_add' }>
      const rep = await installDepItems(ctx.profile, 'mod', [{ source: 'modrinth', project_id: s.projectId, ...(s.versionId ? { version_id: s.versionId } : {}) }])
      const ok = rep.installed.length > 0
      return {
        ok,
        detail: ok ? 'поставлен' : rep.failed[0]?.slice(0, 60) || 'не встал',
        // Откат — выключить поставленное (файл остаётся, вернуть можно одним нажатием).
        undo: rep.installed.map((file) => ({ op: 'mod_off', file }) as MilliStep),
        changes: [{ label: s.title, to: 'поставлен' }],
      }
    },
  })
  registerStep('port', {
    run: async (step, ctx) => {
      const s = step as Extract<MilliStep, { op: 'port' }>
      // Старая сборка не трогается: ядро копирует её в новую (это и есть откат).
      const res = await migrateProfile(ctx.profile, s.mc, s.loader, null, s.name)
      const name = res.profile.name
      let added = 0
      if (s.add.length) {
        const rep = await settle(installDepItems(name, 'mod', s.add.map((a) => ({ source: 'modrinth', project_id: a.projectId }))), { installed: [], failed: [] })
        added = rep.installed.length
      }
      return {
        ok: true,
        detail: `«${name}»: ${res.moved} перенесено${added ? `, ${added} замен` : ''}${res.failed.length ? `, ${res.failed.length} не встало` : ''}`,
        changes: [{ label: 'Новая сборка', to: name }],
      }
    },
  })
  registerStep('crashfix', {
    run: async (step, ctx) => {
      const s = step as Extract<MilliStep, { op: 'crashfix' }>
      const msg = await applyCrashFix(ctx.profile, s.kind, s.arg)
      return {
        ok: true,
        detail: String(msg || 'готово').slice(0, 60),
        undo: s.kind === 'disable-mod' ? [{ op: 'mod_on', file: s.arg }] : [],
        changes: [{ label: String(msg || s.kind).slice(0, 80) }],
      }
    },
  })
}

// ─── Проактивно: вылет и осмотр раз в сутки ───────────────────────────────

/** Вылет → карточка в чате: что сломалось простыми словами и кнопки починки ядра. */
export function crashAction(info: CrashInfo): { text: string; action: MilliAction } {
  const acts = (info.actions ?? []).filter((a) => a.kind && a.kind !== 'open-folder' && a.kind !== 'open-log' && a.kind !== 'share-log').slice(0, 3)
  const steps: MilliStep[] = acts.map((a) => ({ op: 'crashfix', kind: a.kind, arg: a.arg ?? '' }))
  const rows: MilliActionRow[] = acts.map((a, i) => ({ id: 'cf' + i, label: a.label, ...(a.hint ? { note: a.hint } : {}), sev: i === 0 ? 'red' : 'yellow', optional: acts.length > 1, on: i === 0, steps: [i] }))
  rows.push({ id: 'scan', label: 'Осмотреть всю сборку', note: 'Найду конфликты и старые моды', sev: 'info', optional: true, on: !acts.length, steps: [steps.length] })
  steps.push({ op: 'scan', mode: 'scan' })
  const culprit = info.culprits?.[0]
  const text = (culprit ? `Игра упала из-за «${culprit}». ` : 'Игра вылетела. ') + (acts.length ? 'Могу починить — потом запусти снова.' : 'Давай осмотрю сборку?')
  return {
    text,
    action: { id: 'crash-' + Date.now().toString(36), kind: 'crashfix', profile: info.profile, title: 'Вылет', reason: info.reason.slice(0, 200), rows, steps, risky: true, cta: 'Починить', restart: true },
  }
}

const DAY = 86_400_000
const SEEN_KEY = 'm-milli-doc-seen'

/** Раз в сутки на сборку: тихий осмотр; нашлось важное — Милли сама предлагает починить. */
export async function proactiveDoctor(profile: string | null, opts: { busy: () => boolean }): Promise<boolean> {
  if (!profile || !hasMillidaAccount()) return false
  let seen: Record<string, number> = {}
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') || {}
  } catch {}
  if (Date.now() - (seen[profile] ?? 0) < DAY) return false
  seen[profile] = Date.now()
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
  } catch {}
  const r = await runDoctor(profile, 'scan')
  const important = r.counts.red > 0 || r.rows.some((x) => x.kind === 'outdated' && x.steps.length >= 3) || r.counts.yellow >= 2
  if (!important || opts.busy()) return false
  await pushMilliAction(r.say, reportAction(r), ['Что не так?', 'Не сейчас'])
  return true
}

let started = false
/** Подключить доктора: шаги, вылеты в чат, тихий осмотр. Зовётся один раз из панели Милли. */
export function startMilliDoctor() {
  if (started) return
  started = true
  registerDoctorSteps()
  void Promise.all([import('../state/crash'), import('../state/profiles'), import('../state/milli')]).then(([crash, profiles, milli]) => {
    let last: CrashInfo | null = null
    crash.useCrash.subscribe((s) => {
      const info = s.info
      if (!info?.profile || info === last) return
      last = info
      const { text, action } = crashAction(info)
      void pushMilliAction(text, action, ['Почему так?', 'Осмотри сборку'])
    })
    const busy = () => milli.useMilli.getState().pending
    setTimeout(() => void proactiveDoctor(profiles.useProfiles.getState().selected, { busy }).catch(() => {}), 25_000)
  })
}
