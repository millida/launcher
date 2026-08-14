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

export function skinSource(): SkinSource {
  const stored = localStorage.getItem('m-skin-source')
  if (stored === 'millida' || stored === 'mojang') return stored
  const a = getAccount()
  return a && a.kind === 'microsoft' ? 'mojang' : 'millida'
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
      return await api<AppliedTexture>('/launcher/game-texture', {
        method: 'POST',
        body: JSON.stringify({ type, pngBase64, slim, name }),
      })
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
  return api<AppliedTexture>('/launcher/wardrobe/' + encodeURIComponent(id) + '/apply', { method: 'POST' })
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

/// Канонический путь; на бэкенде есть алиас /wardrobe/capes/catalog.
export function loadCapeCatalog(): Promise<CapeCatalogItem[]> {
  return api<CapeCatalogItem[]>('/launcher/wardrobe/capes/catalog')
}
