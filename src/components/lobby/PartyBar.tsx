import { useState } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import {
  acceptPartyInvite,
  declinePartyInvite,
  isLeader,
  leaveParty,
  partyWithOthers,
  usePartyStore,
} from '../../state/party'
import { joinPartyVoice, leaveRoomVoice, setPushToTalk, toggleMute, useCall } from '../../state/call'
import { useHasMillida } from '../../state/auth'
import { uiConfirm } from '../../state/confirm'

export const PTT_KEY_CODE = 'KeyV'

/**
 * Party controls above the stage: size, voice, push-to-talk and the way out. The mic
 * opens only when the player presses «Голос», never because a party was joined.
 */
export function PartyBar({ on }: { on: boolean }) {
  const millida = useHasMillida()
  const party = usePartyStore((s) => s.party)
  const me = usePartyStore((s) => s.me)
  const invites = usePartyStore((s) => s.invites)
  const callRoom = useCall((s) => s.roomId)
  const callStatus = useCall((s) => s.status)
  const muted = useCall((s) => s.muted)
  const speaking = useCall((s) => s.speaking)
  const ptt = useCall((s) => s.ptt)
  const [busy, setBusy] = useState(false)
  if (!on || !millida) return null

  const inVoice = !!party && callRoom === party.id && callStatus !== 'idle'
  const together = partyWithOthers(party)
  const invite = invites[0]

  const leave = async () => {
    if (!(await uiConfirm('Выйти из пати?', { confirmLabel: 'Выйти' }))) return
    if (inVoice) await leaveRoomVoice()
    await leaveParty()
  }

  const answer = async (accept: boolean) => {
    if (!invite || busy) return
    setBusy(true)
    try {
      if (accept) await acceptPartyInvite(invite.id)
      else await declinePartyInvite(invite.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="party-bar">
      <div className="party-bar-row">
        {party ? (
          <span className="party-chip">
            {isLeader(party, me) ? <Icon id="i-crown" /> : <Icon id="i-users" />}
            {'Пати ' + party.members.length + '/' + party.capacity}
            {party.target ? <span className="party-chip-target">{party.target.title}</span> : null}
          </span>
        ) : null}
        {together ? (
          inVoice ? (
            <>
              <button
                className={'lobby-tool' + (speaking ? ' on' : '')}
                aria-label={muted ? 'Включить микрофон' : 'Выключить микрофон'}
                onClick={() => (ptt ? setPushToTalk(false) : toggleMute())}
              >
                <Icon id={muted ? 'i-mute' : 'i-mic'} />
              </button>
              <button
                className={'lobby-tool' + (ptt ? ' on' : '')}
                aria-pressed={ptt}
                onClick={() => setPushToTalk(!ptt)}
              >
                <Icon id="i-headset" />
                Рация V
              </button>
              <button className="lobby-tool" aria-label="Выйти из голоса" onClick={() => void leaveRoomVoice()}>
                <Icon id="i-phone" />
                Отключить
              </button>
            </>
          ) : (
            <button className="lobby-tool" data-sound="nav" onClick={() => party && void joinPartyVoice(party.id)}>
              <Icon id="i-mic" />
              Голос
            </button>
          )
        ) : null}
        <button className="lobby-tool" data-sound="open" onClick={() => usePartyStore.getState().set({ lfgOpen: true })}>
          <Icon id="i-search" />
          Напарники
        </button>
        {party && together ? (
          <button className="lobby-tool" aria-label="Выйти из пати" onClick={() => void leave()}>
            <Icon id="i-logout" />
          </button>
        ) : null}
      </div>
      {invite ? (
        <div className="party-invite">
          <Head nick={invite.from.nickname} src={invite.from.avatarUrl} size={24} />
          <span>
            <b>{invite.from.nickname || 'Друг'}</b> зовёт в пати
          </span>
          <button className="lobby-tool on" disabled={busy} onClick={() => void answer(true)}>
            <Icon id="i-check" />
            Войти
          </button>
          <button className="lobby-tool" disabled={busy} aria-label="Отклонить" onClick={() => void answer(false)}>
            <Icon id="i-x" />
          </button>
        </div>
      ) : null}
    </div>
  )
}
