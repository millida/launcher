import { splitVariantCode, variantCode, variantTitles } from './variantNames'
import { api, hasMillidaAccount } from './api'
import { getAccount } from '../state/accounts'

export type SkinSource = 'millida' | 'mojang'

export interface GameProfile {
  uuid: string
  uuidDashed: string
  name: string
  model: string
  skinUrl: string | null
  capeUrl: string | null
  accountNick?: string | null
  publicSlug?: string | null
  nameConflict?: boolean
}

/// «Лицензия» без аккаунта Microsoft означает, что скин не берётся ниоткуда, и
/// в игре остаётся Стив. Настройку могла записать прошлая версия или совет
/// поддержки, поэтому выбор проверяется при каждом чтении, а не только при клике.
export function skinSource(): SkinSource {
  const a = getAccount()
  const licensed = !!a && a.kind === 'microsoft'
  const stored = localStorage.getItem('m-skin-source')
  if (stored === 'millida') return stored
  if (stored === 'mojang') return licensed ? stored : 'millida'
  return licensed ? 'mojang' : 'millida'
}

export function setSkinSource(v: SkinSource) {
  localStorage.setItem('m-skin-source', v)
}

export function millidaSkinsActive(): boolean {
  return skinSource() === 'millida' && hasMillidaAccount()
}

export function gameProfile(): Promise<GameProfile> {
  return api<GameProfile>('/launcher/game-profile')
}

export interface AppliedTexture {
  skinUrl: string | null
  capeUrl: string | null
  model: string
}

const TEXTURE_ATTEMPTS = 3

/**
 * Версия образа: растёт при любой смене скина, плаща или вещей. Лобби по ней
 * грузит свежую картинку мимо кэша — адрес скина на аккаунте бывает тем же,
 * и в лобби оставался старый скин (владелец 23.09.2026).
 */
export const LOOK_EVENT = 'm-look-changed'
export let lookVersion = 0
export function bumpLook(): void {
  lookVersion = Date.now()
  window.dispatchEvent(new Event(LOOK_EVENT))
}
const bumped = <T,>(p: Promise<T>): Promise<T> => p.then((r) => (bumpLook(), r))

/// A rejected upload is the user's skin lost, so anything that is not a verdict
/// on the request itself (auth, validation) is worth another try.
const worthRetry = (e: unknown) => !/unauthorized|http 4\d\d/i.test(String(e))

export async function uploadTexture(
  type: 'skin' | 'cape',
  pngBase64: string | null,
  slim = false,
  name?: string,
): Promise<AppliedTexture> {
  let last: unknown
  for (let attempt = 1; attempt <= TEXTURE_ATTEMPTS; attempt++) {
    try {
      return await bumped(
        api<AppliedTexture>('/launcher/game-texture', {
          method: 'POST',
          body: JSON.stringify({ type, pngBase64, slim, name }),
        }),
      )
    } catch (e) {
      last = e
      if (!worthRetry(e) || attempt === TEXTURE_ATTEMPTS) break
      await new Promise((r) => setTimeout(r, 800 * attempt))
    }
  }
  throw last
}

export interface WardrobeItem {
  id: string
  kind: 'skin' | 'cape'
  name: string
  url: string
  model: string
  source: string
  createdAt: string
}

export interface Wardrobe {
  items: WardrobeItem[]
  active: AppliedTexture
}

export function loadWardrobe(): Promise<Wardrobe> {
  return api<Wardrobe>('/launcher/wardrobe')
}

export function addToWardrobe(input: {
  kind: 'skin' | 'cape'
  name: string
  pngBase64: string
  slim?: boolean
  source?: string
}): Promise<WardrobeItem> {
  return api<WardrobeItem>('/launcher/wardrobe', { method: 'POST', body: JSON.stringify(input) })
}

export function applyWardrobeItem(id: string): Promise<AppliedTexture> {
  return bumped(api<AppliedTexture>('/launcher/wardrobe/' + encodeURIComponent(id) + '/apply', { method: 'POST' }))
}

export function removeWardrobeItem(id: string): Promise<unknown> {
  return api('/launcher/wardrobe/' + encodeURIComponent(id), { method: 'DELETE' })
}

export interface RewardItem {
  code: string
  title: string
  task: string
  hint: string
  unit: 'count' | 'seconds'
  goal: number
  progress: number
  done: boolean
  claimed: boolean
  capeUrl: string | null
}

export function loadRewards(): Promise<{ items: RewardItem[] }> {
  return api<{ items: RewardItem[] }>('/launcher/rewards')
}

export function claimReward(code: string): Promise<RewardItem> {
  return api<RewardItem>('/launcher/rewards/' + encodeURIComponent(code) + '/claim', { method: 'POST' })
}

/// Каталог плащей Millida. Свои плащи грузить больше нельзя — плащ можно только
/// получить: либо он есть на лицензии Mojang, либо открыт в каталоге Millida.
/// Закрытые плащи каталог тоже отдаёт (unlocked=false) — их видно затемнёнными
/// вместе с условием, иначе непонятно, ради чего играть.
export interface CapeCatalogItem {
  id: string
  name: string
  url: string
  rarity?: string
  /// Текст условия: «Наиграть 10 часов», «Купить любой хостинг».
  requirement?: string
  requirementCode?: string
  unlocked?: boolean
  /// 0..100 — насколько условие выполнено.
  progress?: number
  progressCurrent?: number
  progressTarget?: number
  progressUnit?: string
}

export function loadCapeCatalog(): Promise<CapeCatalogItem[]> {
  return api<CapeCatalogItem[]>('/launcher/wardrobe/capes/catalog')
}

export interface MojangCape {
  id: string
  name: string
  url: string
}

/// Открыт без входа: плащи Mojang видны и тем, у кого ещё нет аккаунта Millida.
export function loadMojangCapes(): Promise<{ items: MojangCape[] }> {
  return api<{ items: MojangCape[] }>('/launcher/wardrobe/capes/mojang')
}

/// Плащ каталога надевается по идентификатору карточки: PNG подставляет сервер,
/// клиент его не отправляет вовсе — плащ выдаёт сервер, а не файл на диске.
export function applyCatalogCape(id: string): Promise<AppliedTexture> {
  return api<AppliedTexture>('/launcher/wardrobe/capes/' + encodeURIComponent(id) + '/apply', { method: 'POST' })
}

/// Вещь мода: то, что игрок носит в самой игре, а не в профиле. Картинку рисует
/// пайплайн мода, поэтому лаунчер показывает готовый PNG, а не крутит модель.
export interface CosmeticItem {
  id: string
  name: string
  slot: string
  /// Идентификатор геометрии: по нему берётся модель для показа на фигуре.
  model?: string
  /// Адрес картинки вещи — той самой, что рисует мод.
  texture?: string
  access: string
  channel?: string
  /// Вещь на обкатке: её видно только команде.
  staffOnly?: boolean
  /// Цена в рубинах. Пусто у бесплатных и у тех, что открывает подписка.
  priceRubies?: number
  preview?: string
  /// Имя клипа, который показывает вещь: у многих их несколько.
  animation?: string
  /// Цвета вещи. У половины каталога их несколько, и первый не всегда тот,
  /// который человек считает основным: у ангельских крыльев это чёрные.
  /// v3.1: служба дописывает к расцветке её код, имя, ранг и цену.
  variants?: { name: string; color?: string; texture?: string; code?: string; title?: string; rarity?: string; price?: number }[]
  /// Ранг вещи (у вещи-расцветки — ранг расцветки).
  rarity?: string
  /// v3.1: код исходной вещи у вещи-расцветки («ANGEL_WINGS» у «ANGEL_WINGS~red»).
  baseId?: string
  /// v3.1: цвет своей расцветки и базовой — превью перекрашивается из второго в первый.
  tint?: string
  tintFrom?: string
}

/**
 * v3.1: каждая расцветка — отдельная вещь (решение владельца 24.09.2026, 19:37).
 * Каталог разворачивается здесь, в одном месте: гардероб видит отдельные
 * карточки со своим именем, рангом и ценой, без переключателя тона. Служба и
 * мод по-прежнему знают пару (вещь, расцветка) — обратно её собирают
 * applyCosmetics / loadWornCosmetics / loadCosmeticOwned.
 */
const variantNames = new Map<string, string[]>()

export function expandCatalog(items: CosmeticItem[]): CosmeticItem[] {
  const out: CosmeticItem[] = []
  for (const item of items) {
    const list = (item.variants ?? []).filter((v) => v && v.name)
    if (list.length < 2) {
      out.push(item)
      continue
    }
    variantNames.set(item.id, list.map((v) => v.name))
    const titles = variantTitles(item.name, list.map((v) => v.name))
    list.forEach((v, i) => {
      out.push({
        ...item,
        id: v.code || variantCode(item.id, v.name),
        name: v.title || titles[i] || item.name,
        variants: [v],
        rarity: v.rarity || item.rarity,
        priceRubies: v.price === undefined ? item.priceRubies : v.price > 0 ? v.price : undefined,
        baseId: item.id,
        // Превью на CDN одно — базовой расцветки; карточка перекрашивает его в свою (variantArt.ts).
        ...(i > 0 && v.color ? { tint: v.color, tintFrom: list[0]!.color } : {}),
      })
    })
  }
  return out
}

/** Карточка → пара для службы: код вещи и расцветка. */
function toServer(w: WornCosmetic): WornCosmetic {
  const { code, variant } = splitVariantCode(w.id)
  return variant ? { ...w, id: code, variant } : w
}

/** Пара службы → карточка: у вещи с расцветками — «КОД~имя» (без расцветки — базовая). */
function fromServer(w: WornCosmetic): WornCosmetic {
  const names = variantNames.get(w.id)
  if (!names) return w
  const name = w.variant && names.includes(w.variant) ? w.variant : names[0]!
  return { ...w, id: variantCode(w.id, name), variant: name }
}

export interface WornCosmetic {
  id: string
  slot: string
  variant?: string
}

export async function loadCosmeticCatalog(): Promise<{ items: CosmeticItem[] }> {
  const r = await api<{ items: CosmeticItem[] }>('/cosmetics/catalog')
  return { ...r, items: expandCatalog(r.items || []) }
}

/// На что у игрока есть право. Бесплатное сюда не попадает — оно и так у всех.
/// v3.1: коды вещей-расцветок. Старая служба не шлёт variants — тогда своя вещь
/// своя во всех расцветках (так было до v3).
export async function loadCosmeticOwned(): Promise<{ items: string[] }> {
  const r = await api<{ items: string[]; variants?: Record<string, string[]> }>('/cosmetics/owned')
  const items: string[] = []
  for (const code of r.items || []) {
    const names = variantNames.get(code)
    if (!names) {
      items.push(code)
      continue
    }
    const mine = r.variants ? r.variants[code] || [] : names
    for (const name of mine) items.push(variantCode(code, name))
  }
  return { items }
}

/// Что надето прямо сейчас. Адрес общий на всех игроков, поэтому спрашиваем
/// себя одним uuid.
export async function loadWornCosmetics(uuid: string): Promise<WornCosmetic[]> {
  const answer = await api<{ players: Record<string, WornCosmetic[]> }>('/cosmetics/equipped', {
    method: 'POST',
    body: JSON.stringify({ players: [uuid] }),
  })
  const key = Object.keys(answer.players || {}).find((k) => k.replace(/-/g, '') === uuid.replace(/-/g, ''))
  return key ? answer.players[key].map(fromServer) : []
}

/// Гардероб целиком: сервер перезаписывает набор, поэтому шлём всё надетое, а
/// не разницу.
export function applyCosmetics(items: WornCosmetic[]): Promise<{ ok: boolean; applied: number }> {
  return bumped(
    api<{ ok: boolean; applied: number }>('/cosmetics/wardrobe', {
      method: 'POST',
      body: JSON.stringify({ items: items.map(toServer) }),
    }),
  )
}

/// Подписка PLUS: состояние, оформление и отмена.
export interface PlusStatus {
  active: boolean
  paidUntil: string | null
  canceled: boolean
  priceKopecks: number
  items: number
}

export function loadPlus(): Promise<PlusStatus> {
  return api<PlusStatus>('/launcher/plus')
}

export function subscribePlus(): Promise<{ subscriptionId: string; paymentUrl: string }> {
  return api<{ subscriptionId: string; paymentUrl: string }>('/launcher/plus/subscribe', { method: 'POST' })
}

/// Геометрия вещи: отдаётся только вошедшему и под потолок на сутки, поэтому
/// просим её лишь для того, что игрок надел, а не для всего каталога.
export interface CosmeticModelFile {
  geometry: unknown
  geometrySlim?: unknown
  animations?: unknown
}

export function loadCosmeticModel(modelId: string): Promise<CosmeticModelFile> {
  return api<CosmeticModelFile>('/cosmetics/models/' + encodeURIComponent(modelId))
}
