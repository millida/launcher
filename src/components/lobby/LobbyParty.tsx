import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { friendServer } from '../friends/FriendRow'
import { useFriends, loadFriends, unreadTotal } from '../../state/friends'
import { roomsUnreadTotal, useRooms } from '../../state/rooms'
import { useHasMillida } from '../../state/auth'
import type { Friend } from '../../state/friends'
import { api, hasMillidaAccount } from '../../lib/api'
import { quickJoin } from '../../lib/joinServer'
import { rememberServerName } from '../../state/playStats'
import { setScreen, showToast } from '../../state/ui'
import { profileSlug } from '../../state/accounts'
import { copyText } from '../../lib/clipboard'
import { useT } from '../../i18n'

/** Сколько друзей стоит рядом с персонажем: дальше — вкладка «Друзья». */
const SHOWN = 4

/**
 * Единственный вход в «Друзья» с лобби: кнопка внизу списка есть всегда, даже
 * когда в сети никого, и несёт счётчик заявок и непрочитанного.
 *
 * Друзья онлайн рядом с персонажем — как пати в лобби Fortnite. Друг уже на
 * сервере — «Зайти» к нему одним кликом. Нет — «Позвать»: ему в личку уходит
 * приглашение в то, что выбрано в «Что играем сегодня».
 */
export function LobbyParty({ on, modeTitle }: { on: boolean; modeTitle: string | null }) {
  const t = useT()
  const friends = useFriends((s) => s.friends)
  const reqIn = useFriends((s) => s.reqIn)
  const rooms = useRooms((s) => s.rooms)
  const millida = useHasMillida()
  const [called, setCalled] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)

  // Ссылка на свой профиль: друг открывает и жмёт «Добавить в друзья».
  // Профиля нет (скрыт или не заведён) — в «Друзья», там поиск по нику.
  const invite = async () => {
    const slug = profileSlug()
    if (!slug) return setScreen('friends')
    const ok = await copyText('https://millida.net/u/' + encodeURIComponent(slug))
    if (!ok) return showToast(t('Не удалось скопировать'), 'error')
    setCopied(true)
    showToast(t('Ссылка скопирована — отправь другу'))
    setTimeout(() => setCopied(false), 2500)
  }

  useEffect(() => {
    if (on && hasMillidaAccount()) void loadFriends()
  }, [on])

  const online = friends
    .filter((f) => f.online)
    .sort((a, b) => Number(!!friendServer(b)) - Number(!!friendServer(a)))
    .slice(0, SHOWN)
  // Непрочитанное в группах — тот же счётчик: для человека это одно «мне написали».
  const alerts = millida ? unreadTotal(friends) + roomsUnreadTotal(rooms) + reqIn.length : 0

  const call = async (f: Friend) => {
    const text = modeTitle ? t('Го играть: {mode}', { mode: modeTitle }) : t('Го играть')
    setCalled((c) => ({ ...c, [f.userId]: true }))
    try {
      await api('/friends/chat/' + encodeURIComponent(f.userId), { method: 'POST', body: JSON.stringify({ text }) })
      showToast(f.nickname ? t('Позвали {nick}', { nick: f.nickname }) : t('Позвали друга'))
    } catch (e) {
      console.error('[lobby] invite', e)
      setCalled((c) => ({ ...c, [f.userId]: false }))
      showToast(t('Не удалось позвать'), 'error')
    }
  }

  const join = (f: Friend) => {
    const addr = friendServer(f)
    if (!addr) return
    const name = f.serverName || (f.nickname ? t('Сервер {nick}', { nick: f.nickname }) : t('Сервер друга'))
    rememberServerName(addr, name)
    void quickJoin(addr, name).catch(() => {})
  }

  return (
    <div className="lobby-party">
      {/* Никого в сети — приглашение по ссылке на свой профиль (там кнопка
          «Добавить в друзья»). Правка владельца 23.09.2026: три пустых плюса
          выглядели странно. */}
      {online.length ? null : (
        <div className="lobby-invite">
          <b>{t('Никого нет в сети')}</b>
          <button className="btn primary lobby-invite-btn" data-sound="nav" onClick={() => void invite()}>
            <Icon id={copied ? 'i-check' : 'i-link'} />
            {copied ? t('Ссылка скопирована') : t('Пригласить')}
          </button>
        </div>
      )}
      {online.map((f) => {
        const addr = friendServer(f)
        return (
          <div className="lobby-mate" key={f.userId}>
            <Head nick={f.nickname} src={f.avatarUrl} size={36} className="lobby-mate-head" />
            <span className="lobby-mate-body">
              <b>{f.nickname || t('Друг')}</b>
              <span className="meta">{addr ? f.serverName || t('В игре') : f.place === 'game' ? t('В игре') : t('В лаунчере')}</span>
            </span>
            {addr ? (
              <button className="lobby-mate-act" data-sound="nav" onClick={() => join(f)}>
                <Icon id="i-login" />
                {t('Зайти')}
              </button>
            ) : (
              <button
                className="lobby-mate-act"
                data-sound="nav"
                disabled={called[f.userId]}
                onClick={() => void call(f)}
              >
                <Icon id={called[f.userId] ? 'i-check' : 'i-send'} />
                {called[f.userId] ? t('Позвали') : t('Позвать')}
              </button>
            )}
          </div>
        )
      })}
      <button className="lobby-mate more" data-sound="nav" onClick={() => setScreen('friends')}>
        <span className="lobby-mate-head">
          <Icon id="i-users" />
        </span>
        <span className="lobby-mate-body">
          <b>{online.length ? t('Все друзья') : t('Друзья')}</b>
        </span>
        {alerts ? (
          <span className="lobby-mate-badge" aria-label={t('Новые сообщения и заявки')}>
            {alerts > 99 ? '99+' : alerts}
          </span>
        ) : null}
      </button>
    </div>
  )
}
