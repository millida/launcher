import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { Chest3D } from '../daily/Chest3D'
import { playSound } from '../../lib/sound'
import { RARITY_NAMES, type ItemRef, type XrayOffer } from '../../lib/rubies'
import { ItemArt, Price, Timer, toneStyle } from './parts'

/**
 * Рентген-кейс: сундук, внутри которого вещь видна ДО оплаты, цена
 * фиксированная. Случайности за деньги нет — открытие только показывает
 * уже известную вещь. Следующий кейс — через 4 часа, перебирать нельзя.
 * Плитка стоит ведущей в «Для тебя» и занимает место четырёх карточек.
 */
export function XrayCard({
  offer,
  balance,
  busy,
  onBuy,
  onEnd,
}: {
  offer: XrayOffer
  balance: number
  busy: string
  onBuy: (offer: XrayOffer) => void
  onEnd?: () => void
}) {
  const waiting = !!offer.nextAt && new Date(offer.nextAt).getTime() > Date.now()
  const short = offer.price - balance
  return (
    <div
      className={'sh-card sh-xray' + (waiting ? ' is-wait' : '')}
      style={toneStyle(offer.item)}
      data-section="xray"
      data-kind="offer"
      data-id={offer.id}
    >
      <div className="sh-xray-stage">
        <Chest3D tier={offer.tier} mode={waiting ? 'closed' : 'ready'} framing="hero" />
      </div>
      {waiting ? (
        <div className="sh-xray-body">
          <span className="sh-kicker">
            <Icon id="i-eye" />
            Рентген-кейс
          </span>
          <b className="sh-xray-wait">Открыт: {offer.item.name}</b>
          <Timer to={offer.nextAt!} label="Новый через" onEnd={onEnd} />
        </div>
      ) : (
        <div className="sh-xray-body">
          <span className="sh-kicker">
            <Icon id="i-eye" />
            Рентген-кейс
          </span>
          <span className="sh-xray-item">
            <ItemArt item={offer.item} size="sm" />
            <span>
              <b>{offer.item.name}</b>
              <i>{RARITY_NAMES[offer.item.rarity]}</i>
            </span>
          </span>
          <Price price={offer.price} big />
          <button className={'btn md ' + (short > 0 ? 'secondary' : 'primary')} disabled={busy === offer.id} data-track="buy_xray" onClick={() => onBuy(offer)}>
            Купить
          </button>
          <Timer to={offer.expiresAt} label="Сменится через" onEnd={onEnd} />
        </div>
      )}
    </div>
  )
}

/** Минимум тряски: без неё открытие проходит мимо глаз. */
const SHAKE_MS = 1500
/** После откинутой крышки — миг света, потом окно сундука уступает мигу награды. */
const LIGHT_MS = 380

/**
 * Открытие на весь экран: тряска и крышка. `item` приходит из ответа покупки;
 * пока его нет — сундук трясётся. Саму вещь показывает общий миг награды
 * (`showReward`, зовёт магазин в `onOpened`) — своей карточки здесь нет.
 */
export function XrayOpening({
  tier,
  item,
  onOpened,
}: {
  tier: XrayOffer['tier']
  item: ItemRef | null
  onOpened: (item: ItemRef) => void
}) {
  const [minDone, setMinDone] = useState(false)
  const opened = useRef(onOpened)
  opened.current = onOpened
  useEffect(() => {
    playSound('open')
    const id = window.setTimeout(() => setMinDone(true), SHAKE_MS)
    return () => window.clearTimeout(id)
  }, [])
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const mode = minDone && item ? 'open' : 'shake'

  return createPortal(
    <div className="sh-xo" role="status" aria-label="Открытие кейса">
      <div className="sh-xo-stage">
        <Chest3D
          tier={tier}
          mode={mode}
          framing="reveal"
          onOpened={() => {
            if (!item) return
            timer.current = window.setTimeout(() => opened.current(item), LIGHT_MS)
          }}
        />
      </div>
    </div>,
    document.body,
  )
}
