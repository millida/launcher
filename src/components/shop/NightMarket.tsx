import { useState, type CSSProperties } from 'react'
import { playSound } from '../../lib/sound'
import { RARITY_NAMES, type ShopCard } from '../../lib/rubies'
import { Countdown, ItemArt, leadCls, leadSpans, Price, toneStyle } from './parts'
import { BuyBtn, type BuyProps } from './Storefront'

const KEY = 'm-night-flipped'

/** Какие карты уже перевёрнуты — только вид, данные известны заранее. */
function readFlipped(endsAt: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as { endsAt?: string; codes?: string[] }
    return raw.endsAt === endsAt && Array.isArray(raw.codes) ? raw.codes : []
  } catch {
    return []
  }
}
function saveFlipped(endsAt: string, codes: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ endsAt, codes }))
  } catch {}
}

/**
 * Ночной рынок (как Night Market в Valorant): раз в сезон, 6 личных карт со
 * скидкой. Карта открывается переворотом — это только раскрытие того, что
 * уже известно: никакого броска, перебросов за деньги нет.
 *
 * Правка владельца 23.09.2026: «не очевидно, что карточки можно открыть».
 * Рубашка теперь — кнопка: значок «нажми», слово «Открыть», и закрытые карты
 * по очереди подпрыгивают с бликом. Слева — крупный таймер до конца рынка.
 */
export function NightMarket({ endsAt, cards, onEnd, ...p }: { endsAt: string; cards: ShopCard[]; onEnd?: () => void } & BuyProps) {
  const [flipped, setFlipped] = useState<string[]>(() => readFlipped(endsAt))
  const flip = (code: string) => {
    setFlipped((was) => {
      if (was.includes(code)) return was
      const next = [...was, code]
      saveFlipped(endsAt, next)
      return next
    })
    playSound('success')
  }
  const closed = cards.filter((c) => !flipped.includes(c.item.code))

  return (
    <div className="card sh-block sh-night" data-section="night_market">
      <div className="sh-grid">
        <div className={'sh-lead sh-night-lead ' + leadCls(cards.length)} style={leadSpans(cards.length)}>
          <span className="sh-night-title">Ночной рынок</span>
          <span className="sh-night-clock">
            <b>
              <Countdown to={endsAt} onEnd={onEnd} />
            </b>
            <span>до закрытия</span>
          </span>
          {closed.length > 1 ? (
            <button
              className="btn md primary"
              data-track="night_open_all"
              onClick={() => {
                const all = cards.map((c) => c.item.code)
                setFlipped(all)
                saveFlipped(endsAt, all)
                playSound('success')
              }}
            >
              Открыть все
            </button>
          ) : (
            <span className="sh-note">Скидки только для тебя</span>
          )}
        </div>
        {cards.map((c, i) => {
          const open = flipped.includes(c.item.code)
          const order = closed.findIndex((x) => x.item.code === c.item.code)
          return (
            <div
              key={c.item.code}
              className={'sh-nc' + (open ? ' open' : '')}
              data-kind="offer"
              data-id={c.item.code}
              data-pos={i}
              style={{ ...toneStyle(c.item), '--nc-i': Math.max(0, order), '--nc-n': Math.max(1, closed.length) } as CSSProperties}
            >
              <div className="sh-nc-in">
                <button className="sh-nc-back" data-track="night_flip" onClick={() => flip(c.item.code)} aria-label="Открыть карту" tabIndex={open ? -1 : 0}>
                  <span className="sh-nc-glint" aria-hidden="true" />
                  <span className="sh-nc-cta">Открыть</span>
                </button>
                <div className="sh-nc-face" aria-hidden={!open}>
                  <span className="sh-off big">−{c.discountPct}%</span>
                  <ItemArt item={c.item} />
                  <b className="sh-card-name">{c.item.name}</b>
                  <span className="sh-card-meta">
                    <i>{RARITY_NAMES[c.item.rarity]}</i>
                  </span>
                  <span className="sh-card-foot">
                    <Price price={c.price} base={c.basePrice} />
                    <BuyBtn card={c} source="night" balance={p.balance} busy={p.busy} onBuy={p.onBuy} />
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
