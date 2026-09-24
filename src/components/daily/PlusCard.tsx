import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { backdropClose } from '../../lib/dismiss'
import { rubles, type ChestTier } from '../../lib/rubies'
import { useDaily } from '../../state/daily'
import { Shard } from '../shop/parts'
import { ChestArt } from './ChestArt'
import { CHEST_NAME } from './rewards'
import { rowTotals, type TrackCol } from './track'

const PAY_TTL = 15 * 60_000
const TIERS: ChestTier[] = ['EPIC', 'RARE', 'COMMON']

/**
 * Карточка PLUS внутри лаунчера (разбор оплаты 24.09.2026): закрытая клетка
 * PLUS и «Оформить PLUS» ведут сюда, а не сразу в браузер. Цена и слово
 * «подписка» — до оплаты; что даёт строка PLUS за сезон — значками из самого
 * трека. «Оформить» открывает оплату; повторное нажатие в 15 минут — ту же
 * ссылку, новая подписка не создаётся (state/daily.ts, startPlus).
 */
export function PlusCard({ cols }: { cols: TrackCol[] }) {
  const open = useDaily((s) => s.plusCard)
  const info = useDaily((s) => s.plus)
  const busy = useDaily((s) => s.busy)
  const pay = useDaily((s) => s.pay)
  const [vis, setVis] = useState(false)
  const close = () => useDaily.getState().setPlusCard(false)

  useEffect(() => {
    if (!open) {
      setVis(false)
      return
    }
    const raf = requestAnimationFrame(() => setVis(true))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (!open) return null
  const price = info && info.priceKopecks > 0 ? info.priceKopecks : 0
  const t = rowTotals(cols, 'plus')
  const waiting = !!pay && Date.now() - pay.at < PAY_TTL

  return createPortal(
    <div className={'modal-bg open pc-bg' + (vis ? ' vis' : '')} {...backdropClose(close)}>
      <div className="modal pc" role="dialog" aria-modal="true" aria-label="Подписка PLUS">
        <div className="pc-head">
          <span className="pc-tag">
            <Icon id="i-crown" />
            PLUS
          </span>
          <button className="icon-btn pc-x" aria-label="Закрыть" data-track="close" onClick={close}>
            <Icon id="i-x" />
          </button>
        </div>

        <div className="pc-price">
          {price ? <b>{rubles(price)}</b> : <span className="skel pc-price-skel" aria-hidden="true" />}
          <small>в месяц · подписка</small>
        </div>

        <div className="pc-gifts" aria-label="Что даёт PLUS за сезон">
          {TIERS.filter((tier) => t.chests[tier] > 0).map((tier) => (
            <span key={tier} className={'pc-gift tier-' + tier.toLowerCase()} title={CHEST_NAME[tier] + ' сундук'}>
              <ChestArt ready={false} tier={tier} size={56} />
              <b>×{t.chests[tier]}</b>
              <small>{CHEST_NAME[tier]}</small>
            </span>
          ))}
          {t.shards ? (
            <span className="pc-gift shards" title="Осколки строки PLUS за сезон">
              <Shard size={44} />
              <b>+{t.shards.toLocaleString('ru-RU')}</b>
              <small>осколков</small>
            </span>
          ) : null}
          <span className="pc-gift boost" title="Осколки бесплатной строки подписчику ×1,5">
            <span className="pc-boost">×1,5</span>
            <small>к осколкам</small>
          </span>
        </div>

        <button
          className="btn lg primary pc-go"
          disabled={!price || busy === 'plus'}
          data-track={waiting ? 'plus_open_payment' : 'plus_subscribe'}
          onClick={() => void useDaily.getState().startPlus()}
        >
          {waiting ? 'Открыть оплату' : 'Оформить'}
        </button>
        {waiting ? (
          <span className="pc-wait">
            <Icon id="i-clock" />
            Ждём оплату в браузере
          </span>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
