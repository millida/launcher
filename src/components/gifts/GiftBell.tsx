import { useEffect, useMemo } from 'react'
import { Head } from '../Head'
import { PxIcon } from '../PxIcon'
import { showGift, useGifts } from '../../state/gifts'
import { useChatNotify } from '../../state/chatNotify'
import { notifyShown } from '../../state/notifyPrefs'
import { useGiftSnooze } from './snooze'
import { useT } from '../../i18n'

export function GiftBell() {
  const t = useT()
  const received = useGifts((s) => s.history?.received)
  const waiting = useMemo(() => received?.filter((g) => !g.opened) ?? [], [received])
  const later = useGiftSnooze((s) => s.later)
  const toasts = useChatNotify((s) => s.items)
  const fresh = notifyShown('gift') ? waiting.find((g) => !later.includes(g.id)) : undefined

  useEffect(() => {
    const dismiss = useChatNotify.getState().dismiss
    toasts.filter((n) => n.kind === 'gift').forEach((n) => dismiss(n.id))
  }, [toasts])

  if (!waiting.length) return null
  if (fresh) {
    const nick = fresh.from?.nickname || t('Друг')
    return (
      <div className="lb-gift-card" role="status" data-private>
        <span className="lb-gift-art" aria-hidden="true">
          <PxIcon name="gift" size={34} />
        </span>
        <span className="lb-gift-txt">
          <b>{t('Тебе подарок!')}</b>
          <i>
            <Head nick={fresh.from?.nickname} size={16} />
            {t('Подарок от {nick}', { nick })}
          </i>
        </span>
        <button className="btn sm primary" data-track="gift_card_open" onClick={() => showGift(fresh.id)}>
          {t('Открыть')}
        </button>
        <button className="btn sm secondary" data-track="gift_card_later" onClick={() => useGiftSnooze.getState().snooze(fresh.id)}>
          {t('Позже')}
        </button>
      </div>
    )
  }
  const count = waiting.length
  return (
    <span className="lb-badge-wrap lb-gift-bell">
      <button
        className="lb-btn lb-gift"
        data-sound="open"
        data-track="nav_gift"
        aria-label={t('Тебе пришли подарки: {n}', { n: count })}
        title={t('Открыть подарок')}
        onClick={() => showGift(waiting[0]!.id)}
      >
        <PxIcon name="gift" size={30} />
      </button>
      {count > 1 ? <span className="lb-badge">{count > 99 ? '99+' : count}</span> : null}
    </span>
  )
}
