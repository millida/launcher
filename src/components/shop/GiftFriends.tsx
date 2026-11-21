import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { useFriends } from '../../state/friends'
import { matchFriends } from './friendMatch'
import { useGiftPick } from './giftPick'
import { setScreen } from '../../state/ui'
import { useT } from '../../i18n'

export function GiftPickerHost() {
  const t = useT()
  const ask = useGiftPick((s) => s.ask)
  const close = useGiftPick((s) => s.close)
  const friends = useFriends((s) => s.friends)
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!ask) return
    setQuery('')
    let alive = true
    void useFriends
      .getState()
      .load()
      .finally(() => alive && setLoaded(true))
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', key, true)
    return () => {
      alive = false
      window.removeEventListener('keydown', key, true)
    }
  }, [ask, close])

  const shown = useMemo(() => matchFriends(friends, query), [friends, query])
  if (!ask) return null
  const none = friends.length === 0

  return createPortal(
    <div className="modal-bg open vis pp-bg gfp-bg" onClick={close}>
      <div className="modal pp gfp" role="dialog" aria-label={t('Кому подарить')} onClick={(e) => e.stopPropagation()}>
        <div className="pp-head">
          <b className="pp-title">{t('Кому подарить')}</b>
          <span className="pp-sub">{ask.name}</span>
          <button className="pp-x" aria-label={t('Закрыть')} data-track="gift_pick_close" onClick={close}>
            <Icon id="i-x" />
          </button>
        </div>
        {none && !loaded ? (
          <div className="gfp-list" aria-busy="true">
            <span className="skel gfp-skel" />
            <span className="skel gfp-skel" />
            <span className="skel gfp-skel" />
          </div>
        ) : none ? (
          <div className="gfp-empty">
            <Icon id="i-users" />
            <b>{t('Добавь друзей')}</b>
            <span>{t('Подарки можно дарить только друзьям')}</span>
            <button
              className="btn md secondary"
              data-track="gift_pick_add_friends"
              onClick={() => {
                close()
                setScreen('friends')
              }}
            >
              {t('К друзьям')}
            </button>
          </div>
        ) : (
          <>
            <div className="input sm gfp-search">
              <Icon id="i-search" />
              <input
                autoFocus
                value={query}
                placeholder={t('Найти друга по нику')}
                aria-label={t('Найти друга по нику')}
                spellCheck={false}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {shown.length === 0 ? (
              <p className="gfp-none">{t('Друг с таким ником не найден')}</p>
            ) : (
              <ul className="gfp-list">
                {shown.map((f) => (
                  <li key={f.userId}>
                    <button
                      className="gfp-friend"
                      data-track="gift_pick_friend"
                      onClick={() => {
                        close()
                        ask.onPick({ userId: f.userId, nickname: f.nickname! })
                      }}
                    >
                      <Head nick={f.nickname} src={f.avatarUrl} size={36} className="gfp-face" />
                      <b>{f.nickname}</b>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
