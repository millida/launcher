import { create } from 'zustand'
import { api } from '../lib/api'
import { apiErrorText } from '../lib/apiError'
import { MATE_TAGS, mateToAsk, partyFull, pickMate, type LfgCard } from '../lib/party'
import { isRealtimeLive } from '../lib/realtime'
import { loadParty, partyWithOthers, usePartyStore } from './party'
import { showToast } from './ui'

/** Двое нажали «Найти пати» — сойтись должны за пару секунд (владелец 12.10.2026: «сразу же подключают»). */
const POLL_MS = 2000
/** Список чужих поисков перечитываем реже: он тяжелее заявок. */
const RESCAN_EVERY = 3

interface LfgRequest {
  id: string
}

interface MateSearch {
  searching: boolean
  /** Когда начали искать (наши часы) — для счётчика на панели. */
  since: number
  set: (patch: Partial<MateSearch>) => void
}

export const useMateSearch = create<MateSearch>((set) => ({
  searching: false,
  since: 0,
  set: (patch) => set(patch as MateSearch),
}))

let timer = 0
let ticking = false
let ticks = 0

const party = () => usePartyStore.getState()

async function tick(): Promise<void> {
  if (ticking || !useMateSearch.getState().searching) return
  ticking = true
  try {
    const current = party().party
    if (current && partyFull(current)) {
      await stopMateSearch()
      return
    }
    const req = await api<{ requests: LfgRequest[] }>('/party/lfg/requests')
    for (const r of req.requests || []) {
      await api('/party/lfg/requests/' + encodeURIComponent(r.id) + '/accept', { method: 'POST', body: '{}' }).catch((e) =>
        console.warn('[mates] accept', e),
      )
    }
    ticks++
    if ((req.requests || []).length) {
      await loadParty().catch((e) => console.warn('[mates] reload', e))
      return
    }
    if (partyWithOthers(party().party)) return
    // Нас могли принять в чужую пати: без живого канала узнаём об этом опросом.
    if (!isRealtimeLive() || ticks % RESCAN_EVERY === 0) await loadParty().catch((e) => console.warn('[mates] reload', e))
    if (ticks % RESCAN_EVERY === 0 && !partyWithOthers(party().party)) await rescan()
  } catch (e) {
    console.warn('[mates] poll', e)
  } finally {
    ticking = false
  }
}

/** A search that found nobody at the start looks again: see `mateToAsk` for who asks whom. */
async function rescan(): Promise<void> {
  const st = party()
  const list = await api<{ cards: LfgCard[]; mine?: LfgCard | null }>('/party/lfg')
  const cards = Array.isArray(list.cards) ? list.cards : []
  const mine = list.mine || cards.find((c) => c.user.userId === st.me) || null
  const mate = mateToAsk(cards, mine, st.me, MATE_TAGS)
  if (mate) await api('/party/lfg/' + encodeURIComponent(mate.id) + '/request', { method: 'POST', body: '{}' })
}

/**
 * «Найти напарника»: alone, ask the best open party first; in any case open my own
 * party so others can drop in. While it runs, requests to my party are let in at once,
 * the way Fill works in shooters. Strangers are already limited to my age bracket.
 */
export async function startMateSearch(): Promise<void> {
  const st = party()
  if (!st.safety.ageBracket) {
    st.set({ lfgOpen: true })
    return
  }
  if (st.safety.newAccount) {
    showToast('Искать напарников можно через неделю после регистрации', 'error')
    return
  }
  useMateSearch.getState().set({ searching: true, since: Date.now() })
  ticks = 0
  try {
    if (!partyWithOthers(st.party)) {
      const list = await api<{ cards: LfgCard[] }>('/party/lfg')
      const mate = pickMate(Array.isArray(list.cards) ? list.cards : [], st.me, MATE_TAGS)
      if (mate) await api('/party/lfg/' + encodeURIComponent(mate.id) + '/request', { method: 'POST', body: '{}' })
    }
    await api('/party/lfg', { method: 'POST', body: JSON.stringify({ tags: MATE_TAGS }) })
  } catch (e) {
    useMateSearch.getState().set({ searching: false })
    showToast(apiErrorText(e, 'Поиск не запустился'), 'error')
    return
  }
  window.clearInterval(timer)
  timer = window.setInterval(() => void tick(), POLL_MS)
}

export async function stopMateSearch(): Promise<void> {
  window.clearInterval(timer)
  timer = 0
  useMateSearch.getState().set({ searching: false })
  await api('/party/lfg/remove', { method: 'POST', body: '{}' }).catch((e) => console.warn('[mates] stop', e))
}
