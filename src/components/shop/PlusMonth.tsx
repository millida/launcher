import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { rubles, type PlusEconomy } from '../../lib/rubies'
import { ChestArt } from '../daily/ChestArt'
import { PLUS_PASS } from '../daily/chestDrops'
import { gridCols } from './parts'

const CHEST_WORD = { LEGEND: 'легендарный сундук', EPIC: 'эпических сундуков', RARE: 'редких сундука' } as const

const until = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }) : ''

/**
 * PLUS is a paid pass: rubies in its cells (up to 2 100 per 30 days), top-tier
 * chests and fragments. It grants no items. Cancelling lives on millida.net, so
 * an active subscription has no button here.
 */
export function PlusMonth({ plus, busy, onSubscribe }: { plus: PlusEconomy | null; busy: string; onSubscribe: () => void }) {
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
        {active ? null : (
          <button className="btn md primary sh-plus2-cta" disabled={busy === 'plus'} data-track="plus_subscribe" onClick={onSubscribe}>
            {plus.priceKopecks ? rubles(plus.priceKopecks) + ' в месяц' : 'Оформить'}
          </button>
        )}
      </div>
      <div className="sh-grid is-fit" style={gridCols(tiers.length + 1)}>
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
      </div>
    </div>
  )
}
