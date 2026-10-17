import { useEffect } from 'react'
import { Icon } from '../Icon'
import { useHasMillida } from '../../state/auth'
import { loadMyServers, usePlayInvite } from '../../state/playInvite'
import { setScreen } from '../../state/ui'
import { useT } from '../../i18n'

/**
 * Хостинг продаётся через друзей (владелец 24.09.2026, 13:33): у кого нет
 * своего сервера, тот видит в «Друзьях» одну строку — картинка компании,
 * заголовок и «Создать сервер». Сервер уже есть — строки нет: звать на него
 * можно кнопкой «Позвать играть» у каждого друга.
 */
export function PlayTogether() {
  const t = useT()
  const millida = useHasMillida()
  const servers = usePlayInvite((s) => s.servers)
  useEffect(() => {
    if (millida) void loadMyServers()
  }, [millida])
  if (!millida || !servers || servers.length) return null
  return (
    <div className="fr-host">
      <img className="fr-host-art" src="/lobby/duo@2x.webp" alt="" draggable={false} />
      <b className="fr-host-title">{t('Играйте вместе на своём сервере')}</b>
      <button className="btn md primary fr-host-btn" data-track="friends_hosting" data-kind="hosting" onClick={() => setScreen('hosting')}>
        <Icon id="i-server" />
        {t('Создать сервер')}
      </button>
    </div>
  )
}
