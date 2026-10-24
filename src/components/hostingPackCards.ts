import type { SiteCard } from './catalog/site'

/**
 * Сетка выбора сборки в окне «Новый сервер». Бэкенд сам ставит партнёрские сборки хостинга первыми и
 * не отдаёт клиентские; старый бэкенд этого не умеет, поэтому клиентские сборки убираем и здесь, а
 * партнёрскую карточку оставляем только если хостинг знает такую сборку.
 */
export type PackCard = SiteCard & { hostingPack?: string | null }

export function hostingPackCards(items: PackCard[], knownPacks: ReadonlySet<string>): PackCard[] {
  return items.filter((c) => (c.hostingPack ? knownPacks.has(c.hostingPack) : c.side !== 'CLIENT'))
}

/** Чем ставить выбранную сборку на только что созданный сервер. */
export function packInstallRequest(card: PackCard): { path: string; body: Record<string, unknown> } {
  return card.hostingPack
    ? { path: '/installs/partner', body: { packKey: card.hostingPack } }
    : { path: '/install-catalog', body: { section: 'modpacks', slug: card.slug, replaceWorld: true } }
}
