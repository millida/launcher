/*
 * Своя сборка каталога (Arcania и другие «launcherOnly») открывается страницей хаба.
 * Хаб регистрирует здесь, как прогреть такую страницу, а карточка ленты зовёт это,
 * когда видна или под курсором: страница открывается уже с данными, без «прыжка».
 */

/** Вернёт false, если сборку ещё не знает (список хаба не пришёл) — попробуем позже. */
let prefetcher: ((slug: string) => boolean) | null = null
const done = new Set<string>()

export function setPackPrefetcher(fn: ((slug: string) => boolean) | null): void {
  prefetcher = fn
}

export function prefetchPack(slug: string): void {
  if (!prefetcher || !slug || done.has(slug)) return
  if (prefetcher(slug)) done.add(slug)
}
