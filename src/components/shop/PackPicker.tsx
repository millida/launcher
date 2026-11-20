import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import type { ShopDay } from '../../lib/rubies'
import { rubyPackPrice, useMoney } from '../../lib/useMoney'
import { track } from '../../lib/telemetry'
import { intlTag, useT } from '../../i18n'
import { PackArt, PctBadge } from './Packs'
import { Timer } from './parts'
import { word } from './rarity'
import {
  barDismissed,
  dismissBar,
  leftAfter,
  nextUnaffordable,
  openPackNeed,
  pickOptions,
  recommendPack,
  shortfallItem,
  usePackNeed,
  SHORTFALL_MAX,
  type PickOption,
  type PackNeed,
} from './packNeed'

const nf = (n: number) => n.toLocaleString(intlTag())

/**
 * Окно выбора пакета при любой нехватке (полоска, «Пополнить» в «Хочу»,
 * карточка вещи). Рекомендуемый — самый дешёвый, которого хватает на цель,
 * подсвечен и первым; под ним «После покупки останется N» и, если остатка не
 * хватит на следующую вещь, «до „X" не хватит M». Подтверждение покупки — в
 * общем окне покупки (ShopKit).
 */
export function PackPicker({ day, busy, onBuy }: { day: ShopDay; busy: string; onBuy: (option: PickOption, need: PackNeed, recommended: boolean) => void }) {
  const t = useT()
  useMoney()
  const need = usePackNeed((s) => s.need)
  const close = usePackNeed((s) => s.close)

  useEffect(() => {
    if (need) track('pack_picker_open', { from: need.from, target: need.target })
  }, [need])

  useEffect(() => {
    if (!need) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [need, close])

  if (!need) return null
  const held = day.balance
  const options = pickOptions(day)
  const rec = recommendPack(options, held, need.target)
  const rest = options.filter((o) => o.code !== rec?.code).sort((a, b) => a.kopecks - b.kopecks)
  const ordered = rec ? [rec, ...rest] : rest
  const title = need.title ?? (need.item ? t('на «{name}»', { name: need.item.card.item.name }) : t('до цели'))

  const pick = (o: PickOption) => {
    onBuy(o, need, o.code === rec?.code)
    close()
  }

  return createPortal(
    <div className="modal-bg open vis pp-bg" onClick={close}>
      <div className="modal pp" role="dialog" aria-label={t('Выбор пакета')} onClick={(e) => e.stopPropagation()}>
        <div className="pp-head">
          <b className="pp-title">{t('Сколько рубинов взять')}</b>
          <span className="pp-sub">
            {t('Нужно')} <Ruby size={15} /> <b>{nf(need.target)}</b> {title}
          </span>
          <button className="pp-x" aria-label={t('Закрыть')} data-track="pack_picker_close" onClick={close}>
            <Icon id="i-close" />
          </button>
        </div>
        <div className="pp-list">
          {ordered.map((o) => {
            const isRec = o.code === rec?.code
            const left = leftAfter(held, o, need.target)
            const next = isRec && left >= 0 ? nextUnaffordable(day, left, need.item?.card.item.code) : null
            return (
              <button
                key={o.code}
                className={'pp-opt' + (isRec ? ' is-rec' : '')}
                disabled={busy === o.code}
                data-track={isRec ? 'pack_pick_rec' : 'pack_pick_alt'}
                data-kind="ruby_pack"
                data-id={o.code}
                onClick={() => pick(o)}
              >
                {isRec ? <span className="pp-rec-tag">{t('Советуем')}</span> : null}
                <span className="pp-opt-art">
                  <PackArt src={o.art} />
                  <PctBadge pct={o.badgePct ?? 0} />
                </span>
                <span className="pp-opt-mid">
                  <b className="pp-opt-n">
                    <Ruby size={18} />
                    {nf(o.rubies)}
                  </b>
                  {o.endsAt ? <Timer to={o.endsAt} /> : null}
                  {isRec ? (
                    <small className="pp-left">
                      {left >= 0 ? t('После покупки останется {n}', { n: nf(left) }) : t('Ещё не хватит {n} {word}', { n: nf(-left), word: word(-left) })}
                    </small>
                  ) : null}
                  {next ? <small className="pp-next">{t('до «{name}» не хватит {n}', { name: next.name, n: nf(next.price - left) })}</small> : null}
                </span>
                <span className="pp-opt-price">{rubyPackPrice(o.code, o.kopecks)}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * Полоска «не хватает» над витриной: баланс < цены нужной вещи, но не хватает
 * ≤ 400 рубинов. Не чаще раза в день на аккаунт; крестик скрывает до завтра.
 * Кнопка открывает окно выбора пакета с уже выбранной вещью.
 */
export function ShortfallBar({ day }: { day: ShopDay }) {
  const t = useT()
  const dayKey = day.day.refreshAt
  const [hidden, setHidden] = useState(() => barDismissed(dayKey))
  const target = shortfallItem(day)
  const miss = target ? target.card.price - day.balance : 0
  const show = !hidden && !!target && miss > 0 && miss <= SHORTFALL_MAX

  useEffect(() => {
    if (show && target) track('shortfall_shown', { item: target.card.item.code, miss, place: 'storefront' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, target?.card.item.code])

  if (!show || !target) return null
  return (
    <div className="sf-bar" data-section="shortfall">
      <span className="sf-text">
        {t('У тебя')} <Ruby size={16} /> <b>{nf(day.balance)}</b>
        <span className="sf-dot">·</span>
        {t('Не хватает {n} на «{name}»', { n: nf(miss), name: target.card.item.name })}
      </span>
      <span className="sf-acts">
        <button
          className="btn sm primary"
          data-track="shortfall_click"
          onClick={() => openPackNeed({ target: target.card.price, item: target, from: 'bar' })}
        >
          {t('Пополнить')}
        </button>
        <button
          className="sf-x"
          aria-label={t('Скрыть до завтра')}
          data-track="shortfall_hide"
          onClick={() => {
            dismissBar(dayKey)
            setHidden(true)
          }}
        >
          <Icon id="i-close" />
        </button>
      </span>
    </div>
  )
}
