import type { DepAudit, PlanItem } from '../ipc/commands'

/*
 * Общее для ИИ-сборки: типы плана из РЕАЛЬНЫХ проектов Modrinth, базовые моды
 * без галочки и проверка зависимостей после установки. Сам чат — Милли
 * (`lib/milli.ts`), установка — `lib/aiInstall.ts` (`install_dep_items` ставит
 * каждый мод с его обязательными).
 */

export type AiLoader = 'fabric' | 'forge' | 'neoforge' | 'quilt'

const AI_LOADERS: readonly string[] = ['fabric', 'forge', 'neoforge', 'quilt']
/** The server accepts release versions only; a snapshot would come back as 400. */
const AI_MC_VERSION_RX = /^(?:1|2[6-9]|[3-9]\d)\.\d{1,2}(?:\.\d{1,2})?$/

export interface AiPreset {
  mcVersion?: string
  loader?: AiLoader
}

/** Version and loader picked in «Новая сборка», only what the server will accept. */
export function aiPresetFor(loader: string, mcVersion: string): AiPreset {
  const out: AiPreset = {}
  if (AI_MC_VERSION_RX.test(mcVersion)) out.mcVersion = mcVersion
  if (AI_LOADERS.includes(loader)) out.loader = loader as AiLoader
  return out
}

export interface AiMod {
  projectId: string
  slug: string
  title: string
  icon: string | null
  why: string
  source: 'modrinth'
  /** Базовый мод по правилам сервера (API загрузчика, оптимизация). */
  base: boolean
}

export interface AiExcluded {
  slug: string
  title: string
  reason: string
  detail: string
}

export interface AiPlan {
  title: string
  mcVersion: string
  loader: AiLoader
  mods: AiMod[]
  /** Absent in plans built before resource packs and shaders were picked. */
  resourcepacks?: AiMod[]
  shaders?: AiMod[]
  /** Iris or Oculus; installed only together with a chosen shader. */
  shaderLoader?: AiMod | null
  notes: string
  limit: number
  remaining: number
  /** The plan was served from the cache of earlier builds. */
  cached?: boolean
  /** Mods the server kept out of the plan and why; absent in older plans. */
  excluded?: AiExcluded[]
}

/** Без них моды загрузчика не стартуют — снимать галочку нельзя. */
export const LOCKED_SLUGS = new Set(['fabric-api', 'qsl'])

/** Same text and same version/loader: asking again means the player wants a new build, not the cached one. */
export function planRequestKey(prompt: string, opts: AiPreset = {}): string {
  return [prompt.trim().toLowerCase(), opts.mcVersion ?? '', opts.loader ?? ''].join('|')
}

/**
 * Fixes the core's audit found for a freshly built pack: mods whose jars
 * require a library their Modrinth page does not list. One item per project.
 */
export function auditFixItems(audit: Pick<DepAudit, 'issues'>): PlanItem[] {
  const seen = new Set<string>()
  const out: PlanItem[] = []
  for (const issue of audit.issues) {
    const fix = issue.fix
    if (issue.kind !== 'missing' || !fix || !fix.project_id || seen.has(fix.project_id)) continue
    seen.add(fix.project_id)
    out.push({ source: fix.source, project_id: fix.project_id, version_id: fix.version_id })
  }
  return out
}

const EXCLUDED_WHY: Record<string, string> = {
  quarantine: 'ломает запуск на этой версии',
  wrong_mc: 'не для этой версии игры',
  dep_version: 'не уживается с версией своей зависимости',
  duplicate: 'повтор мода',
}

/** One line per mod the server left out, so the player sees why a mod they may expect is missing. */
export function excludedLines(list: AiExcluded[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of list ?? []) {
    const line = e.title + ' — ' + (EXCLUDED_WHY[e.reason] ?? e.detail)
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

/** What still keeps the pack from starting after the fixes were installed: a pack with these is not ready. */
export function auditProblems(audit: Pick<DepAudit, 'issues'>): string[] {
  return [...new Set(audit.issues.map((i) => i.title + ': ' + i.detail))]
}
