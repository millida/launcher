import { Suspense, lazy, useEffect, useRef } from 'react'
import { initParty, acceptPartyInvite, usePartyStore } from '../../state/party'
import { maybeRunLaunch } from '../../lib/partyPlay'
import { initPartyFlow } from '../../state/partyFlow'
import { holdToTalk, leaveRoomVoice, useCall } from '../../state/call'
import { useHasMillida } from '../../state/auth'
import { setScreen, showToast, useUi } from '../../state/ui'
import { PTT_KEY_CODE } from '../lobby/PartyBar'
// Окна пати открываются не в каждом сеансе: код каждого — отдельный чанк, а не часть стартового бандла.
const PartyRoomsMenu = lazy(() => import('./PartyRoomsMenu').then((m) => ({ default: m.PartyRoomsMenu })))
const LfgModal = lazy(() => import('./LfgModal').then((m) => ({ default: m.LfgModal })))
const PackConfirmModal = lazy(() => import('./PackConfirmModal').then((m) => ({ default: m.PackConfirmModal })))
const ReportModal = lazy(() => import('./ReportModal').then((m) => ({ default: m.ReportModal })))
import '../../styles/pixel/party.css'
import { useT } from '../../i18n'

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

/**
 * Mounted once for the whole app: a party launch or an invite has to reach the player on
 * any screen, and push-to-talk works wherever the launcher window has focus.
 */
export function PartyHost() {
  const t = useT()
  const millida = useHasMillida()
  const inviteOpen = usePartyStore((s) => s.inviteOpen)
  const roomsOpen = usePartyStore((s) => s.roomsOpen)
  const lfgOpen = usePartyStore((s) => s.lfgOpen)
  const packAsk = usePartyStore((s) => s.packAsk)
  const reportAsk = usePartyStore((s) => s.reportAsk)
  const party = usePartyStore((s) => s.party)
  const invites = usePartyStore((s) => s.invites)
  const seen = useRef(new Set<string>())
  const lastPartyId = useRef('')

  useEffect(() => {
    if (!millida) return
    const offFlow = initPartyFlow()
    const offParty = initParty(maybeRunLaunch)
    return () => {
      offFlow()
      offParty()
    }
  }, [millida])

  useEffect(() => {
    const prev = lastPartyId.current
    lastPartyId.current = party ? party.id : ''
    const call = useCall.getState()
    if (prev && prev !== lastPartyId.current && call.roomId === prev) void leaveRoomVoice()
  }, [party])

  useEffect(() => {
    for (const inv of invites) {
      if (seen.current.has(inv.id)) continue
      seen.current.add(inv.id)
      if (useUi.getState().screen === 'play') continue
      showToast(t('{nick} зовёт в пати', { nick: inv.from.nickname || t('Друг') }), 'ok', undefined, {
        label: t('Войти'),
        run: () =>
          void acceptPartyInvite(inv.id).then((p) => {
            if (p) setScreen('play')
          }),
      })
    }
  }, [invites])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== PTT_KEY_CODE || e.repeat || typing(e.target)) return
      holdToTalk(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === PTT_KEY_CODE) holdToTalk(false)
    }
    const blur = () => holdToTalk(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  const set = usePartyStore.getState().set
  return (
    <Suspense fallback={null}>
      {inviteOpen || roomsOpen ? <PartyRoomsMenu key={inviteOpen ? 'f' : 'j'} start={inviteOpen ? 'friends' : 'join'} close={() => set({ inviteOpen: false, roomsOpen: false })} /> : null}
      {lfgOpen ? <LfgModal close={() => set({ lfgOpen: false })} /> : null}
      {packAsk ? (
        <PackConfirmModal
          ask={packAsk}
          close={(answer) => {
            set({ packAsk: null })
            packAsk.resolve(answer)
          }}
        />
      ) : null}
      {reportAsk ? <ReportModal ask={reportAsk} close={() => set({ reportAsk: null })} /> : null}
    </Suspense>
  )
}
