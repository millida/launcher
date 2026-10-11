import { create } from 'zustand'
import { api } from '../lib/api'
import { apiErrorText } from '../lib/apiError'
import { MATE_TAGS, partyFull, pickMate, type LfgCard } from '../lib/party'
import { loadParty, partyWithOthers, usePartyStore } from './party'
import { showToast } from './ui'

const POLL_MS = 5000

interface LfgRequest {
  id: string
}

interface MateSearch {
  searching: boolean
  set: (patch: Partial<MateSearch>) => void
}

export const useMateSearch = create<MateSearch>((set) => ({
  searching: false,
  set: (patch) => set(patch as MateSearch),
}))

let timer = 0
let ticking = false

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
    if ((req.requests || []).length) await loadParty().catch((e) => console.warn('[mates] reload', e))
  } catch (e) {
    console.warn('[mates] poll', e)
  } finally {
    ticking = false
  }
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
  useMateSearch.getState().set({ searching: true })
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
