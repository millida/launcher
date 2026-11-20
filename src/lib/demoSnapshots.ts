import type { MilliSnap } from './milliLocal'
import { DEMO_MODS } from './demoMods'

/** Browser preview only (?preview, DEV): build snapshots and mod dependencies without the core. */
const NOW = Math.floor(Date.now() / 1000)
const DIRS = ['mods', 'config', 'resourcepacks', 'shaderpacks']
let seq = 0

const make = (label: string, ago: number, auto: boolean, mods: number): MilliSnap => ({
  id: 's' + (NOW - ago).toString(36) + (seq++).toString(36),
  label,
  at: NOW - ago,
  bytes: mods * 1_200_000 + 2_400_000,
  disk: 2_400_000,
  files: mods + 46,
  mods,
  auto,
  dirs: DIRS,
})

let list: MilliSnap[] = [
  make('Перед «Обновить всё»', 2 * 3600, true, DEMO_MODS.length),
  make('Рабочая версия', 3 * 86400, false, DEMO_MODS.length - 1),
  make('Перед откатом', 6 * 86400, true, DEMO_MODS.length - 2),
]

const pause = () => new Promise((r) => setTimeout(r, 400))

export const demoSnapshots = {
  list: async (): Promise<MilliSnap[]> => [...list],
  take: async (label: string, auto: boolean): Promise<MilliSnap> => {
    await pause()
    const snap = make(label.trim() || 'Снимок', 0, auto, DEMO_MODS.length)
    list = [snap, ...list]
    return snap
  },
  restore: async (id: string): Promise<MilliSnap> => {
    await pause()
    if (!list.some((s) => s.id === id)) throw new Error('Этого снимка уже нет: обнови список')
    const before = make('Перед откатом', 0, true, DEMO_MODS.length)
    list = [before, ...list]
    return before
  },
  remove: async (id: string): Promise<void> => {
    list = list.filter((s) => s.id !== id)
  },
}

/** Who needs whom among the demo mods: Modrinth project -> projects that require it. */
const NEEDED_BY: Record<string, string[]> = {
  P7dR8mSH: ['mOgUt4GM', 'NNAgCjsB', '1bokaNcj', '9s6osm5g'],
  AANobbMI: ['YL57xq9U'],
}

export function demoDependents(files: string[]): string[] {
  const leaving = new Set(files)
  const out: string[] = []
  for (const name of files) {
    const mod = DEMO_MODS.find((m) => m.name === name)
    for (const id of (mod?.project_id && NEEDED_BY[mod.project_id]) || []) {
      const dep = DEMO_MODS.find((m) => m.project_id === id)
      if (!dep || !dep.enabled || leaving.has(dep.name)) continue
      const title = dep.title || dep.name
      if (!out.includes(title)) out.push(title)
    }
  }
  return out
}

export async function showToastDemo(kind: string): Promise<void> {
  const { showToast } = await import('../state/ui')
  if (kind === 'folder') {
    const { openFolderAction } = await import('./savedFile')
    showToast('Экспортировано: Моя сборка.mrpack', 'ok', undefined, openFolderAction('Моя сборка.mrpack'))
  } else if (kind === 'undo') {
    const { rollbackAction } = await import('./buildSnapshots')
    const snap = list[0]
    if (snap) showToast('Обновлено: 3', 'ok', undefined, rollbackAction('demo', snap, () => {}))
  }
}
