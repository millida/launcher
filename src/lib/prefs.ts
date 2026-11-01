import { hasTauri } from '../ipc/tauri'

// localStorage in the webview is committed to disk lazily, and quitting through
// the tray kills the process before the commit lands, so the last change a user
// made was silently rolled back on the next start. These keys are mirrored into
// a file the core writes atomically; the disk copy wins on boot.
const DURABLE = [
  'm-mus-vol',
  'm-mus-muted',
  'm-mus-auto',
  'm-mus-play',
  'm-mus-radio',
  'm-mus-link-0',
  'm-mus-link-1',
  'm-mus-link-2',
  'm-mus-link-3',
  'm-mus-link-4',
  'm-mus-link-5',
  'm-mus-link-6',
  'm-mus-link-7',
  'm-sound-vol',
  'm-sound-mode',
  'm-accent',
  'm-density',
  'm-onb-done',
  'm-tour-done',
  'm-mil-ever',
  'm-hint-hosting',
  'm-seen-cosmetics',
  'm-notify-msg',
  'm-notify-play',
  'm-notify-online',
  'm-notify-request',
  'm-notify-room',
  'm-beta',
  'm-remote-ui-off',
  'm-anim-char',
  'm-anim-bg',
  'm-tab-ms',
  'm-perf-mode',
  'm-ptheme',
  'm-layout',
  'm-ptheme-prev',
  'm-ptheme-auto',
  'm-ptheme-user',
  'm-app-icon',
  'm-lang',
  'm-first-run',
  'm-lag-off',
  'm-lag-pending',
  'm-live-log',
  'm-gfx-preset',
  // Отказ от статистики: потерянная запись молча включает отправку снова.
  'm-telemetry-off',
] as const

export type PrefKey = (typeof DURABLE)[number]

const WRITE_DELAY_MS = 250
const HYDRATE_TIMEOUT_MS = 1500

const pending = new Map<PrefKey, string>()
let timer: ReturnType<typeof setTimeout> | null = null

export function readPref(key: PrefKey, fallback: string): string {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v
  } catch {
    return fallback
  }
}

export function writePref(key: PrefKey, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {}
  if (!hasTauri()) return
  pending.set(key, value)
  schedule()
}

function schedule() {
  if (timer || !pending.size) return
  timer = setTimeout(() => {
    timer = null
    void flushPrefs()
  }, WRITE_DELAY_MS)
}

export async function flushPrefs(): Promise<void> {
  if (!hasTauri() || !pending.size) return
  const batch = [...pending]
  pending.clear()
  const { setUiPref } = await ipc()
  await Promise.all(
    batch.map(([key, value]) =>
      setUiPref(key, value).catch(() => {
        if (!pending.has(key)) pending.set(key, value)
      }),
    ),
  )
  schedule()
}

// i18n reads prefs and the IPC layer reaches i18n through state/ui, so a static import here would close an import cycle.
const ipc = () => import('../ipc/commands')

const timeout = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function hydratePrefs(): Promise<void> {
  if (!hasTauri()) return
  await Promise.race([load(), timeout(HYDRATE_TIMEOUT_MS)])
}

async function load(): Promise<void> {
  try {
    const { uiPrefs } = await ipc()
    const stored = await uiPrefs()
    DURABLE.forEach((key) => {
      const v = stored[key]
      if (typeof v === 'string') localStorage.setItem(key, v)
    })
  } catch {}
}
