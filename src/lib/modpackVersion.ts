import { MODRINTH_API } from './api'

export interface MrPackVersion {
  id: string
  game_versions?: string[]
  files?: { filename?: string }[]
}

export function pickPackVersion(list: MrPackVersion[], game: string): string | null {
  const hit = list.find(
    (v) => (v.game_versions || []).includes(game) && (v.files || []).some((f) => (f.filename || '').endsWith('.mrpack')),
  )
  return hit ? hit.id : null
}

export async function modpackVersionFor(slug: string, game: string): Promise<string> {
  const r = await fetch(MODRINTH_API + '/v2/project/' + encodeURIComponent(slug) + '/version').catch(() => null)
  if (!r || !r.ok) throw new Error('Не удалось получить версии сборки — проверь интернет и попробуй ещё раз')
  const list = (await r.json()) as unknown
  const id = Array.isArray(list) ? pickPackVersion(list as MrPackVersion[], game) : null
  if (!id) throw new Error('У сборки нет версии под Minecraft ' + game + ' — сними фильтр версии или выбери её во вкладке «Версии»')
  return id
}
