import { create } from 'zustand'
import { rememberLobbyOrigin } from '../lib/uiTrack'
import { api } from '../lib/api'
import { loadShowcase, packFacts } from '../lib/premium'
import type { PremiumPack } from '../lib/premium'
import { DEFAULT_FILTERS, toCard } from './servers'
import type { RatingServer } from './servers'
import type { SnapshotServer } from '../lib/snapshot'

/**
 * «Что играем сегодня» — режим главной, как выбор режима в Brawl Stars или
 * плейлиста в Fortnite. Кнопка «Играть» всегда запускает выбранное: свою
 * сборку, премиум-сборку или сервер рейтинга.
 *
 * Выбор помнится между запусками целиком, с картинкой и подписью: главная
 * рисует его на первом кадре, не дожидаясь каталога.
 */
export type LobbyMode =
  | { kind: 'build'; name: string }
  /** Чистый Minecraft нужной версии: сборку «Minecraft <версия>» лаунчер заведёт сам. */
  | { kind: 'version'; version: string }
  | { kind: 'premium'; id: string; slug: string | null; title: string; cover: string | null; meta: string }
  | {
      kind: 'server'
      slug: string
      name: string
      ip: string
      logo: string | null
      banner: string | null
      versions: string[]
      licensed: boolean
    }

const KEY = 'm-lobby-mode'
const OB_KEY = 'm-lobby-oneblock'
function readOb(): boolean {
  try {
    return localStorage.getItem(OB_KEY) === '1'
  } catch {
    return false
  }
}

// Разово в dev: сбросить выбранный режим, чтобы владелец увидел пустую
// плашку «Что делаем?» (23.09.2026). В релиз не попадает.
if (import.meta.env.DEV) {
  try {
    if (localStorage.getItem('m-dev-mode-reset') !== '2026-09-23') {
      localStorage.removeItem(KEY)
      localStorage.setItem('m-dev-mode-reset', '2026-09-23')
    }
  } catch {}
}

function read(): LobbyMode | null {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as LobbyMode) : null
    return v && (v.kind === 'build' || v.kind === 'version' || v.kind === 'premium' || v.kind === 'server') ? v : null
  } catch {
    return null
  }
}

export const premiumMode = (p: PremiumPack): LobbyMode => ({
  kind: 'premium',
  id: p.id,
  slug: p.slug ?? null,
  title: p.title,
  cover: p.coverUrl ?? null,
  meta: packFacts(p),
})

export const serverMode = (s: SnapshotServer): LobbyMode => ({
  kind: 'server',
  slug: s.slug,
  name: s.name,
  ip: s.ip,
  logo: s.logo ?? null,
  banner: s.banner ?? null,
  versions: s.versions,
  licensed: s.lic !== 'CRACKED',
})

export const sameMode = (a: LobbyMode | null, b: LobbyMode | null): boolean => {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'build' && b.kind === 'build') return a.name === b.name
  if (a.kind === 'version' && b.kind === 'version') return a.version === b.version
  if (a.kind === 'premium' && b.kind === 'premium') return a.id === b.id
  if (a.kind === 'server' && b.kind === 'server') return a.slug === b.slug
  return false
}

interface LobbyState {
  /** Выбранное руками. Пусто — главная берёт последнюю сборку или «Сегодня». */
  picked: LobbyMode | null
  premium: PremiumPack[]
  featuredId: string | null
  servers: SnapshotServer[]
  loaded: boolean
  /** Премиум-сборка, которую открыть при заходе на «Премиум». */
  premiumTarget: string | null
  /** Что открыть в «Во что играем» при заходе: сборку по slug или режим (баннер «Рекомендуем» в лобби). */
  hubTarget: { pack?: string; mode?: string } | null
  pick: (m: LobbyMode) => void
  /**
   * Слот OneBlock в лобби: второй вариант рядом с выбранным режимом, а не
   * замена ему (правка владельца 23:00: «чтобы точно понимал, во что играет»).
   * Включён — «Играть» ведёт в OneBlock, выбор в каталоге остаётся как был.
   */
  oneBlock: boolean
  setOneBlock: (on: boolean) => void
  load: () => Promise<void>
}

/** Сколько серверов рейтинга в выборе: верх по онлайну, дальше — вкладка «Серверы». */
const SERVERS = 6

export const useLobby = create<LobbyState>((set, get) => ({
  picked: read(),
  premium: [],
  featuredId: null,
  servers: [],
  loaded: false,
  premiumTarget: null,
  hubTarget: null,
  pick: (m) => {
    rememberLobbyOrigin()
    try {
      localStorage.setItem(KEY, JSON.stringify(m))
      localStorage.removeItem(OB_KEY)
    } catch {}
    set({ picked: m, oneBlock: false })
  },
  oneBlock: readOb(),
  setOneBlock: (on) => {
    try {
      if (on) localStorage.setItem(OB_KEY, '1')
      else localStorage.removeItem(OB_KEY)
    } catch {}
    set({ oneBlock: on })
  },
  load: async () => {
    if (get().loaded) return
    const [show, rating] = await Promise.all([
      loadShowcase().catch((e) => {
        console.error('[lobby] premium', e)
        return null
      }),
      api<{ servers?: RatingServer[] }>('/rating/servers?limit=' + SERVERS + '&offset=0&sort=' + DEFAULT_FILTERS.sort).catch(
        (e) => {
          console.error('[lobby] servers', e)
          return null
        },
      ),
    ])
    const packs = (show && show.packs) || []
    set({
      premium: packs,
      featuredId: (show && show.featuredId) || (packs[0] ? packs[0].id : null),
      servers: rating && Array.isArray(rating.servers) ? rating.servers.map((s, i) => toCard(s, i + 1)) : [],
      loaded: true,
    })
  },
}))

