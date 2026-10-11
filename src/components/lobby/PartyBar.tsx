import { useState } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { acceptPartyInvite, declinePartyInvite, usePartyStore } from '../../state/party'
import { useHasMillida } from '../../state/auth'

export const PTT_KEY_CODE = 'KeyV'

/** An incoming party invite, shown as a toast over the lobby until it is answered. */
export function PartyBar({ on }: { on: boolean }) {
  const millida = useHasMillida()
  const invite = usePartyStore((s) => s.invites[0])
  const [busy, setBusy] = useState(false)
  if (!on || !millida || !invite) return null

  const answer = async (accept: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      if (accept) await acceptPartyInvite(invite.id)
      else await declinePartyInvite(invite.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="party-invite" role="status">
      <Head nick={invite.from.nickname} src={invite.from.avatarUrl} size={32} />
      <span className="party-invite-text">
        <b>{invite.from.nickname || 'Друг'}</b>
        <span>зовёт в пати</span>
      </span>
      <button className="party-invite-go" disabled={busy} onClick={() => void answer(true)}>
        <Icon id="i-check" />
        Войти
      </button>
      <button className="party-invite-no" disabled={busy} aria-label="Отклонить" onClick={() => void answer(false)}>
        <Icon id="i-x" />
      </button>
    </div>
  )
}
