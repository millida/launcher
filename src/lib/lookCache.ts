import { idbGet, idbSet } from './idbCache'
import type { LookSkin } from './lobbySkin'
import { textureSource } from './textureSource'

const KEY = 'lobby-look:v1:'
const MAX_AGE_MS = 30 * 86_400_000

const isData = (u: string | null | undefined): u is string => !!u && /^data:image\//i.test(u)

export async function keptLookSkin(nick: string): Promise<LookSkin | null> {
  try {
    const row = await idbGet<LookSkin>(KEY + nick)
    if (!row || Date.now() - row.at > MAX_AGE_MS) return null
    const v = row.value
    return v && isData(v.skin) ? { skin: v.skin, slim: !!v.slim, cape: isData(v.cape) ? v.cape : null } : null
  } catch {
    return null
  }
}

export async function keepLookSkin(nick: string, look: LookSkin): Promise<void> {
  const [skin, cape] = await Promise.all([textureSource(look.skin), look.cape ? textureSource(look.cape) : null])
  if (!isData(skin)) return
  await idbSet<LookSkin>(KEY + nick, { skin, slim: look.slim, cape: isData(cape) ? cape : null })
}
