/**
 * Образы — сохранённые наборы «скин + руки + плащ + косметика», как в Roblox:
 * одно нажатие надевает всё. Своего хранилища образов на сервере нет
 * (POST /cosmetics/wardrobe — только «что надето сейчас»), поэтому живут они в
 * памяти лаунчера, отдельно на каждый аккаунт: у второго аккаунта другие
 * скины и права на вещи, и чужой образ на нём наполовину бы не наделся.
 */

export const OUTFITS_LIMIT = 12
export const OUTFIT_NAME_MAX = 24

export interface OutfitCosmetic {
  id: string
  slot: string
  variant?: string
}

export interface OutfitSkin {
  /** Адрес текстуры: по нему скин надевается, если карточки уже нет. */
  url: string
  slim: boolean
  /** Вещь гардероба аккаунта — надевается по id, без повторной заливки PNG. */
  wardrobeId?: string
  /** Свой скин с этого компьютера: имя файла в папке скинов. */
  myFile?: string
}

export interface Outfit {
  id: string
  name: string
  skin: OutfitSkin
  /** id плаща из списка экрана или 'none'. */
  cape: string
  cosmetics: OutfitCosmetic[]
}

/** Что надето сейчас — из этого собирается новый образ. */
export type Look = Omit<Outfit, 'id' | 'name'>

const keyOf = (accountId: string) => 'm-outfits:' + (accountId || 'guest')

const isStr = (v: unknown): v is string => typeof v === 'string'

/** Разбор записи из памяти. Битая запись или чужая форма — просто пропускаются. */
export function parseOutfits(raw: unknown): Outfit[] {
  if (!Array.isArray(raw)) return []
  const out: Outfit[] = []
  for (const o of raw) {
    if (!o || typeof o !== 'object') continue
    const { id, name, skin, cape, cosmetics } = o as Record<string, unknown>
    if (!isStr(id) || !isStr(name) || !skin || typeof skin !== 'object') continue
    const s = skin as Record<string, unknown>
    if (!isStr(s.url) || !s.url) continue
    out.push({
      id,
      name: name.slice(0, OUTFIT_NAME_MAX),
      skin: {
        url: s.url,
        slim: s.slim === true,
        wardrobeId: isStr(s.wardrobeId) ? s.wardrobeId : undefined,
        myFile: isStr(s.myFile) ? s.myFile : undefined,
      },
      cape: isStr(cape) ? cape : 'none',
      cosmetics: Array.isArray(cosmetics)
        ? cosmetics
            .filter((c): c is OutfitCosmetic => !!c && isStr(c.id) && isStr(c.slot))
            .map((c) => ({ id: c.id, slot: c.slot, variant: isStr(c.variant) ? c.variant : undefined }))
        : [],
    })
    if (out.length >= OUTFITS_LIMIT) break
  }
  return out
}

export function loadOutfits(accountId: string): Outfit[] {
  try {
    return parseOutfits(JSON.parse(localStorage.getItem(keyOf(accountId)) || 'null'))
  } catch {
    return []
  }
}

export function saveOutfits(accountId: string, list: Outfit[]): void {
  try {
    localStorage.setItem(keyOf(accountId), JSON.stringify(list))
  } catch {
    // Память может быть закрыта настройками: образы останутся до перезапуска.
  }
}

/** «Образ N» со свободным номером: после удаления «Образа 2» не появится второй «Образ 3». */
export function nextOutfitName(list: Outfit[]): string {
  const taken = new Set(list.map((o) => o.name))
  let n = list.length + 1
  for (let i = 1; i <= list.length + 1; i++) {
    if (!taken.has('Образ ' + i)) {
      n = i
      break
    }
  }
  return 'Образ ' + n
}

/** Новый образ в конец ряда. На лимите список не меняется — решает экран. */
export function addOutfit(list: Outfit[], look: Look, id: string = makeId()): Outfit[] {
  if (list.length >= OUTFITS_LIMIT) return list
  return list.concat({
    id,
    name: nextOutfitName(list),
    skin: { ...look.skin },
    cape: look.cape,
    cosmetics: look.cosmetics.map((c) => ({ ...c })),
  })
}

/** Пустое имя не принимаем: безымянную плитку не отличить от соседней. */
export function renameOutfit(list: Outfit[], id: string, name: string): Outfit[] {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, OUTFIT_NAME_MAX)
  if (!clean) return list
  return list.map((o) => (o.id === id ? { ...o, name: clean } : o))
}

export function removeOutfit(list: Outfit[], id: string): Outfit[] {
  return list.filter((o) => o.id !== id)
}

/**
 * Образ совпадает с тем, что надето: так подсвечивается активный. Порядок
 * косметики не важен — сервер отдаёт надетое в своём порядке.
 */
export function sameLook(o: Look, look: Look): boolean {
  if (o.skin.url !== look.skin.url || o.skin.slim !== look.skin.slim) return false
  if (o.cape !== look.cape) return false
  if (o.cosmetics.length !== look.cosmetics.length) return false
  const mark = (c: OutfitCosmetic) => c.slot + '|' + c.id + '|' + (c.variant ?? '')
  const mine = new Set(o.cosmetics.map(mark))
  return look.cosmetics.every((c) => mine.has(mark(c)))
}

/** Косметика образа, разделённая на то, что можно надеть, и то, чего у игрока нет. */
export function splitWearable(
  list: OutfitCosmetic[],
  canWear: (id: string) => boolean,
): { wear: OutfitCosmetic[]; skipped: OutfitCosmetic[] } {
  const wear: OutfitCosmetic[] = []
  const skipped: OutfitCosmetic[] = []
  for (const c of list) (canWear(c.id) ? wear : skipped).push(c)
  return { wear, skipped }
}

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}
