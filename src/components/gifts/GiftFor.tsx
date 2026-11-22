import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { Ruby } from '../Ruby'
import { GiftNote } from '../shop/GiftNote'
import { apiErrorText } from '../../lib/apiError'
import { giveFriendGift, loadFriendGiftOffers, type FriendGiftOffer } from '../../lib/gifts'
import { newRequestId } from '../../lib/rubies'
import { balanceText, moneyText, refreshMoney, showMoneyError } from '../../lib/useMoney'
import { closeGiftFor, useGiftFor } from '../../state/giftFor'
import { showToast } from '../../state/ui'
import { intlTag, useT } from '../../i18n'
import './gift-for.css'

const keyOf = (o: FriendGiftOffer) => o.kind + ':' + o.product

/** «Подарить» у друга: вещь из магазина, набор рубинов или месяц PLUS — с баланса Millida, без привязки карты. */
export function GiftFor() {
  const t = useT()
  const friend = useGiftFor((s) => s.friend)
  const [offers, setOffers] = useState<FriendGiftOffer[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const note = useRef('')
  const requestId = useRef(newRequestId())

  useEffect(() => {
    if (!friend) return
    setPicked(null)
    setBusy(false)
    note.current = ''
    requestId.current = newRequestId()
    let alive = true
    void refreshMoney()
    loadFriendGiftOffers()
      .then((r) => alive && (setOffers(r.items), setFailed(false)))
      .catch((err) => {
        console.warn('[gifts] offers', err)
        if (alive) setFailed(true)
      })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeGiftFor()
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      alive = false
      window.removeEventListener('keydown', onKey, true)
    }
  }, [friend])

  const plus = useMemo(() => (offers ?? []).filter((o) => o.kind === 'PLUS'), [offers])
  const packs = useMemo(() => (offers ?? []).filter((o) => o.kind === 'RUBIES'), [offers])
  const choice = (offers ?? []).find((o) => keyOf(o) === picked) ?? null

  if (!friend) return null
  const balance = balanceText()

  const send = async () => {
    if (!choice || busy) return
    setBusy(true)
    try {
      await giveFriendGift({
        kind: choice.kind,
        product: choice.product,
        to: friend.userId,
        requestId: requestId.current,
        ...(note.current ? { message: note.current } : {}),
      })
      void refreshMoney()
      showToast(t('Подарок отправлен {name}', { name: friend.nickname }), 'ok')
      closeGiftFor()
    } catch (err) {
      setBusy(false)
      if (!showMoneyError(err)) showToast(apiErrorText(err, t('Не удалось подарить. Попробуй ещё раз')), 'error')
    }
  }

  const tile = (o: FriendGiftOffer) => {
    const on = keyOf(o) === picked
    return (
      <button
        key={keyOf(o)}
        type="button"
        className={'gfr-tile' + (on ? ' on' : '') + (o.kind === 'PLUS' ? ' is-plus' : '')}
        aria-pressed={on}
        data-track={'gift_for_' + o.kind.toLowerCase()}
        onClick={() => setPicked(keyOf(o))}
      >
        <span className="gfr-art" aria-hidden="true">
          {o.kind === 'PLUS' ? <Icon id={o.product === 'DIAMOND' ? 'i-gem' : 'i-crown'} /> : <Ruby size={30} />}
        </span>
        <b>{o.kind === 'PLUS' ? (o.product === 'DIAMOND' ? t('PLUS Diamond на месяц') : t('PLUS на месяц')) : o.rubies.toLocaleString(intlTag())}</b>
        <small>{moneyText(o.priceMinor, o.currency) ?? ''}</small>
      </button>
    )
  }

  return createPortal(
    <div className="modal-bg open vis pp-bg gfr-bg" onClick={() => !busy && closeGiftFor()}>
      <div className="modal pp gfr" role="dialog" aria-label={t('Подарок для {nick}', { nick: friend.nickname })} onClick={(e) => e.stopPropagation()}>
        <div className="pp-head">
          <b className="pp-title">{t('Подарок для {nick}', { nick: friend.nickname })}</b>
          {balance ? <span className="pp-sub">{t('На балансе {sum}', { sum: balance })}</span> : null}
          <button className="pp-x" aria-label={t('Закрыть')} data-track="gift_for_close" disabled={busy} onClick={closeGiftFor}>
            <Icon id="i-x" />
          </button>
        </div>
        <button
          type="button"
          className="gfr-shop"
          data-track="gift_for_item"
          onClick={() => {
            closeGiftFor()
            void import('../shop/giftPick').then((m) => m.giftToFriend(friend))
          }}
        >
          <PxIcon name="gift" size={28} />
          <span>
            <b>{t('Вещь из магазина')}</b>
            <small>{t('Выбери вещь — она уйдёт другу за рубины')}</small>
          </span>
          <Icon id="i-chev-r" />
        </button>
        {failed ? (
          <p className="gfr-none">{t('Не удалось загрузить подарки')}</p>
        ) : !offers ? (
          <div className="gfr-grid" aria-busy="true">
            <span className="skel gfr-skel" />
            <span className="skel gfr-skel" />
            <span className="skel gfr-skel" />
          </div>
        ) : (
          <>
            {plus.length ? <div className="gfr-grid two">{plus.map(tile)}</div> : null}
            {packs.length ? <div className="gfr-grid">{packs.map(tile)}</div> : null}
          </>
        )}
        {choice ? <GiftNote onChange={(text) => (note.current = text)} /> : null}
        <button className="btn lg primary gfr-send" disabled={!choice || busy} data-track="gift_for_send" onClick={() => void send()}>
          {busy ? (
            <span className="bs-spin" aria-label={t('Ждём')} />
          ) : choice ? (
            t('Подарить за {price}', { price: moneyText(choice.priceMinor, choice.currency) ?? '' })
          ) : (
            t('Выбери подарок')
          )}
        </button>
        <p className="gfr-hint">{t('Списывается с баланса Millida, без привязки карты и автопродления')}</p>
      </div>
    </div>,
    document.body,
  )
}
