import { Icon } from '../Icon'
import { Head } from '../Head'
import { cancelPendingInvite, usePlayInvite } from '../../state/playInvite'
import { useT } from '../../i18n'

/**
 * Пометка на «Хостинге», кого позовём, когда сервер будет готов: пришли сюда
 * из «Позвать играть» у друга, своего сервера ещё не было.
 */
export function InviteChip() {
  const t = useT()
  const p = usePlayInvite((s) => s.pending)
  if (!p) return null
  return (
    <span className="host-inv-chip">
      {p.room ? <Icon id="i-users" /> : <Head nick={p.nick} size={24} />}
      <span>
        {t('Позовём')} <b>{p.nick}</b>
      </span>
      <button className="host-inv-x" aria-label={t('Не звать')} data-track="invite_cancel" onClick={cancelPendingInvite}>
        <Icon id="i-x" />
      </button>
    </span>
  )
}
