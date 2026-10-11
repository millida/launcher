import { hasTauri } from '../ipc/tauri'
import { applyCrashFix, auditDeps, checkUpdates, installDepItems, repairProfile } from '../ipc/commands'
import type { PlanItem, RepairReport } from '../ipc/commands'
import { listenLaunchProgress } from '../ipc/events'
import type { CrashAction, CrashInfo } from '../ipc/events'
import type { UnlistenFn } from '../ipc/tauri'
import { showToast, useUi } from '../state/ui'
import { trackFailure } from './telemetry'

const STAGE_IDX: Record<string, number> = { files: 0, java: 1, assets: 2, content: 3, mod: 0, launch: 3 }

let running = false

/// Crash actions that change the set of mods. «Починить сборку» performs the
/// whole plan when the core made one, else the first of them: re-checking
/// hashes never removes a missing dependency or a conflicting jar, and that
/// is what the player pressed the button for.
const MOD_FIXES: readonly string[] = ['fix-plan', 'add-mod', 'install-deps', 'disable-mod']

export function modFixOf<T extends { kind: string; arg?: string }>(actions: readonly T[] | null | undefined): T | null {
  for (const kind of MOD_FIXES) {
    const hit = (actions ?? []).find((a) => a.kind === kind)
    if (hit) return hit
  }
  return null
}

export function repairChangedFiles(r: Pick<RepairReport, 'restored'>): boolean {
  return r.restored > 0
}

export const NOTHING_TO_REPAIR =
  'Файлы игры в порядке — эту причину вылета автоматически не убрать. Нажми «Поддержка» или поделись логом'

export const repairRunning = () => running
let lastSummary = ''

// ─── Последний вылет сборки ────────────────────────────────────────────────
// Окно вылета закрыли, лаунчер перезапустили — а причина осталась. Кнопка
// «Починить» на странице сборки раньше только сверяла хеши и говорила «всё на
// месте», хотя ядро уже знало план (зависимость, версия мода, конфликт).
// Помним план последнего вылета, пока сборка не проиграла спокойно.

const LAST_CRASH_KEY = 'm-last-crash'
const LAST_CRASH_TTL = 3 * 86_400_000

export interface SavedCrash {
  at: number
  reason: string
  kind?: string
  culprits?: string[]
  actions: CrashAction[]
}

function readCrashes(): Record<string, SavedCrash> {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_CRASH_KEY) || '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

function writeCrashes(all: Record<string, SavedCrash>, now: number) {
  try {
    const fresh = Object.entries(all)
      .filter(([, c]) => now - c.at < LAST_CRASH_TTL)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 20)
    localStorage.setItem(LAST_CRASH_KEY, JSON.stringify(Object.fromEntries(fresh)))
  } catch {}
}

export function rememberCrash(info: CrashInfo, now = Date.now()) {
  if (!info?.profile) return
  const all = readCrashes()
  all[info.profile] = {
    at: now,
    reason: (info.reason || '').slice(0, 300),
    ...(info.kind ? { kind: info.kind } : {}),
    ...(info.culprits?.length ? { culprits: info.culprits.slice(0, 8) } : {}),
    actions: (info.actions ?? []).filter((a) => a && typeof a.kind === 'string').slice(0, 8),
  }
  writeCrashes(all, now)
}

export function lastCrash(profile: string, now = Date.now()): SavedCrash | null {
  const c = readCrashes()[profile]
  return c && now - c.at < LAST_CRASH_TTL ? c : null
}

/** Сборка отыграла спокойно после вылета — его план больше не нужен. */
export function forgetCrash(profile: string, before = Infinity, now = Date.now()) {
  const all = readCrashes()
  if (!all[profile] || all[profile].at >= before) return
  delete all[profile]
  writeCrashes(all, now)
}

// ─── Помогла ли починка ────────────────────────────────────────────────────
// В телеметрии видно нажатия «Починить», но не итог: 3 применения на человека
// в сутки (10.10.2026) — значит, часть правок не лечит. Метка «чинили» уходит
// полем `fix` в следующий game_exit/game_crash этой сборки.

const FIX_MARK_KEY = 'm-fix-mark'
const FIX_MARK_TTL = 86_400_000

export function markFixApplied(profile: string, kind: string, now = Date.now()) {
  if (!profile || !kind) return
  try {
    const all = JSON.parse(localStorage.getItem(FIX_MARK_KEY) || '{}') || {}
    all[profile] = { kind: kind.slice(0, 24), at: now }
    localStorage.setItem(FIX_MARK_KEY, JSON.stringify(all))
  } catch {}
}

/**
 * Метка последней починки сборки. `take` стирает её: вылет после починки или
 * спокойные 3+ минуты игры — итог. Короткий выход без вылета итогом не считается
 * (событие выхода может прийти раньше события вылета).
 */
export function fixMark(profile: string, take: boolean, now = Date.now()): string | undefined {
  try {
    const all = JSON.parse(localStorage.getItem(FIX_MARK_KEY) || '{}') || {}
    const m = all[profile]
    if (!m) return undefined
    if (take) {
      delete all[profile]
      localStorage.setItem(FIX_MARK_KEY, JSON.stringify(all))
    }
    return now - m.at < FIX_MARK_TTL && typeof m.kind === 'string' ? m.kind : undefined
  } catch {
    return undefined
  }
}

/** Недостающие обязательные зависимости из аудита — без повторов. */
export function missingDeps(issues: { kind: string; fix: { source: string; project_id: string; version_id: string } | null }[]): PlanItem[] {
  const seen = new Set<string>()
  const out: PlanItem[] = []
  for (const i of issues) {
    if (i.kind !== 'missing' || !i.fix?.project_id) continue
    const key = i.fix.source + ':' + i.fix.project_id
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ source: i.fix.source, project_id: i.fix.project_id, ...(i.fix.version_id ? { version_id: i.fix.version_id } : {}) })
  }
  return out
}

const errMsg = (e: unknown) => String(e && (e as Error).message ? (e as Error).message : e).replace(/^Error:\s*/, '')

export interface PackRepair {
  /** Что поменяли — короткими строками. */
  done: string[]
  failed: string[]
  /** Вылет был, а автоматом его причину не убрать: дальше — Милли или поддержка. */
  unresolved: SavedCrash | null
  files: RepairReport | null
  filesText: string
}

/**
 * «Починить» на странице сборки: план последнего вылета → недостающие
 * зависимости → файлы по хешам. Всё локально и без аккаунта: те же команды
 * ядра, что у окна вылета и у Милли, с их проверками.
 */
export async function repairPack(profile: string): Promise<PackRepair | null> {
  if (!hasTauri()) {
    showToast('Доступно в приложении', 'error')
    return null
  }
  if (running) {
    showToast('Починка уже идёт')
    return null
  }
  const done: string[] = []
  const failed: string[] = []
  const crash = lastCrash(profile)
  const fix = modFixOf(crash?.actions)
  if (fix) {
    try {
      const msg = await applyCrashFix(profile, fix.kind, fix.arg ?? '')
      done.push(String(msg || 'причина вылета убрана').replace(/\.?\s*Запусти игру ещё раз\.?$/, ''))
      forgetCrash(profile)
    } catch (e) {
      failed.push(errMsg(e))
    }
  }
  const audit = await auditDeps(profile).catch(() => null)
  const deps = missingDeps(audit?.issues ?? [])
  if (deps.length) {
    try {
      const rep = await installDepItems(profile, 'mod', deps)
      if (rep.installed.length) done.push('поставлены зависимости: ' + fileList(rep.installed))
      if (rep.failed.length) failed.push('не встали: ' + fileList(rep.failed))
    } catch (e) {
      failed.push(errMsg(e))
    }
  }
  const files = await runRepair(profile, { quiet: true })
  if (files && repairChangedFiles(files)) done.push('перекачано файлов — ' + files.restored)
  const unresolved = crash && !fix ? crash : null
  if (done.length) markFixApplied(profile, fix ? 'pack:' + fix.kind : deps.length ? 'pack:deps' : 'pack:files')
  const res: PackRepair = { done, failed, unresolved, files, filesText: lastSummary }
  showToast(packRepairText(res), failed.length && !done.length ? 'error' : 'ok')
  return res
}

export function packRepairText(r: Pick<PackRepair, 'done' | 'failed' | 'unresolved' | 'filesText'>): string {
  const head = r.done.length ? 'Готово: ' + r.done.join('; ') + '. Запусти игру' : ''
  const fail = r.failed.length ? 'Не вышло: ' + r.failed.join('; ') : ''
  if (head || fail) return [head, fail].filter(Boolean).join('. ')
  if (r.unresolved) return 'Файлы в порядке, а причину вылета автоматом не убрать — Милли разберёт лог'
  return r.filesText || 'Всё на месте: файлы игры сверены по хешам'
}

function fileList(names: string[]): string {
  const head = names.slice(0, 3).join(', ')
  return names.length > 3 ? head + ' и ещё ' + (names.length - 3) : head
}

// Починка сверяет файлы по хешам, но устаревший мод — целый файл: сборка
// падает, а отчёт говорит «всё на месте». Число обновлений досчитываем тем же
// проверяльщиком, что и экран сборок, и дописываем в тот же итог.
function summary(r: RepairReport, outdated: number): string {
  const tail = outdated ? '. Устарело модов — ' + outdated + ', обнови их на экране сборки' : ''
  const refused = r.refused.length
    ? 'Починка не качает моды с незнакомых адресов: ' + fileList(r.refused) + ' — поставь их заново из каталога'
    : ''
  if (r.broken.length) {
    return 'Файлы игры на месте, но не удалось восстановить: ' + fileList(r.broken) + ' — удали их и поставь заново' + (refused ? '. ' + refused : '') + tail
  }
  if (refused) return 'Файлы игры на месте. ' + refused + tail
  if (r.restored) return 'Готово: перекачано файлов — ' + r.restored + ', проверено модов — ' + r.checked + tail
  if (r.checked) return 'Всё на месте: проверено модов — ' + r.checked + ', файлы игры сверены по хешам' + tail
  return 'Всё на месте: файлы игры сверены по хешам' + tail
}

/// Progress travels on the same `launch-progress` channel as a launch, so the
/// repair reuses the prelaunch panel instead of leaving the button silent for
/// the minutes a full rehash takes.
export async function runRepair(profile: string, opts: { quiet?: boolean } = {}): Promise<RepairReport | null> {
  if (!hasTauri()) {
    showToast('Доступно в приложении', 'error')
    return null
  }
  if (running) {
    showToast('Починка уже идёт')
    return null
  }
  running = true
  const setPrelaunch = useUi.getState().setPrelaunch
  setPrelaunch({
    open: true,
    sub: profile === 'default' ? 'Быстрый запуск' : profile,
    stage: 0,
    pct: 2,
    msg: 'Готовимся…',
    mode: 'repair',
  })
  let unlisten: UnlistenFn | null = null
  let finished = false
  const stop = () => {
    finished = true
    if (unlisten) unlisten()
    unlisten = null
  }
  listenLaunchProgress((p) => {
    setPrelaunch({ stage: STAGE_IDX[p.stage] ?? 0, pct: p.pct, msg: p.msg })
  }).then((u) => {
    if (!u) return
    if (finished) u()
    else unlisten = u
  })
  try {
    const report = await repairProfile(profile)
    // Сеть каталога могла не ответить — это не отменяет успешной починки.
    const outdated = await checkUpdates(profile, 'mod')
      .then((ups) => (ups ? ups.length : 0))
      .catch(() => 0)
    lastSummary = summary(report, outdated)
    if (!opts.quiet) showToast(lastSummary, report.broken.length || report.refused.length ? 'error' : 'ok')
    return report
  } catch (e) {
    const msg = String(e && (e as Error).message ? (e as Error).message : e).replace(/^Error:\s*/, '')
    trackFailure('repair', profile.length >= 2 ? msg.split(profile).join('<build>') : msg)
    showToast(/отмен/i.test(msg) ? 'Починка отменена' : 'Не удалось починить: ' + msg, 'error')
    return null
  } finally {
    stop()
    running = false
    setPrelaunch({ open: false })
  }
}
