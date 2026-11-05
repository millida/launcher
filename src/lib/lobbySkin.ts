import { nickSkinUrl } from './characterStage'
import { loadWardrobe, textureVersion } from './gameProfile'
import { lookHint } from './lookHint'
import { lookOwner } from '../state/accounts'
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
  // Скин только что применили здесь же (lib/lookHint) — берём ответ применения, гардероб не спрашиваем.
  const applied = lookHint(lookOwner())?.texture
  const active = applied ?? (await loadWardrobe().catch(() => null))?.active
  // Мимо кэша — только после смены скина или плаща: адрес на аккаунте бывает тем же, а смена одних
  // вещей скин не меняет, и картинка берётся из памяти (lib/textureSource).
  const fresh = (u: string) => (textureVersion && !/^(data|blob):/i.test(u) ? u + (u.includes('?') ? '&' : '?') + 'v=' + textureVersion : u)
  const cape = active?.capeUrl ? fresh(active.capeUrl) : null
  if (active?.skinUrl) return { skin: fresh(active.skinUrl), slim: active.model === 'slim', cape }
  return { ...(await nickLookSkin(nick)), cape }
}
