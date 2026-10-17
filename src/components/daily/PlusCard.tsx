import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { backdropClose } from '../../lib/dismiss'
import type { ChestTier } from '../../lib/rubies'
import { useDaily } from '../../state/daily'
import { Shard } from '../shop/parts'
import { ChestLive } from './ChestLive'
import { CHEST_NAME } from './rewards'
import { rowTotals, type TrackCol } from './track'
import { intlTag, useT } from '../../i18n'
import { plusPrice } from '../../lib/regionalPrices'

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
  const t = useT()
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
  const totals = rowTotals(cols, 'plus')
  const waiting = !!pay && Date.now() - pay.at < PAY_TTL

  return createPortal(
    <div className={'modal-bg open pc-bg' + (vis ? ' vis' : '')} {...backdropClose(close)}>
      <div className="modal pc" role="dialog" aria-modal="true" aria-label={t('Подписка PLUS')}>
        <div className="pc-head">
          <span className="pc-tag">
            <Icon id="i-crown" />
            PLUS
          </span>
          <button className="icon-btn pc-x" aria-label={t('Закрыть')} data-track="close" onClick={close}>
            <Icon id="i-x" />
          </button>
        </div>

        <div className="pc-price">
          {price ? <b>{plusPrice('PLUS', price)}</b> : <span className="skel pc-price-skel" aria-hidden="true" />}
          <small>{t('в месяц · подписка')}</small>
        </div>

        <div className="pc-gifts" aria-label={t('Что даёт PLUS за сезон')}>
          {TIERS.filter((tier) => totals.chests[tier] > 0).map((tier) => (
            <span key={tier} className={'pc-gift tier-' + tier.toLowerCase()} title={t('{tier} сундук', { tier: CHEST_NAME[tier] })}>
              <ChestLive ready={false} tier={tier} size={56} />
              <b>×{totals.chests[tier]}</b>
              <small>{CHEST_NAME[tier]}</small>
            </span>
          ))}
          {totals.shards ? (
            <span className="pc-gift shards" title={t('Осколки строки PLUS за сезон')}>
              <Shard size={44} />
              <b>+{totals.shards.toLocaleString(intlTag())}</b>
              <small>{t('осколков')}</small>
            </span>
          ) : null}
          <span className="pc-gift boost" title={t('Осколки бесплатной строки подписчику ×1,5')}>
            <span className="pc-boost">×1,5</span>
            <small>{t('к осколкам')}</small>
          </span>
        </div>

        <button
          className="btn lg primary pc-go"
          disabled={!price || busy === 'plus'}
          data-track={waiting ? 'plus_open_payment' : 'plus_subscribe'}
          onClick={() => void useDaily.getState().startPlus()}
        >
          {waiting ? t('Открыть оплату') : t('Оформить')}
        </button>
        {waiting ? (
          <span className="pc-wait">
            <Icon id="i-clock" />
            {t('Ждём оплату в браузере')}
          </span>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
