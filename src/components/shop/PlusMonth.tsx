import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { RARITY_NAMES, rubles, type ItemRef, type PlusEconomy } from '../../lib/rubies'
import { ChestArt } from '../daily/ChestArt'
import { PLUS_PASS } from '../daily/chestDrops'
import { gridCols, ItemArt, toneStyle } from './parts'

const CHEST_WORD = { LEGEND: 'легендарный сундук', EPIC: 'эпических сундуков', RARE: 'редких сундука' } as const

const until = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }) : ''

/**
 * PLUS = мощный пропуск (модель v3): рубины в клетках (до 2 100 за 30 дней),
 * верхние сундуки, фрагменты и 4 расцветки сезона навсегда. Аренды вещей и
 * рубинов при оплате нет. Цена у кнопки, отмена
 * названа прямо: скрытое автопродление — то, за что FTC взыскала с Epic 245 млн.
 */
export function PlusMonth({
  plus,
  busy,
  onSubscribe,
  onManage,
}: {
  plus: PlusEconomy | null
  busy: string
  onSubscribe: () => void
  onManage: () => void
  onClaim?: () => void
  onMigrate?: () => void
}) {
  if (!plus) return null
  const active = plus.active
  const tiers = (['LEGEND', 'EPIC', 'RARE'] as const).filter((t) => (PLUS_PASS.chests[t] || 0) > 0)
  return (
    <div className="card sh-block sh-plus2" data-section="plus">
      <div className="sh-head">
        <h2 className="sh-plus2-title">
          <Icon id="i-crown" />
          PLUS
        </h2>
        <span className="sh-note">
          {active ? (plus.canceled ? 'Продления не будет · до ' : 'Активна до ') + until(plus.paidUntil) : 'Отмена в любой день'}
        </span>
        {active ? (
          <button className="btn sm secondary" data-track="plus_manage" onClick={onManage}>
            Отменить
          </button>
        ) : (
          <button className="btn md primary sh-plus2-cta" disabled={busy === 'plus'} data-track="plus_subscribe" onClick={onSubscribe}>
            {plus.priceKopecks ? rubles(plus.priceKopecks) + ' в месяц' : 'Оформить'}
          </button>
        )}
      </div>
      <div className="sh-grid is-fit" style={gridCols(tiers.length + 2)}>
        <div className="sh-card sh-perk-card">
          <span className="sh-perk-art">
            <Ruby size={72} />
          </span>
          <b className="sh-perk-n">до {PLUS_PASS.rubiesCap.toLocaleString('ru-RU')}</b>
          <span className="sh-note">рубинов за 30 дней</span>
        </div>
        {tiers.map((tier) => (
          <div key={tier} className={'sh-card sh-perk-card tier-' + tier.toLowerCase()}>
            <span className="sh-perk-art">
              <ChestArt ready={false} tier={tier} size={72} />
            </span>
            <b className="sh-perk-n">×{PLUS_PASS.chests[tier]}</b>
            <span className="sh-note">{CHEST_WORD[tier]}</span>
          </div>
        ))}
        <div className="sh-card sh-perk-card">
          <span className="sh-perk-art">
            <Icon id="i-gift" style={{ width: 64, height: 64 }} />
          </span>
          <b className="sh-perk-n">×{PLUS_PASS.items}</b>
          <span className="sh-note">расцветки навсегда</span>
        </div>
      </div>
    </div>
  )
}

/** Окно выбора вещей старого набора PLUS (бывшим подписчикам: 10 + 1 за каждый оплаченный месяц). */
export function MigrationModal({
  pool,
  left,
  busy,
  onPick,
  onClose,
}: {
  pool: ItemRef[]
  left: number
  busy: boolean
  onPick: (codes: string[]) => void
  onClose: () => void
}) {
  const [chosen, setChosen] = useState<string[]>([])
  const toggle = (code: string) =>
    setChosen((was) => (was.includes(code) ? was.filter((c) => c !== code) : was.length < left ? [...was, code] : was))
  return createPortal(
    <div className="sh-modal-bg" onClick={onClose}>
      <div className="modal sh-mig-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Вещи старого набора">
        <div className="sh-head">
          <h2>
            Выбрано {chosen.length} из {left}
          </h2>
          <button className="btn sm ghost" aria-label="Закрыть" data-track="close" onClick={onClose}>
            <Icon id="i-x" />
          </button>
        </div>
        <div className="sh-mig-grid">
          {pool.map((it) => {
            const on = chosen.includes(it.code)
            return (
              <button
                key={it.code}
                className={'sh-pick' + (on ? ' on' : '')}
                style={toneStyle(it)}
                aria-pressed={on}
                data-track="plus_migrate_pick"
                data-kind="item"
                data-id={it.code}
                disabled={!on && chosen.length >= left}
                onClick={() => toggle(it.code)}
              >
                <ItemArt item={it} size="sm" />
                <b className="sh-card-name">{it.name}</b>
                <span className="sh-card-meta">
                  <i>{RARITY_NAMES[it.rarity]}</i>
                </span>
                <span className="sh-pick-mark">
                  <Icon id="i-check" />
                </span>
              </button>
            )
          })}
        </div>
        <div className="sh-pick-foot">
          <button className="btn md primary" disabled={!chosen.length || busy} data-track="plus_migrate_confirm" onClick={() => onPick(chosen)}>
            Забрать {chosen.length || ''}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
