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
}

interface InstallsState {
  tasks: Record<string, InstallTask>
  done: Record<string, true>
  patch: (key: string, t: Partial<InstallTask> & { title?: string }) => void
  drop: (key: string) => void
}

export const useInstalls = create<InstallsState>((set, get) => ({
  tasks: {},
  done: {},
  patch: (key, t) => {
    const prev = get().tasks[key]
    const next: InstallTask = {
      key,
      title: t.title || (prev && prev.title) || '',
      label: t.label || (prev && prev.label) || 'Ставим…',
      msg: t.msg !== undefined ? t.msg : (prev && prev.msg) || '',
      pct: t.pct !== undefined ? t.pct : (prev && prev.pct) || 0,
      state: t.state || (prev && prev.state) || 'run',
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

const markDone = (key: string) => useInstalls.setState((s) => ({ done: { ...s.done, [key]: true } }))

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
  })
  o.run()
    .then((r) => {
      if (o.keepOpen && o.keepOpen(r)) {
        useInstalls.getState().drop(o.key)
      } else {
        markDone(o.key)
        useInstalls.getState().patch(o.key, { label: 'Установлено', pct: 100, msg: '', state: 'done' })
        fade(o.key)
      }
      if (o.onDone) o.onDone(r)
    })
    .catch((e) => {
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
  void cancelInstall(key).catch(() => {})
}

export function initInstalls(): void {
  if (!hasTauri()) return
  void listenInstallProgress((p) => {
    const known = useInstalls.getState().tasks[p.key]
    if (p.done) {
      if (!known) return
      if (p.error && known.state === 'run') {
        useInstalls.getState().patch(p.key, { label: '', msg: p.error, state: 'error' })
        fade(p.key, 4000)
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
