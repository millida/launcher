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

export const capeKey = (c: CapeIdentity) => textureHash(c.url) || c.url

/// Побеждает первый в списке — источник с наибольшим приоритетом. Признаки
/// остальных к нему подмешиваются: иначе, схлопнув карточку «на аккаунте» в
/// карточку каталога, лаунчер потерял бы id, по которому плащ переключается на
/// лицензии.
export function dedupeCapes<T extends CapeIdentity>(list: T[]): T[] {
  const out: T[] = []
  const at = new Map<string, number>()
  for (const c of list) {
    const key = capeKey(c)
    const seen = key ? at.get(key) : undefined
    if (seen === undefined) {
      if (key) at.set(key, out.length)
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
  }
  return out
}

/// Плащи каталога аккаунта: одно имя — одна карточка.
export function dedupeByTitle<T extends CapeIdentity>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((c) => {
    const key = capeTitle(c.name)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
