import { api } from './api'
import { apiErrorText } from './apiError'
import { DEMO_USER } from './demo'
import type { DepAudit, PlanItem } from '../ipc/commands'

/*
 * ИИ-сборщик: клиент адреса `POST /v2/catalog/ai/build` (контракт —
 * millida-services/docs/catalog-ai-builder.md). Сервер отдаёт план из
 * РЕАЛЬНЫХ проектов Modrinth; зависимости не считает — их тянет ядро при
 * установке (`install_dep_items` ставит каждый мод с его обязательными).
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
}

export interface AiQuota {
  enabled: boolean
  limit: number
  remaining: number
  plus: boolean
}

export const AI_SOON = 'ИИ-сборщик скоро заработает'
export const AI_LIMIT = 'Лимит на сегодня — 3 сборки, в PLUS — 30'

/** Без них моды загрузчика не стартуют — снимать галочку нельзя. */
export const LOCKED_SLUGS = new Set(['fabric-api', 'qsl'])

export const PROMPT_MIN = 5
export const PROMPT_MAX = 500

/**
 * Текст ошибки для игрока. В приложении ядро отдаёт `message` сервера как есть
 * (он уже по-русски), в браузере приходит голое «http 503» — его переводим сами.
 */
export function aiErrorText(e: unknown): string {
  const raw = String((e as { message?: string } | null)?.message ?? e ?? '').replace(/^Error:\s*/, '')
  if (/\bhttp 503\b/i.test(raw) || /^service unavailable$/i.test(raw)) return AI_SOON
  if (/\bhttp 429\b/i.test(raw) || /^too many requests$/i.test(raw) || /^throttlerexception/i.test(raw)) return AI_LIMIT
  if (/\bhttp 50[24]\b/i.test(raw)) return 'ИИ не ответил — попробуй ещё раз'
  return apiErrorText(e, 'ИИ не ответил — попробуй ещё раз')
}

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

export async function buildPlan(prompt: string, opts: AiPreset = {}, fresh = false): Promise<AiPlan> {
  const body = { prompt: prompt.trim().slice(0, PROMPT_MAX), ...opts, ...(fresh ? { fresh: true } : {}) }
  if (import.meta.env.DEV && DEMO_USER) return demoPlan(body.prompt, opts)
  return api<AiPlan>('/catalog/ai/build', { method: 'POST', body: JSON.stringify(body) })
}

export async function aiQuota(): Promise<AiQuota | null> {
  if (import.meta.env.DEV && DEMO_USER) return { enabled: true, limit: 3, remaining: DEMO_LEFT, plus: false }
  return api<AiQuota>('/catalog/ai/quota').catch(() => null)
}

/** Примеры под полем: нажал — поле заполнилось. */
export const AI_EXAMPLES = ['Хоррор с зомби на 1.20.1', 'Техно и заводы', 'Уютная ферма с едой', 'Магия и данжи']

// ─── Демо (?preview=user, только dev) ────────────────────────────────────
// Настоящие проекты Modrinth: id, slug, иконки — из ответа /v2/projects
// 24.09.2026. Выдуман только текст «зачем».

let DEMO_LEFT = 3

const cdn = (id: string, file: string) => 'https://cdn.modrinth.com/data/' + id + '/' + file

const DEMO_MODS: AiMod[] = [
  { projectId: 'P7dR8mSH', slug: 'fabric-api', title: 'Fabric API', icon: cdn('P7dR8mSH', 'icon.png'), why: 'Основа модов Fabric — без неё они не запустятся', source: 'modrinth', base: true },
  { projectId: 'AANobbMI', slug: 'sodium', title: 'Sodium', icon: cdn('AANobbMI', '295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp'), why: 'Больше FPS: быстрая отрисовка мира', source: 'modrinth', base: true },
  { projectId: 'mOgUt4GM', slug: 'modmenu', title: 'Mod Menu', icon: cdn('mOgUt4GM', '5a20ed1450a0e1e79a1fe04e61bb4e5878bf1d20.png'), why: 'Список модов и их настройки прямо в меню', source: 'modrinth', base: true },
  { projectId: 'mMTOWOaA', slug: 'zombie-awareness', title: 'Zombie Awareness', icon: cdn('mMTOWOaA', 'a05ff0c2146142ba350fe458c6a9d0691cdfd0a8_96.webp'), why: 'Зомби идут на шум, свет и запах крови', source: 'modrinth', base: false },
  { projectId: 'iAqn9vit', slug: 'mo-zombies-wave', title: "Mo' Zombies Wave", icon: cdn('iAqn9vit', 'b7e0c1ad55a068448762f370349bb56cc04d249a_96.webp'), why: '13 новых видов зомби со своими повадками', source: 'modrinth', base: false },
  { projectId: 'owDBGfRd', slug: 'zombie-horse-spawn', title: 'Zombie Horse Spawn', icon: cdn('owDBGfRd', 'd78c8cbacb6bde5cfac9d65431b459216ead5071_96.webp'), why: 'Зомби-всадники на мёртвых лошадях', source: 'modrinth', base: false },
  { projectId: 'cChd25Tw', slug: 'cave-dweller-fabric', title: 'Cave Dweller Fabric', icon: cdn('cChd25Tw', '99cc719af9b3dcee0e8fcece688d7d3f6ebd49a8_96.webp'), why: 'Тварь в пещерах, которая охотится молча', source: 'modrinth', base: false },
  { projectId: 'p1WH6sHr', slug: 'from-the-fog', title: 'From The Fog', icon: cdn('p1WH6sHr', 'bb4b839b9cd0f1dc51ee5ac08081fb76df42ebe1_96.webp'), why: 'Херобрин следит из тумана', source: 'modrinth', base: false },
  { projectId: 'Pf8PJBb5', slug: 'true-darkness-refabricated', title: 'True Darkness Refabricated', icon: cdn('Pf8PJBb5', '93a5193f0aedb0d5822caa569df212f6f7360473_96.webp'), why: 'Ночь и пещеры по-настоящему чёрные', source: 'modrinth', base: false },
  { projectId: 'yBW8D80W', slug: 'lambdynamiclights', title: 'LambDynamicLights', icon: cdn('yBW8D80W', 'd4f5c3ff8df7caf024178b04eca6d69f95979cfe_96.webp'), why: 'Факел в руке освещает путь', source: 'modrinth', base: false },
  { projectId: 'qyVF9oeo', slug: 'sound-physics-remastered', title: 'Sound Physics Remastered', icon: cdn('qyVF9oeo', '798fbfae58ec95ad51f3e1d522b43227306c326c.png'), why: 'Эхо в пещерах, звук глохнет за стеной', source: 'modrinth', base: false },
  { projectId: 'fLAIO8XF', slug: 'abandoned-villages', title: '80% Abandoned Villages', icon: cdn('fLAIO8XF', '2b28d7e01921d9c314da85ff0c50ab3f02291a41.jpeg'), why: 'Почти все деревни — заброшенные и зомби', source: 'modrinth', base: false },
  { projectId: 'dxrOAhj5', slug: 'horror-messages', title: 'Horror messages', icon: cdn('dxrOAhj5', '2f352e073728145924cb3be5d33898adef7dda25_96.webp'), why: 'Жуткие сообщения в чате раз в 10–15 минут', source: 'modrinth', base: false },
]

const DEMO_PACKS: AiMod[] = [
  { projectId: '50dA9Sha', slug: 'fresh-animations', title: 'Fresh Animations', icon: cdn('50dA9Sha', '3132c10e9e3c73fde9799720fd3da5561071708c_96.webp'), why: 'Зомби двигаются живее и страшнее', source: 'modrinth', base: false },
]

const DEMO_SHADERS: AiMod[] = [
  { projectId: 'HVnmMxH1', slug: 'complementary-reimagined', title: 'Complementary Reimagined', icon: cdn('HVnmMxH1', '79cb7c8123bbc54945305b2ebad6b8881efdf5f8_96.webp'), why: 'Густые тени и туман по ночам', source: 'modrinth', base: false },
]

const DEMO_IRIS: AiMod = { projectId: 'YL57xq9U', slug: 'iris', title: 'Iris Shaders', icon: cdn('YL57xq9U', '18d0e7f076d3d6ed5bedd472b853909aac5da202_96.webp'), why: 'Нужен, чтобы работали шейдеры', source: 'modrinth', base: true }

async function demoPlan(prompt: string, opts: AiPreset): Promise<AiPlan> {
  await new Promise((r) => setTimeout(r, 2600))
  if (DEMO_LEFT <= 0) throw new Error('http 429')
  DEMO_LEFT -= 1
  void prompt
  return {
    title: 'Ночь мертвецов',
    mcVersion: opts.mcVersion || '1.20.1',
    loader: opts.loader || 'fabric',
    mods: DEMO_MODS,
    resourcepacks: DEMO_PACKS,
    shaders: DEMO_SHADERS,
    shaderLoader: DEMO_IRIS,
    notes: 'Играй ночью и держи факелы под рукой',
    limit: 3,
    remaining: DEMO_LEFT,
  }
}
