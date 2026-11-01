import { nickSkinUrl } from './characterStage'
import { loadWardrobe, lookVersion } from './gameProfile'
import { detectSlimFromUrl } from './skinArms'

/** Скин, плащ и тип рук игрока: то, во что одета фигура на главной до косметики. */
export interface LookSkin {
  skin: string
  slim: boolean
  cape: string | null
}

export async function nickLookSkin(nick: string): Promise<LookSkin> {
  const skin = nickSkinUrl(nick)
  // A skin found by nick carries no arm type, so it is read from the texture
  // exactly as the wardrobe does; otherwise an Alex skin got Steve arms here.
  return { skin, slim: await detectSlimFromUrl(skin).catch(() => false), cape: null }
}

export async function loadLookSkin(nick: string, signedIn: boolean): Promise<LookSkin> {
  if (!signedIn) return nickLookSkin(nick)
  const wardrobe = await loadWardrobe().catch(() => null)
  const fresh = (u: string) => (lookVersion && !/^(data|blob):/i.test(u) ? u + (u.includes('?') ? '&' : '?') + 'v=' + lookVersion : u)
  const cape = wardrobe?.active.capeUrl ? fresh(wardrobe.active.capeUrl) : null
  if (wardrobe?.active.skinUrl) return { skin: fresh(wardrobe.active.skinUrl), slim: wardrobe.active.model === 'slim', cape }
  return { ...(await nickLookSkin(nick)), cape }
}
