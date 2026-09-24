import type { Rules } from '../../lib/rubies'
import { bpOf, pctOfBp } from '../daily/chestDrops'
import { RARITY_TONE } from './rarity'

/**
 * Шансы сундуков — до того, как сундук открыт, а не после.
 *
 * Требование сторов Apple и Google и готовящегося закона о лутбоксах в РФ,
 * и ровно так же делает Fortnite (docs/research-2026-09-22). Данные только
 * с сервера: /rubies/rules. Не отдал — блок не рисуется, выдуманных чисел нет.
 */
export function Odds({ rules }: { rules: Rules | null }) {
  const tiers = rules?.chests.items ?? []
  if (!tiers.length) return null
  return (
    <div className="sh-odds">
      {tiers.map((tier) => {
        const shown = tier.chances.filter((c) => c.permille > 0)
        return (
          <div key={tier.tier}>
            <div className="sh-odd">
              <b>{tier.title}</b>
              <span className="sh-bar">
                {shown.map((chance) => (
                  <i
                    key={chance.rarity}
                    style={{ width: bpOf(chance) / 100 + '%', background: RARITY_TONE[chance.rarity] }}
                  />
                ))}
              </span>
            </div>
            <div className="sh-legend">
              {shown.map((chance) => (
                <span key={chance.rarity}>
                  <i style={{ background: RARITY_TONE[chance.rarity] }} />
                  {chance.title}
                  <em>{pctOfBp(bpOf(chance))}</em>
                </span>
              ))}
            </div>
          </div>
        )
      })}
      {rules?.chests.pityAfter ? (
        <p className="faint-note">
          {'Эпическая и выше — минимум раз в ' + rules.chests.pityAfter + ' сундуков. Сундуки не продаются.'}
        </p>
      ) : null}
    </div>
  )
}
