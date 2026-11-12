import { nickSkinUrl } from './characterStage'
import { loadWardrobe, textureVersion } from './gameProfile'
import { lookHint } from './lookHint'
import { lookOwner } from '../state/accounts'
import { detectSlimFromUrl } from './skinArms'
import { answerOr, type Wait } from './lobbyLook'

/** Скин, плащ и тип рук игрока: то, во что одета фигура на главной до косметики. */
export interface LookSkin {
  skin: string
  slim: boolean
  cape: string | null
}

/**
 * The nick skin is the stand-in for a hung wardrobe, so it must not hang itself: an image load has
 * no limit, and while it waited the home figure had no look at all and the stage stayed empty.
 */
export const SLIM_DETECT_WAIT_MS = 2500

export async function nickLookSkin(nick: string, wait?: Wait): Promise<LookSkin> {
  const skin = nickSkinUrl(nick)
  // A skin found by nick carries no arm type, so it is read from the texture
  // exactly as the wardrobe does; otherwise an Alex skin got Steve arms here.
  const slim = await answerOr(
    detectSlimFromUrl(skin).catch(() => false),
    SLIM_DETECT_WAIT_MS,
    () => false,
    wait,
  )
  return { skin, slim, cape: null }
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
