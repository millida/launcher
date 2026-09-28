import { canonAddr } from './serverAddr'
import type { LobbyMode } from '../state/lobbyMode'

export const ONEBLOCK_PACK = 'oneblock-metalabs'

/**
 * OneBlock runs on 1.7.10 through its own client: joining its address with a
 * plain Minecraft build never gets in. The rating hides the address of a
 * launcher-only server, so its card is recognised by slug, a typed or shared
 * address by host and port.
 */
export const OWN_SERVER_SLUG = 'oneblock-7'
export const OWN_SERVER_ADDR = 'proxy-1.metalabsmc.net:25567'
export const OWN_SERVER_MODE = 'ONEBLOCK'

/** The event's tile starts the event; every other mode tile lists its servers. */
export const modeAction = (cat: string): 'launch' | 'open' => (cat === OWN_SERVER_MODE ? 'launch' : 'open')

export const isOwnServerAddr = (addr: string | null | undefined): boolean =>
  !!addr && !!addr.trim() && canonAddr(addr) === canonAddr(OWN_SERVER_ADDR)

export const isOwnServer = (slug: string | null | undefined, addr: string | null | undefined): boolean =>
  slug === OWN_SERVER_SLUG || isOwnServerAddr(addr)

export const joinAddr = (sv: { slug?: string | null; ip?: string | null }): string =>
  isOwnServer(sv.slug, sv.ip) ? OWN_SERVER_ADDR : sv.ip || ''

export const targetsOwnServer = (m: LobbyMode | null | undefined): boolean =>
  !!m && ((m.kind === 'premium' && m.slug === ONEBLOCK_PACK) || (m.kind === 'server' && isOwnServer(m.slug, m.ip)))

export const ownServerMode = (cover: string | null = null): LobbyMode => ({
  kind: 'premium',
  id: ONEBLOCK_PACK,
  slug: ONEBLOCK_PACK,
  title: 'OneBlock',
  cover,
  meta: '',
})
