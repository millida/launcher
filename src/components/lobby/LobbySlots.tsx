import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { FlatFigure } from '../character/FlatFigure'
import { nickSkinUrl } from '../../lib/characterStage'
import { DEFAULT_PARTY_CAPACITY, sameIdentity, slotPlan, type PartyMember } from '../../lib/party'
import { isLeader, kickFromParty, promoteInParty, usePartyStore } from '../../state/party'
import { useCall } from '../../state/call'
import { useHasMillida } from '../../state/auth'
import { uiConfirm } from '../../state/confirm'

function SlotMenu({ m, leader, close }: { m: PartyMember; leader: boolean; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [close])
  const nick = m.nickname || 'Игрок'
  return (
    <div className="party-menu" ref={ref} role="menu">
      {leader ? (
        <>
          <button role="menuitem" onClick={() => void promoteInParty(m.userId).then(close)}>
            <Icon id="i-crown" />
            Сделать лидером
          </button>
          <button
            role="menuitem"
            onClick={() =>
              void uiConfirm('Исключить ' + nick + ' из пати?', { confirmLabel: 'Исключить', danger: true }).then((ok) => {
                close()
                if (ok) void kickFromParty(m.userId)
              })
            }
          >
            <Icon id="i-logout" />
            Исключить
          </button>
        </>
      ) : null}
      <button
        role="menuitem"
        className="danger"
        onClick={() => {
          close()
          usePartyStore.getState().set({ reportAsk: { userId: m.userId, nick, context: 'party' } })
        }}
      >
        <Icon id="i-flag" />
        Пожаловаться
      </button>
    </div>
  )
}

/**
 * Party seats beside the player's own character, as in a Fortnite lobby: friends stand
 * a step behind on both flanks, free seats are plus-plates that open the invite window.
 */
export function LobbySlots({ on }: { on: boolean }) {
  const millida = useHasMillida()
  const party = usePartyStore((s) => s.party)
  const me = usePartyStore((s) => s.me)
  const parts = useCall((s) => s.parts)
  const callRoom = useCall((s) => s.roomId)
  const [menu, setMenu] = useState('')
  if (!on || !millida) return null

  const capacity = party ? party.capacity : DEFAULT_PARTY_CAPACITY
  const plan = slotPlan(capacity, party ? party.members : [], me)
  const leader = isLeader(party, me)
  const inVoice = !!party && callRoom === party.id
  const voiceOf = (userId: string) => (party ? party.voice.find((v) => v.userId === userId) : undefined)
  const openInvite = () => usePartyStore.getState().set({ inviteOpen: true })

  const slot = (i: number) => {
    const cell = plan.cells[i]
    if (!cell) return null
    const m = cell.member
    if (!m) {
      return (
        <button key={'free' + i} className="party-slot free" data-sound="open" onClick={openInvite} aria-label="Позвать в пати">
          <span className="party-slot-empty">
            <Icon id="i-plus" />
          </span>
          <span className="party-plate muted">Позвать</span>
        </button>
      )
    }
    const part = inVoice ? parts.find((p) => p.userId === m.userId) : undefined
    const voice = voiceOf(m.userId)
    const speaking = !!part && part.speaking
    const ready = m.role === 'leader' || (m.ready && !!party?.target && sameIdentity(m.have, party.target))
    return (
      <div key={m.userId} className={'party-slot' + (speaking ? ' speaking' : '')}>
        <button className="party-slot-fig" aria-label={m.nickname || 'Игрок'} onClick={() => setMenu(menu === m.userId ? '' : m.userId)} aria-haspopup="menu">
          <FlatFigure url={nickSkinUrl(m.nickname || 'MHF_Steve')} />
        </button>
        <span className="party-plate">
          {m.role === 'leader' ? <Icon id="i-crown" className="party-crown" /> : null}
          <b>{m.nickname || 'Игрок'}</b>
          {voice ? <Icon id={voice.muted ? 'i-mute' : 'i-mic'} className={'party-mic' + (speaking ? ' on' : '')} /> : null}
          {ready ? <Icon id="i-check" className="party-ready" /> : null}
        </span>
        {menu === m.userId ? <SlotMenu m={m} leader={leader} close={() => setMenu('')} /> : null}
      </div>
    )
  }

  const right = plan.cells.map((c, i) => (c.side === 'right' ? i : -1)).filter((i) => i >= 0)
  const left = plan.cells.map((c, i) => (c.side === 'left' ? i : -1)).filter((i) => i >= 0)
  return (
    <div className={'party-slots size-' + plan.size}>
      <div className="party-flank left">{left.map(slot)}</div>
      <div className="party-flank right">{right.map(slot)}</div>
    </div>
  )
}
