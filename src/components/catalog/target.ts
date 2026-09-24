import { createContext, useContext } from 'react'
import { useSite } from './siteStore'
import type { SiteStore } from './siteStore'

/**
 * Куда ставит каталог (приказ владельца 24.09.2026, 18:35: «каталог один —
 * кнопку добавили, и она везде»). `build` — «Ресурсы»: в свою сборку, плюс «На
 * сервер» у сборок, карт и дата-паков. `server` — вкладка контента панели
 * хостинга: те же разделы и строки, главная кнопка — «На сервер» этого сервера.
 */
export type CatalogTarget = { kind: 'build' } | { kind: 'server'; serverId: string; onInstalled?: () => void }

export const CatalogCtx = createContext<{ store: SiteStore; target: CatalogTarget }>({ store: useSite, target: { kind: 'build' } })

export const useCatalogCtx = () => useContext(CatalogCtx)
