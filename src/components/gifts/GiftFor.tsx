import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { Ruby } from '../Ruby'
import { GiftNote } from '../shop/GiftNote'
import { giftQuote } from './giftQuote'
import { apiErrorText } from '../../lib/apiError'
import { giveFriendGift, loadFriendGiftOffers, type FriendGiftOffer } from '../../lib/gifts'
import { newRequestId } from '../../lib/rubies'
import { moneyShortfall, shortfallOf, shortfallText, type MoneyShortfall } from '../../lib/money'
import { balanceText, moneyText, openTopup, refreshMoney, useMoney } from '../../lib/useMoney'
import { closeGiftFor, useGiftFor } from '../../state/giftFor'
import { showToast } from '../../state/ui'
import { intlTag, useT } from '../../i18n'
import '../../styles/pixel/shop2.css'
import './gift-for.css'

const keyOf = (o: Pick<FriendGiftOffer, 'kind' | 'product'>) => o.kind + ':' + o.product

/** «Подарить» у друга: вещь из магазина, набор рубинов или месяц PLUS — с баланса Millida, без привязки карты. */
export function GiftFor() {
  const t = useT()
  const friend = useGiftFor((s) => s.friend)
  const want = useGiftFor((s) => s.want)
  const [offers, setOffers] = useState<FriendGiftOffer[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<{ text: string; short: MoneyShortfall | null } | null>(null)
  const { view, prices } = useMoney()
  const note = useRef('')
  const requestId = useRef(newRequestId())
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!friend) return
    setPicked(want ? keyOf(want) : null)
    setBusy(false)
    setRefusal(null)
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
    const onFocus = () => void refreshMoney().then(() => alive && setRefusal((was) => (was?.short ? null : was)))
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('focus', onFocus)
    return () => {
      alive = false
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('focus', onFocus)
    }
  }, [friend, want])

  useEffect(() => {
    if (friend && want && offers) body.current?.querySelector('.gfr-tile.on')?.scrollIntoView({ block: 'nearest' })
  }, [friend, want, offers])

  const plus = useMemo(() => (offers ?? []).filter((o) => o.kind === 'PLUS'), [offers])
  const packs = useMemo(() => (offers ?? []).filter((o) => o.kind === 'RUBIES'), [offers])
  const choice = (offers ?? []).find((o) => keyOf(o) === picked) ?? null

  if (!friend) return null
  const balance = balanceText()
  const quote = choice ? giftQuote(choice.priceMinor, choice.currency, view?.rubPerUsd ?? prices?.rubPerUsd ?? null) : null
  const short = shortfallOf(quote, view) ?? refusal?.short ?? null
  const problem = short ? shortfallText(short) : (refusal?.text ?? null)

  const send = async () => {
    if (!choice || busy) return
    if (short) return openTopup(short.topup)
    setBusy(true)
    setRefusal(null)
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
      const miss = moneyShortfall(err)
      if (miss) void refreshMoney()
      setRefusal({ text: apiErrorText(err, t('Не удалось подарить. Попробуй ещё раз')), short: miss })
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
        onClick={() => {
          setPicked(keyOf(o))
          setRefusal(null)
        }}
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
      <div ref={body} className="modal pp gfr" role="dialog" aria-label={t('Подарок для {nick}', { nick: friend.nickname })} onClick={(e) => e.stopPropagation()}>
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
        <button className="btn lg primary gfr-send" disabled={!choice || busy} data-track={short ? 'gift_for_topup' : 'gift_for_send'} onClick={() => void send()}>
          {busy ? (
            <span className="bs-spin" aria-label={t('Ждём')} />
          ) : short ? (
            short.topup ? t('Пополнить {sum}', { sum: moneyText(short.topup.amountMinor, short.topup.currency) ?? '' }) : t('Пополнить')
          ) : choice ? (
            t('Подарить за {price}', { price: moneyText(choice.priceMinor, choice.currency) ?? '' })
          ) : (
            t('Выбери подарок')
          )}
        </button>
        {problem ? <p className="gfr-err" role="alert">{problem}</p> : null}
        <p className="gfr-hint">{t('Списывается с баланса Millida, без привязки карты и автопродления')}</p>
      </div>
    </div>,
    document.body,
  )
}
