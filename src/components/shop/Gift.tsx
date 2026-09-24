import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { RARITY_NAMES, type ShopGift } from '../../lib/rubies'
import { Countdown, Shard, toneStyle } from './parts'
import './gift.css'

const COUNT_MS = 700

/** Число доезжает до награды — в эти полсекунды и случается «получил». */
function CountUp({ to }: { to: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setShown(to)
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / COUNT_MS)
      setShown(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to])
  return <>{shown.toLocaleString('ru-RU')}</>
}

/** «осколок / осколка / осколков». */
function shardsWord(n: number): string {
  const tens = n % 100
  const ones = tens % 10
  if (tens > 10 && tens < 20) return 'осколков'
  if (ones === 1) return 'осколок'
  if (ones >= 2 && ones <= 4) return 'осколка'
  return 'осколков'
}
function rubiesWord(n: number): string {
  const tens = n % 100
  const ones = tens % 10
  if (tens > 10 && tens < 20) return 'рубинов'
  if (ones === 1) return 'рубин'
  if (ones >= 2 && ones <= 4) return 'рубина'
  return 'рубинов'
}

/**
 * Подарок дня — первая плитка магазина (правка владельца 23.09.2026: «чтобы
 * был смысл каждый день заходить»). Вторая правка того же дня: «+30 осколков,
 * "забрать подарок дня" — выглядит хуёво, и текст странный». Теперь: крупная
 * награда (картинка и число) на сцене, одна строка, «Забрать», а после —
 * таймер до следующего подарка вместо даты.
 */
export function GiftTile({ gift, busy, onClaim }: { gift: ShopGift; busy: boolean; onClaim: () => Promise<boolean> }) {
  // «Только что забрал» — играем получение; при повторном открытии экрана — спокойное «Забрано».
  const [fresh, setFresh] = useState(false)
  const claimed = gift.claimed
  const amount = gift.amount ?? 0
  const isItem = gift.kind === 'ITEM' && !!gift.item

  return (
    <div className={'gf' + (claimed ? ' is-claimed' : '') + (fresh ? ' is-fresh' : '')} style={isItem ? toneStyle(gift.item!) : undefined}>
      <span className="gf-kicker">Подарок дня</span>
      <span className="gf-stage">
        <span className="gf-rays" aria-hidden="true" />
        {fresh ? <span className="gf-burst" aria-hidden="true" /> : null}
        <span className="gf-prize">
          {isItem ? (
            gift.item!.preview ? (
              <img src={gift.item!.preview} alt="" draggable={false} />
            ) : (
              <Icon id="i-gift" />
            )
          ) : gift.kind === 'RUBIES' ? (
            <Ruby size={72} />
          ) : (
            <Shard size={76} />
          )}
        </span>
        {!isItem ? (
          <b className="gf-amount">+{fresh ? <CountUp to={amount} /> : amount.toLocaleString('ru-RU')}</b>
        ) : null}
      </span>
      <span className="gf-line">
        {isItem ? (
          <>
            <b>{gift.item!.name}</b>
            <i style={toneStyle(gift.item!)}>{RARITY_NAMES[gift.item!.rarity]}</i>
          </>
        ) : (
          <b>{gift.kind === 'RUBIES' ? rubiesWord(amount) : shardsWord(amount)}</b>
        )}
      </span>
      {claimed ? (
        <span className="sh-tag sh-timer gf-next">
          <Icon id="i-clock" />
          <span>Новый через</span>
          <b>
            <Countdown to={gift.refreshAt} />
          </b>
        </span>
      ) : (
        <button
          className="btn md primary gf-btn"
          disabled={busy}
          data-track="gift_claim"
          onClick={() =>
            void onClaim().then((ok) => {
              if (ok) setFresh(true)
            })
          }
        >
          Забрать
        </button>
      )}
    </div>
  )
}
