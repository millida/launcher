import { hasTauri } from '../../ipc/tauri'
import { createProfile } from '../../ipc/commands'
import { installContentFlow } from '../../lib/install'
import { track, trackFailure } from '../../lib/telemetry'
import { useMods, type ModHit } from '../../state/mods'
import { useProfiles } from '../../state/profiles'
import { showToast } from '../../state/ui'

/*
 * «Новая сборка» из плитки каталога: сборка под версию и загрузчик самой вещи,
 * и вещь сразу в неё. Как Profile в CurseForge — человек не выбирает версию
 * руками и не ловит «поставил, а оно не той версии».
 */

const RELEASE = /^\d+\.\d+(\.\d+)?$/
const LOADER_ORDER = ['fabric', 'neoforge', 'forge', 'quilt']

function cmpVer(a: string, b: string): number {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (x[i] || 0) - (y[i] || 0)
    if (d) return d
  }
  return 0
}

/** Свежий релиз, под который вещь вышла. */
export function newestRelease(vers?: string[]): string {
  const rel = (vers || []).filter((v) => RELEASE.test(v))
  return rel.sort(cmpVer).pop() || ''
}

/** Версия и загрузчик новой сборки, или null — если по вещи их не понять. */
export function planFor(h: ModHit, kind: string): { version: string; loader: string } | null {
  const version = newestRelease(h.gameVers)
  if (!version) return null
  if (kind === 'mod') {
    const loader = LOADER_ORDER.find((l) => (h.loaders || []).includes(l))
    return loader ? { version, loader } : null
  }
  // Шейдеру нужен Iris, а Iris живёт на Fabric.
  if (kind === 'shader') return { version, loader: 'fabric' }
  if (kind === 'resourcepack' || kind === 'datapack') return { version, loader: 'vanilla' }
  return null
}

export async function newBuildFrom(h: ModHit, kind: string): Promise<void> {
  const plan = planFor(h, kind)
  if (!plan) return
  if (!hasTauri()) {
    showToast('Сборки создаются в приложении')
    return
  }
  const { version, loader } = plan
  let name = ''
  try {
    const p = await createProfile(h.title.slice(0, 24), version, loader === 'fabric', loader, null)
    name = p.name
  } catch (e) {
    trackFailure('build_create', e, { step: 'create', from: 'catalog', mc: version, loader })
    showToast('Не удалось создать сборку: ' + e, 'error')
    return
  }
  track('build_create', { mc: version, loader, from: 'catalog' })
  await useProfiles.getState().refresh()
  useProfiles.getState().setSelected(name)
  useMods.getState().scopeTo(name)
  showToast('Сборка «' + name + '» · ' + version, 'ok', 'install')
  const src =
    h.cfid !== undefined
      ? { source: 'curseforge' as const, cfid: h.cfid }
      : { source: 'modrinth' as const, slug: h.slug }
  if (kind === 'shader') await installContentFlow({ source: 'modrinth', slug: 'iris' }, 'mod', 'Iris')
  await installContentFlow(src, kind, h.title)
  void useMods.getState().load()
}
