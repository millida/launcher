import type { MilliChosen, MilliConfig, MilliItem, MilliLevel, MilliPack, MilliProfile, MilliRpStyle } from '../../../lib/milli'

/*
 * Чистые функции вкладок верстака «Шейдеры», «Ресурс-паки», «Настройки» и
 * установки из верстака. Значения пресетов — те же, что в
 * milli-server/src/presets.ts (сверено с BE-catalog 04.10.2026): сервер всё
 * равно клэмпит сам, здесь — чтобы ползунки не обещали лишнего.
 */

// ─── Шейдеры ───────────────────────────────────────────────────────────

export const SHADER_LEVELS: readonly { id: MilliLevel; ru: string; icon: string }[] = [
  { id: 'off', ru: 'Без', icon: 'barrier' },
  { id: 'light', ru: 'Лёгкие', icon: 'torch' },
  { id: 'medium', ru: 'Средние', icon: 'redstone_lamp_on' },
  { id: 'heavy', ru: 'Тяжёлые', icon: 'glowstone_bright' },
]

const removedSet = (pack: Pick<MilliPack, 'userRemoved'>) => new Set(Array.isArray(pack.userRemoved) ? pack.userRemoved : [])

/** Активный шейдер (он всегда один): первый в сборке, не убранный игроком. */
export function activeShader(pack: Pick<MilliPack, 'shaders' | 'userRemoved'>): MilliItem | null {
  const gone = removedSet(pack)
  return (pack.shaders ?? []).find((s) => s && !gone.has(s.projectId)) ?? null
}

/** Уровень, который показывает `.seg`: от сервера, иначе по активному шейдеру. */
export function shaderLevelOf(pack: Pick<MilliPack, 'shaderLevel' | 'shaders' | 'userRemoved'>): MilliLevel {
  if (pack.shaderLevel) return pack.shaderLevel
  const a = activeShader(pack)
  return a ? (a.level ?? 'medium') : 'off'
}

/** Карточки уровня: курируемая лестница плюс активный шейдер, если его нет в лестнице. */
export function shaderCards(pack: Pick<MilliPack, 'shaderChoices' | 'shaders' | 'userRemoved' | 'shaderLevel'>, level: MilliLevel): MilliItem[] {
  if (level === 'off') return []
  const out = (pack.shaderChoices ?? []).filter((s) => s && s.level === level)
  const a = activeShader(pack)
  if (a && (a.level ?? level) === level && !out.some((s) => s.projectId === a.projectId)) out.unshift(a)
  return out
}

// ─── Ресурс-паки ───────────────────────────────────────────────────────

/** Если сервер не прислал `rpStyles` (старый ответ) — тот же набор, что в presets.ts. */
export const RP_STYLES: readonly { id: MilliRpStyle; ru: string }[] = [
  { id: 'fantasy', ru: 'Фэнтези' },
  { id: 'medieval', ru: 'Средневековье' },
  { id: 'faithful', ru: 'Как ванилла' },
  { id: 'cartoon', ru: 'Мультяшный' },
  { id: 'realistic', ru: 'Реализм' },
  { id: 'dark', ru: 'Мрачный' },
  { id: 'pvp', ru: 'ПвП' },
]

const RP_STYLE_IDS = new Set<string>(RP_STYLES.map((s) => s.id))
export const isRpStyle = (id: string): id is MilliRpStyle => RP_STYLE_IDS.has(id)

/** Названия модов, которые нужны паку (CTM → Continuity/Fusion и т.п.). Неизвестные id — пропуск. */
export function requiredTitles(item: Pick<MilliItem, 'requires'>, pack: Pick<MilliPack, 'mods' | 'shaderLoader'>): string[] {
  const req = Array.isArray(item.requires) ? item.requires : []
  if (!req.length) return []
  const byId = new Map<string, string>()
  for (const m of pack.mods ?? []) if (m) byId.set(m.projectId, m.title)
  if (pack.shaderLoader) byId.set(pack.shaderLoader.projectId, pack.shaderLoader.title)
  return req.map((id) => byId.get(id)).filter((t): t is string => !!t)
}

/** Плитки + «призраки» убранного: убранные игроком паки остаются видны с «Вернуть». */
export interface RpTile {
  item: Pick<MilliItem, 'projectId' | 'title'> & Partial<MilliItem>
  removed: boolean
}

export function rpTiles(pack: Pick<MilliPack, 'resourcepacks' | 'userRemoved' | 'changes'>): RpTile[] {
  const gone = removedSet(pack)
  const tiles: RpTile[] = (pack.resourcepacks ?? []).filter(Boolean).map((item) => ({ item, removed: gone.has(item.projectId) }))
  const seen = new Set(tiles.map((t) => t.item.projectId))
  for (const r of pack.changes?.removed ?? []) {
    if (r.tab !== 'resourcepacks' || seen.has(r.projectId)) continue
    seen.add(r.projectId)
    tiles.push({ item: { projectId: r.projectId, title: r.title }, removed: true })
  }
  return tiles
}

// ─── Настройки ─────────────────────────────────────────────────────────

export const PROFILES: readonly { id: MilliProfile; ru: string; sub: string; icon: string }[] = [
  { id: 'low', ru: 'Слабый', sub: 'до 8 ГБ', icon: 'iron_ingot' },
  { id: 'balanced', ru: 'Средний', sub: '16 ГБ', icon: 'gold_ingot' },
  { id: 'high', ru: 'Мощный', sub: '32 ГБ+', icon: 'diamond' },
]

/** Пресеты профиля (presets.ts) — для значений, которых нет в `config.options`. */
export const PROFILE_OPTIONS: Record<MilliProfile, Record<string, string>> = {
  low: { renderDistance: '6', simulationDistance: '5', graphicsMode: '0', particles: '2', biomeBlendRadius: '0', mipmapLevels: '0', renderClouds: 'false', entityShadows: 'false', ao: 'false', entityDistanceScaling: '0.75', maxFps: '60', enableVsync: 'false', lang: 'ru_ru' },
  balanced: { renderDistance: '12', simulationDistance: '8', graphicsMode: '1', particles: '1', biomeBlendRadius: '2', mipmapLevels: '4', renderClouds: 'fast', entityShadows: 'true', ao: 'true', entityDistanceScaling: '1.0', maxFps: '144', enableVsync: 'false', lang: 'ru_ru' },
  high: { renderDistance: '20', simulationDistance: '12', graphicsMode: '1', particles: '0', biomeBlendRadius: '3', mipmapLevels: '4', renderClouds: 'true', entityShadows: 'true', ao: 'true', entityDistanceScaling: '1.25', maxFps: '260', enableVsync: 'false', lang: 'ru_ru' },
}

type KeyRule =
  | { kind: 'int'; min: number; max: number }
  | { kind: 'num'; min: number; max: number }
  | { kind: 'enum'; values: readonly string[] }

/** Белый список ключей `op config` (SPEC §1, presets.ts) и их пределы. */
export const CONFIG_RULES: Record<string, KeyRule> = {
  renderDistance: { kind: 'int', min: 2, max: 32 },
  simulationDistance: { kind: 'int', min: 5, max: 32 },
  maxFps: { kind: 'int', min: 10, max: 260 },
  graphicsMode: { kind: 'int', min: 0, max: 2 },
  particles: { kind: 'int', min: 0, max: 2 },
  biomeBlendRadius: { kind: 'int', min: 0, max: 7 },
  mipmapLevels: { kind: 'int', min: 0, max: 4 },
  renderClouds: { kind: 'enum', values: ['true', 'fast', 'false'] },
  entityShadows: { kind: 'enum', values: ['true', 'false'] },
  ao: { kind: 'enum', values: ['true', 'false'] },
  enableVsync: { kind: 'enum', values: ['true', 'false'] },
  entityDistanceScaling: { kind: 'num', min: 0.5, max: 5 },
  lang: { kind: 'enum', values: ['ru_ru', 'en_us', 'uk_ua'] },
}

/** Ключи options.txt в порядке показа моддеру. */
export const OPTION_KEYS = Object.keys(CONFIG_RULES)

/** Значение ключа из белого списка, приведённое к пределам; null — ключ не из списка или мусор. */
export function clampOption(key: string, raw: string): string | null {
  const rule = Object.prototype.hasOwnProperty.call(CONFIG_RULES, key) ? CONFIG_RULES[key] : undefined
  if (!rule) return null
  const v = String(raw).trim().toLowerCase()
  if (rule.kind === 'enum') return rule.values.includes(v) ? v : null
  if (!/^-?\d+(\.\d+)?$/.test(v)) return null
  const n = Math.min(rule.max, Math.max(rule.min, Number(v)))
  return rule.kind === 'int' ? String(Math.round(n)) : String(Math.round(n * 100) / 100)
}

/** Значение ключа сейчас: из конфига сборки, иначе из пресета профиля. */
export function optionOf(cfg: MilliConfig, key: string): string {
  return cfg.options?.[key] ?? PROFILE_OPTIONS[cfg.profile]?.[key] ?? PROFILE_OPTIONS.balanced[key] ?? ''
}

const MB = 1024

/** Сколько ОЗУ советовать по размеру сборки (presets.ts), до клэмпа по машине. */
export function ramForPack(mods: number, profile: MilliProfile, dh = false): number {
  const base = mods <= 50 ? (profile === 'low' ? 3 * MB : 4 * MB) : mods <= 100 ? 6 * MB : mods <= 200 ? 8 * MB : mods <= 300 ? 10 * MB : 12 * MB
  return base + (dh ? 2 * MB : 0)
}

/**
 * Потолок ползунка в ГБ — тот же, что у сервера (`presets.ts configPreset`):
 * не больше 60 % физической и ≥3 ГБ системе, шаг 512 МБ; и не выше потолка
 * лаунчера (`lib/ram.ts`: четверть, но не меньше 2 ГБ). Сервер даёт 9,5 ГБ
 * на 16 ГБ — ползунок целыми ГБ округляет так же (10), иначе Милли ставила
 * бы 10, а вкладка ругала «Слишком много». Машина неизвестна — 16 ГБ.
 */
export function ramCapGb(totalMb: number): number {
  if (!totalMb || totalMb <= 0) return 16
  const serverMb = Math.floor(Math.max(2048, Math.min(Math.floor(totalMb * 0.6), totalMb - 3072)) / 512) * 512
  const total = Math.round(totalMb / MB)
  const launcher = Math.floor(total - Math.max(2, total * 0.25))
  return Math.max(2, Math.min(32, launcher, Math.round(serverMb / MB)))
}

/** Конфиг сборки с безопасными умолчаниями: старый ответ сервера поля `config` не шлёт. */
export function configOf(pack: Pick<MilliPack, 'config' | 'mods' | 'shaders'>): MilliConfig {
  const c = pack.config
  const profile: MilliProfile = c?.profile === 'low' || c?.profile === 'high' ? c.profile : 'balanced'
  const mods = (pack.mods ?? []).length
  return {
    profile,
    ramMb: c && Number.isFinite(c.ramMb) && c.ramMb > 0 ? c.ramMb : ramForPack(mods, profile),
    jvm: c?.jvm === 'zgc' ? 'zgc' : 'g1',
    options: c?.options && typeof c.options === 'object' ? c.options : {},
    shaderPack: c?.shaderPack ?? null,
  }
}

/** «Советуем 6 ГБ из 16» — «из N» только когда машина известна. */
export function ramAdvice(ramMb: number, totalMb: number): string {
  const gb = Math.max(1, Math.round(ramMb / MB))
  const cap = ramCapGb(totalMb)
  const tip = Math.min(gb, totalMb > 0 ? cap : gb)
  return totalMb > 0 ? `Советуем ${tip} ГБ из ${Math.round(totalMb / MB)}` : `Советуем ${tip} ГБ`
}

/** ГБ для ползунка лаунчера (`m-ram-<профиль>`, целые ГБ), не выше потолка машины. */
export function ramGbFor(ramMb: number, totalMb: number): number {
  return Math.max(2, Math.min(ramCapGb(totalMb), Math.round(ramMb / MB)))
}

/**
 * Свои аргументы JVM профиля. G1 автоподбор ядра ставит сам (`tuning.rs`
 * GC_FLAGS) — пусто, чтобы не спорить с ним. ZGC — флаг игрока: ядро
 * (`fit_jvm_args`) оставляет последний сборщик, то есть этот.
 */
export function jvmArgsFor(jvm: MilliConfig['jvm']): string {
  return jvm === 'zgc' ? '-XX:+UseZGC -XX:+ZGenerational' : ''
}

// ─── Установка из верстака ─────────────────────────────────────────────

/**
 * Что ставить из ревизии верстака: всё, кроме убранного игроком; шейдер — один
 * активный; загрузчик шейдеров — к модам, если шейдер есть. Базовые первыми.
 */
export function benchChosen(pack: Pick<MilliPack, 'mods' | 'resourcepacks' | 'shaders' | 'shaderLoader' | 'userRemoved'>): MilliChosen {
  const gone = removedSet(pack)
  const keep = (list: MilliItem[] | undefined) => (list ?? []).filter((m) => m && !gone.has(m.projectId))
  const mods = keep(pack.mods).sort((a, b) => Number(!!b.base) - Number(!!a.base))
  const shader = activeShader(pack)
  const shaders = shader ? [shader] : []
  const loader = pack.shaderLoader
  if (shader && loader && !mods.some((m) => m.projectId === loader.projectId)) mods.push(loader)
  return { mods, resourcepacks: keep(pack.resourcepacks), shaders }
}
