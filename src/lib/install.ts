import { hasTauri } from '../ipc/tauri'
import { installContent } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { useMods } from '../state/mods'
import { pickBuild } from '../state/buildPicker'
import { showToast } from '../state/ui'
import { track, trackTimed } from './telemetry'
import { runInstall } from '../state/installs'
import { keyContent } from './installKeys'

const RU: Record<string, string> = {
  mod: 'мод',
  resourcepack: 'ресурспак',
  datapack: 'дата-пак',
  shader: 'шейдер',
  world: 'карту',
}

export async function resolveTargetBuild(kind: string): Promise<string | null> {
  const scoped = useMods.getState().targetBuild
  if (scoped && useProfiles.getState().profiles.some((p) => p.name === scoped)) return scoped
  const profiles = useProfiles.getState().profiles
  if (profiles.length === 1) return profiles[0].name
  return pickBuild(RU[kind] || 'контент')
}

export async function installContentFlow(slug: string, kind: string, title?: string): Promise<boolean> {
  if (!hasTauri()) return false
  const prof = await resolveTargetBuild(kind)
  if (!prof) return false
  const pr = useProfiles.getState().profiles.find((x) => x.name === prof)
  const gv = (pr && pr.version) || (useProfiles.getState().profiles[0] && useProfiles.getState().profiles[0].version) || '1.21.4'
  const loader = (pr && (pr.loader || (pr.fabric ? 'fabric' : 'vanilla'))) || 'vanilla'
  const startedAt = performance.now()
  return runInstall({
    key: keyContent('mr', prof, kind, slug),
    title: title || slug,
    running: 'Скачивание…',
    run: () => installContent(slug, gv, prof, kind),
    onDone: (f) => {
      trackTimed('content_install', startedAt, { name: slug, kind, mc: gv, loader })
      showToast((RU[kind] || 'Контент') + ' → «' + prof + '»: ' + f, 'ok', 'install')
    },
    onError: (err) => {
      trackTimed('content_install', startedAt, { name: slug, kind, mc: gv, loader, code: String(err).slice(0, 120) }, false)
      track('error', { code: String(err).slice(0, 120), where: 'content_install' }, { ok: false })
      showToast('' + err, 'error')
    },
  })
}
