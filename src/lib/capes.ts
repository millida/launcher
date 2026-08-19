/// Плащ приезжает из нескольких источников сразу: каталог аккаунта Millida,
/// надетый на аккаунте плащ, лицензия Mojang, каталог наград и локальная копия.
/// Здесь — общие правила «это один и тот же плащ», чтобы список не двоился.

export interface CapeIdentity {
  url: string
  name: string
  onAccount?: boolean
  active?: boolean
  wardrobeId?: string
  msId?: string
  accId?: string
}

/// Хеш текстуры Mojang из адреса. Плащи каталога Millida лежат в своём
/// хранилище и хеша в адресе не имеют — для них ключом остаётся сам адрес.
export function textureHash(url: string | null | undefined): string {
  const m = /texture\/([0-9a-f]{40,})/i.exec(url || '')
  return m ? m[1] : ''
}

/// Копии одного плаща в каталоге аккаунта различаются адресом, но не именем:
/// прошлые версии лаунчера перезаливали PNG на каждое «Применить».
export const capeTitle = (name: string) => name.trim().toLowerCase()

/// Отпечаток уже прочитанной текстуры. Плащ, выданный за достижение, лежит в
/// каталоге аккаунта своей копией: адрес у неё свой, хеша Mojang в нём нет, и
/// без сверки байтов тот же плащ показывался второй карточкой.
export type CapeContent = (url: string) => string | undefined

/// FNV-1a: сравниваем текстуры между собой, а не защищаемся от подбора.
export function contentFingerprint(data: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < data.length; i++) {
    h ^= data.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return 'b' + (h >>> 0).toString(36) + '.' + data.length
}

export const capeKey = (c: CapeIdentity, content?: CapeContent) =>
  (content && content(c.url)) || textureHash(c.url) || c.url

/// Побеждает первый в списке — источник с наибольшим приоритетом. Признаки
/// остальных к нему подмешиваются: иначе, схлопнув карточку «на аккаунте» в
/// карточку каталога, лаунчер потерял бы id, по которому плащ переключается на
/// лицензии. Одинаковыми считаются карточки с общей текстурой (байты, хеш
/// Mojang или адрес) либо с общим именем.
export function dedupeCapes<T extends CapeIdentity>(list: T[], content?: CapeContent): T[] {
  const out: T[] = []
  const at = new Map<string, number>()
  for (const c of list) {
    const title = capeTitle(c.name)
    const keys = [capeKey(c, content), title && 'name:' + title].filter(Boolean) as string[]
    const seen = keys.map((k) => at.get(k)).find((v) => v !== undefined)
    if (seen === undefined) {
      for (const k of keys) at.set(k, out.length)
      out.push(c)
      continue
    }
    const prev = out[seen]
    out[seen] = {
      ...prev,
      onAccount: prev.onAccount || c.onAccount,
      active: prev.active || c.active,
      wardrobeId: prev.wardrobeId || c.wardrobeId,
      msId: prev.msId || c.msId,
      accId: prev.accId || c.accId,
    }
    for (const k of keys) if (!at.has(k)) at.set(k, seen)
  }
  return out
}
