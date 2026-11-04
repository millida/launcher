import { create } from 'zustand'
import { activeInstalls, cancelInstall, pauseInstall } from '../ipc/commands'
import { listenInstallProgress } from '../ipc/events'
import { hasTauri } from '../ipc/tauri'
import { reportInstallFailure } from '../lib/crash'
import { installTarget } from '../lib/errorReport'
import { trackFailure } from '../lib/telemetry'
import { buildTag } from '../lib/telemetryPrivacy'
import { showToast } from './ui'
import { registerUnloadHold } from '../lib/unloadHold'
import { t, tx } from '../i18n'
import { CORE_INSTALL_CANCELLED, CORE_PICK_CANCELLED } from '../lib/coreErrors'

// Install jobs live in the core and outlive the component that started them, so
// state is global and keyed exactly like the core job registry. A second attempt
// attaches to the running job instead of racing it over the same temp files.

export type InstallState = 'run' | 'done' | 'error'

/// Сценарий установки для события error: ключи совпадают с тем, что уже
/// считают дашборды (content_install), остальные — по виду задачи.
export function installWhere(key: string): string {
  const kind = installTarget(key).kind
  if (/^(mr|cf)-(?!modpack)[a-z]+$/.test(kind)) return 'content_install'
  if (kind === 'mr-modpack' || kind === 'cf-modpack' || kind === 'catalog-pack') return 'modpack_install'
  if (kind === 'millida-mod') return 'millida_mod_install'
  if (kind === 'migrate') return 'build_migrate'
  return 'install'
}

/// Один сбой установки — одно событие: промис задачи и событие прогресса ядра
/// несут один текст, повтор за минуту телеметрия отбрасывает сама.
function trackInstallFailure(key: string, err: unknown) {
  const t = installTarget(key)
  const text = String(err && (err as Error).message ? (err as Error).message : err)
  const masked = t.profile && t.profile.length >= 2 ? text.split(t.profile).join('<build>') : text
  trackFailure(installWhere(key), masked, {
    job: t.kind.slice(0, 24),
    build: buildTag(t.profile, t.catalogPack),
    pack: t.catalogPack,
  })
}

export interface InstallTask {
  key: string
  title: string
  label: string
  msg: string
  pct: number
  state: InstallState
  versionId?: string
  paused?: boolean
  pausable?: boolean
  /** Секунд до конца; null — ядро не берётся сказать. */
  eta?: number | null
}

interface InstallsState {
  tasks: Record<string, InstallTask>
  done: Record<string, true>
  // Which version id a key's last completed install actually put in place —
  // a key covers every version of a project, so the plain `done` flag alone
  // cannot tell one version's row from another's.
  doneVersion: Record<string, string>
  patch: (key: string, t: Partial<InstallTask> & { title?: string }) => void
  drop: (key: string) => void
}

export const useInstalls = create<InstallsState>((set, get) => ({
  tasks: {},
  done: {},
  doneVersion: {},
  patch: (key, task) => {
    const prev = get().tasks[key]
    const next: InstallTask = {
      key,
      title: task.title || (prev && prev.title) || '',
      label: task.label || (prev && prev.label) || t('Ставим…'),
      msg: task.msg !== undefined ? task.msg : (prev && prev.msg) || '',
      pct: task.pct !== undefined ? task.pct : (prev && prev.pct) || 0,
      state: task.state || (prev && prev.state) || 'run',
      versionId: task.versionId !== undefined ? task.versionId : prev && prev.versionId,
      paused: task.paused !== undefined ? task.paused : prev && prev.paused,
      pausable: task.pausable !== undefined ? task.pausable : prev && prev.pausable,
      eta: task.eta !== undefined ? task.eta : prev && prev.eta,
    }
    set({ tasks: { ...get().tasks, [key]: next } })
  },
  drop: (key) => {
    const tasks = { ...get().tasks }
    delete tasks[key]
    set({ tasks })
  },
}))

// Installs the page drives (several core calls in a row) would stop halfway with
// the page: the window waits in the tray until they are done.
registerUnloadHold(
  () => (Object.values(useInstalls.getState().tasks).some((task) => task.state === 'run') ? 'install' : null),
  (cb) => useInstalls.subscribe(cb),
)

export const installTask = (key: string): InstallTask | undefined => useInstalls.getState().tasks[key]

export const isInstalled = (key: string): boolean => !!useInstalls.getState().done[key]

const markDone = (key: string, versionId?: string) =>
  useInstalls.setState((s) => ({
    done: { ...s.done, [key]: true },
    doneVersion: versionId ? { ...s.doneVersion, [key]: versionId } : s.doneVersion,
  }))

/// Ровно тот текст, который ядро возвращает по отмене (engine/core/jobs.rs).
/// Отмена — не сбой: красная плашка и тост «ошибка» пугали игрока, который сам
/// её и нажал.
export const isCancelled = (e: unknown): boolean => String(e).includes(CORE_INSTALL_CANCELLED)

const CANCELLED_MSG = CORE_PICK_CANCELLED

export const taskCancelled = (t: InstallTask): boolean => t.state === 'error' && t.msg === CANCELLED_MSG

const HIDE_MS = 2600
const hideTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function fade(key: string, ms = HIDE_MS) {
  clearTimeout(hideTimers[key])
  hideTimers[key] = setTimeout(() => useInstalls.getState().drop(key), ms)
}

interface RunOptions<T> {
  key: string
  title: string
  running?: string
  run: () => Promise<T>
  onDone?: (r: T) => void
  onError?: (e: unknown) => void
  onCancel?: () => void
  keepOpen?: (r: T) => boolean
  // Which version this call targets, when the key covers a whole project —
  // lets the UI show progress only on that version's row instead of every one.
  versionId?: string
}

export function runInstall<T>(o: RunOptions<T>): boolean {
  const cur = useInstalls.getState().tasks[o.key]
  if (cur && cur.state === 'run') {
    showToast(cur.msg ? t('«{name}» уже ставится: {status}', { name: cur.title || o.title || '', status: tx(cur.msg) }) : t('«{name}» уже ставится', { name: cur.title || o.title || '' }))
    return false
  }
  clearTimeout(hideTimers[o.key])
  useInstalls.getState().patch(o.key, {
    title: o.title,
    label: o.running || t('Ставим…'),
    msg: '',
    pct: 0,
    state: 'run',
    versionId: o.versionId,
    paused: false,
    pausable: false,
  })
  o.run()
    .then((r) => {
      if (o.keepOpen && o.keepOpen(r)) {
        useInstalls.getState().drop(o.key)
      } else {
        markDone(o.key, o.versionId)
        useInstalls.getState().patch(o.key, { label: t('Установлено'), pct: 100, msg: '', state: 'done' })
        fade(o.key)
      }
      if (o.onDone) o.onDone(r)
    })
    .catch((e) => {
      if (isCancelled(e)) {
        useInstalls.getState().patch(o.key, { label: '', msg: CANCELLED_MSG, state: 'error' })
        fade(o.key)
        if (o.onCancel) o.onCancel()
        else showToast(t('Установка «{name}» отменена', { name: o.title || '' }), 'ok', false)
        return
      }
      void reportInstallFailure(o.key, o.title, e)
      trackInstallFailure(o.key, e)
      useInstalls.getState().patch(o.key, { label: '', msg: String(e), state: 'error' })
      fade(o.key, 4000)
      if (o.onError) o.onError(e)
      else showToast('' + e, 'error')
    })
  return true
}

export function stopInstall(key: string): void {
  const task = useInstalls.getState().tasks[key]
  if (!task || task.state !== 'run') return
  useInstalls.getState().patch(key, { msg: t('Отменяем…') })
  void cancelInstall(key)
    .then((stopped) => {
      // Ядро уже не знает такой задачи: экран показывал прогресс, которого нет,
      // и «Отменить» выглядело сломанным. Убираем карточку сами.
      if (!stopped) useInstalls.getState().drop(key)
    })
    .catch((e) => showToast(t('Не удалось отменить: {error}', { error: tx(e) }), 'error'))
}

/// Пауза держит уже скачанное: ядро рвёт соединение и после «Продолжить»
/// докачивает с того же байта (engine/core/jobs.rs, Halt).
export function togglePause(key: string): void {
  const task = useInstalls.getState().tasks[key]
  if (!task || task.state !== 'run' || !task.pausable) return
  const paused = !task.paused
  void pauseInstall(key, paused)
    .then((ok) => {
      if (ok) useInstalls.getState().patch(key, { paused })
      else useInstalls.getState().patch(key, { pausable: false, paused: false })
    })
    .catch((e) => showToast(paused ? t('Не удалось поставить на паузу: {error}', { error: tx(e) }) : t('Не удалось продолжить: {error}', { error: tx(e) }), 'error'))
}

export const runningMsg = (task: InstallTask, text: string): string =>
  task.paused ? (text ? t('На паузе · {text}', { text }) : t('На паузе')) : text

export function initInstalls(): void {
  if (!hasTauri()) return
  void listenInstallProgress((p) => {
    const known = useInstalls.getState().tasks[p.key]
    if (p.done) {
      // Reported here and in runInstall alike: whichever lands second carries
      // the same text and is dropped by the reporter's per-session dedupe.
      if (p.error && !isCancelled(p.error)) {
        void reportInstallFailure(p.key, p.title, p.error)
        trackInstallFailure(p.key, p.error)
      }
      if (!known) return
      if (p.error && known.state === 'run') {
        const cancelled = isCancelled(p.error)
        useInstalls.getState().patch(p.key, {
          label: '',
          msg: cancelled ? CANCELLED_MSG : p.error,
          state: 'error',
        })
        fade(p.key, cancelled ? HIDE_MS : 4000)
        return
      }
      if (!p.error && known.state === 'run') {
        markDone(p.key)
        useInstalls.getState().patch(p.key, { label: t('Установлено'), pct: 100, msg: '', state: 'done' })
        fade(p.key)
      }
      return
    }
    if (!known) {
      useInstalls.getState().patch(p.key, { title: p.title, label: t('Ставим…'), pct: p.pct, msg: p.msg, pausable: p.pausable, eta: p.eta ?? null })
      return
    }
    useInstalls.getState().patch(p.key, { title: p.title || known.title, pct: p.pct, msg: p.msg, pausable: p.pausable, eta: p.eta ?? null })
  })
  void activeInstalls()
    .then((list) => {
      for (const j of list || []) {
        if (useInstalls.getState().tasks[j.key]) continue
        useInstalls.getState().patch(j.key, {
          title: j.title,
          label: t('Ставим…'),
          pct: j.pct,
          msg: j.msg,
          paused: j.paused,
          pausable: j.pausable,
        })
      }
    })
    .catch(() => {})
}
