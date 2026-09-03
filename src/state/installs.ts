import { create } from 'zustand'
import { activeInstalls, cancelInstall } from '../ipc/commands'
import { listenInstallProgress } from '../ipc/events'
import { hasTauri } from '../ipc/tauri'
import { showToast } from './ui'

// Install jobs live in the core and outlive the component that started them, so
// state is global and keyed exactly like the core job registry. A second attempt
// attaches to the running job instead of racing it over the same temp files.

export type InstallState = 'run' | 'done' | 'error'

export interface InstallTask {
  key: string
  title: string
  label: string
  msg: string
  pct: number
  state: InstallState
  versionId?: string
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
  patch: (key, t) => {
    const prev = get().tasks[key]
    const next: InstallTask = {
      key,
      title: t.title || (prev && prev.title) || '',
      label: t.label || (prev && prev.label) || 'Ставим…',
      msg: t.msg !== undefined ? t.msg : (prev && prev.msg) || '',
      pct: t.pct !== undefined ? t.pct : (prev && prev.pct) || 0,
      state: t.state || (prev && prev.state) || 'run',
      versionId: t.versionId !== undefined ? t.versionId : prev && prev.versionId,
    }
    set({ tasks: { ...get().tasks, [key]: next } })
  },
  drop: (key) => {
    const tasks = { ...get().tasks }
    delete tasks[key]
    set({ tasks })
  },
}))

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
const CANCELLED = 'Установка отменена'

export const isCancelled = (e: unknown): boolean => String(e).includes(CANCELLED)

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
  keepOpen?: (r: T) => boolean
  // Which version this call targets, when the key covers a whole project —
  // lets the UI show progress only on that version's row instead of every one.
  versionId?: string
}

export function runInstall<T>(o: RunOptions<T>): boolean {
  const cur = useInstalls.getState().tasks[o.key]
  if (cur && cur.state === 'run') {
    showToast('«' + (cur.title || o.title) + '» уже ставится' + (cur.msg ? ': ' + cur.msg : ''))
    return false
  }
  clearTimeout(hideTimers[o.key])
  useInstalls.getState().patch(o.key, {
    title: o.title,
    label: o.running || 'Ставим…',
    msg: '',
    pct: 0,
    state: 'run',
    versionId: o.versionId,
  })
  o.run()
    .then((r) => {
      if (o.keepOpen && o.keepOpen(r)) {
        useInstalls.getState().drop(o.key)
      } else {
        markDone(o.key, o.versionId)
        useInstalls.getState().patch(o.key, { label: 'Установлено', pct: 100, msg: '', state: 'done' })
        fade(o.key)
      }
      if (o.onDone) o.onDone(r)
    })
    .catch((e) => {
      if (isCancelled(e)) {
        useInstalls.getState().patch(o.key, { label: '', msg: 'Отменено', state: 'error' })
        fade(o.key)
        showToast('Установка «' + (o.title || '') + '» отменена', 'ok', false)
        return
      }
      useInstalls.getState().patch(o.key, { label: '', msg: String(e), state: 'error' })
      fade(o.key, 4000)
      if (o.onError) o.onError(e)
      else showToast('' + e, 'error')
    })
  return true
}

export function stopInstall(key: string): void {
  const t = useInstalls.getState().tasks[key]
  if (!t || t.state !== 'run') return
  useInstalls.getState().patch(key, { msg: 'Отменяем…' })
  void cancelInstall(key)
    .then((stopped) => {
      // Ядро уже не знает такой задачи: экран показывал прогресс, которого нет,
      // и «Отменить» выглядело сломанным. Убираем карточку сами.
      if (!stopped) useInstalls.getState().drop(key)
    })
    .catch((e) => showToast('Не удалось отменить: ' + e, 'error'))
}

export function initInstalls(): void {
  if (!hasTauri()) return
  void listenInstallProgress((p) => {
    const known = useInstalls.getState().tasks[p.key]
    if (p.done) {
      if (!known) return
      if (p.error && known.state === 'run') {
        const cancelled = isCancelled(p.error)
        useInstalls.getState().patch(p.key, {
          label: '',
          msg: cancelled ? 'Отменено' : p.error,
          state: 'error',
        })
        fade(p.key, cancelled ? HIDE_MS : 4000)
        return
      }
      if (!p.error && known.state === 'run') {
        markDone(p.key)
        useInstalls.getState().patch(p.key, { label: 'Установлено', pct: 100, msg: '', state: 'done' })
        fade(p.key)
      }
      return
    }
    if (!known) {
      useInstalls.getState().patch(p.key, { title: p.title, label: 'Ставим…', pct: p.pct, msg: p.msg })
      return
    }
    useInstalls.getState().patch(p.key, { title: p.title || known.title, pct: p.pct, msg: p.msg })
  })
  void activeInstalls()
    .then((list) => {
      for (const j of list || []) {
        if (useInstalls.getState().tasks[j.key]) continue
        useInstalls.getState().patch(j.key, { title: j.title, label: 'Ставим…', pct: j.pct, msg: j.msg })
      }
    })
    .catch(() => {})
}
