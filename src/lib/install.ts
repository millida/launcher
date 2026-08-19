import { hasTauri } from '../ipc/tauri'
import { cfInstall, depPlan, installContent, installDepItems } from '../ipc/commands'
import type { ContentInstall, DepReport, PlanItem } from '../ipc/commands'
import { askDepPlan } from '../state/depPlan'
import { planNeedsPrompt } from './deps'
import { useProfiles } from '../state/profiles'
import { useMods } from '../state/mods'
import { pickBuild } from '../state/buildPicker'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import { track, trackTimed } from './telemetry'
import { runInstall } from '../state/installs'
import { keyContent } from './installKeys'
import { LOADER_NAME } from './format'

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

interface Source {
  source: 'modrinth' | 'curseforge'
  slug?: string
  cfid?: number
}

function buildOf(name: string) {
  return useProfiles.getState().profiles.find((x) => x.name === name)
}

/// Content built for another game version starts, then crashes the game, so an
/// install that does not fit is confirmed by the user rather than assumed.
async function confirmMismatch(title: string, prof: string, mismatch: string): Promise<boolean> {
  const pr = buildOf(prof)
  return uiConfirm(
    '«' +
      title +
      '» нет под ' +
      (pr ? pr.version + ' · ' + LOADER_NAME(pr) : 'эту сборку') +
      ' — есть только под ' +
      mismatch +
      '. Такой файл обычно не даёт игре запуститься. Поставить всё равно?',
    { title: 'Версия не совпадает', confirmLabel: 'Поставить', danger: true },
  )
}

/// The optional dependencies the user ticked. Hard ones are pulled in by the
/// core during the install itself, so a failure here never leaves the mod
/// without what it cannot run without.
export function installExtras(prof: string, kind: string, extras: PlanItem[], after?: () => void) {
  if (!extras.length) return
  runInstall<DepReport>({
    key: keyContent('mr', prof, kind, 'millida:deps'),
    title: 'Дополнения',
    running: 'Ставим дополнительные моды…',
    run: () => installDepItems(prof, kind, extras),
    onDone: (r) => {
      if (r.failed.length) showToast('Не встало: ' + r.failed.join('; '), 'error')
      else showToast('Дополнительно поставлено: ' + r.installed.length, 'ok', 'install')
      if (after) after()
    },
    onError: (e) => showToast('' + e, 'error'),
  })
}

/// Same question for a hand-picked version: the file is fixed, but what it drags
/// in is not. Returns the optional extras to install alongside, or null when the
/// user backed out.
export async function askPlanForVersion(
  prof: string,
  kind: string,
  source: 'modrinth' | 'curseforge',
  project: string,
  versionId: string,
): Promise<PlanItem[] | null> {
  if (kind !== 'mod') return []
  const plan = await depPlan(prof, kind, source, project, versionId).catch(() => null)
  if (!planNeedsPrompt(plan)) return []
  const decision = await askDepPlan(plan!)
  return decision.go ? decision.extras : null
}

export async function installContentFlow(src: Source, kind: string, title?: string): Promise<boolean> {
  if (!hasTauri()) {
    showToast('Установка доступна в приложении')
    return false
  }
  const prof = await resolveTargetBuild(kind)
  if (!prof) return false
  // A build that only needs the mod itself must stay one click, so the window
  // opens only when the plan actually has something to decide or to warn about.
  let extras: PlanItem[] = []
  if (kind === 'mod') {
    const plan = await depPlan(
      prof,
      kind,
      src.source,
      src.source === 'curseforge' ? String(src.cfid) : src.slug!,
    ).catch(() => null)
    if (planNeedsPrompt(plan)) {
      const decision = await askDepPlan(plan!)
      if (!decision.go) return false
      extras = decision.extras
    }
  }
  const pr = buildOf(prof)
  const gv = (pr && pr.version) || ''
  const loader = (pr && (pr.loader || (pr.fabric ? 'fabric' : 'vanilla'))) || 'vanilla'
  const label = title || src.slug || String(src.cfid)
  const key =
    src.source === 'curseforge'
      ? keyContent('cf', prof, kind, src.cfid!)
      : keyContent('mr', prof, kind, src.slug!)

  const start = (allowMismatch: boolean): boolean => {
    const startedAt = performance.now()
    return runInstall<ContentInstall>({
      key,
      title: label,
      running: allowMismatch ? 'Ставим всё равно…' : 'Скачивание…',
      run: () =>
        src.source === 'curseforge'
          ? cfInstall(src.cfid!, gv, prof, kind, undefined, allowMismatch)
          : installContent(src.slug!, gv, prof, kind, allowMismatch),
      keepOpen: (r) => !r.file,
      onDone: (r) => {
        if (!r.file) {
          void confirmMismatch(label, prof, r.mismatch).then((ok) => {
            if (ok) start(true)
          })
          return
        }
        trackTimed('content_install', startedAt, { name: label, kind, mc: gv, loader, source: src.source })
        void useMods.getState().refreshInstalled()
        installExtras(prof, kind, extras)
        showToast(
          (RU[kind] || 'Контент') + ' → «' + prof + '»: ' + r.file + (r.warning ? ' · ' + r.warning : ''),
          'ok',
          'install',
        )
      },
      onError: (err) => {
        trackTimed(
          'content_install',
          startedAt,
          { name: label, kind, mc: gv, loader, source: src.source, code: String(err).slice(0, 120) },
          false,
        )
        track('error', { code: String(err).slice(0, 120), where: 'content_install' }, { ok: false })
        showToast('' + err, 'error')
      },
    })
  }

  return start(false)
}
