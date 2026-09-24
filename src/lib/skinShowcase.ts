import { api, LAUNCHER_API } from './api'

/**
 * Витрина скинов millida.net (`/v2/players/showcase`). Каталог в лаунчере и
 * каталог на сайте обязаны быть одним и тем же: пока в лаунчере лежал свой
 * список из тридцати ников, «каталог» значил в двух местах разное, и человек,
 * нашедший скин на сайте, не находил его в лаунчере.
 *
 * Адрес открыт без входа: каталог смотрят и до того, как заведут аккаунт.
 */
export type ShowcaseKind = 'top' | 'new' | 'random'

export interface ShowcaseCard {
  name: string
  textureId: string | null
  model: string
  views: number
}

export const showcaseSkinUrl = (textureId: string) =>
  LAUNCHER_API + '/heads/texture/' + encodeURIComponent(textureId) + '?kind=skin'

/// Goes through the core like every other API call: a direct webview fetch
/// depends on CORS and ignores the system proxy, and the catalog came up empty
/// for players whose other screens loaded fine.
export async function loadShowcase(kind: ShowcaseKind, limit = 48): Promise<ShowcaseCard[]> {
  const body = await api<unknown>('/players/showcase/list?kind=' + kind + '&limit=' + limit)
  if (!Array.isArray(body)) return []
  return body.filter((row): row is ShowcaseCard => !!row && typeof (row as ShowcaseCard).name === 'string')
}
