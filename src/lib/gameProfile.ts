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

export function uploadTexture(
  type: 'skin' | 'cape',
  pngBase64: string | null,
  slim = false,
  name?: string,
): Promise<AppliedTexture> {
  return api<AppliedTexture>('/launcher/game-texture', {
    method: 'POST',
    body: JSON.stringify({ type, pngBase64, slim, name }),
  })
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
