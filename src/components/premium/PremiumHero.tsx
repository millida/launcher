import { Icon } from '../Icon'
import { BuyButton, PriceLine } from './PremiumBuy'
import { packFacts, type PremiumPack, type PremiumPlan, type PremiumSubscription } from '../../lib/premium'

interface Props {
  pack: PremiumPack
  plan?: PremiumPlan | null
  sub?: PremiumSubscription | null
  /// На витрине герой уводит в сборку; на самой странице кнопки «Подробнее» нет.
  onOpen?: () => void
}

/// Герой витрины: арт, бейдж подписки рядом с названием, одна строка фактов,
/// главная кнопка и цена. Раскладка — docs/research-2026-09-22/ui-refs.md §3.4.
export function PremiumHero({ pack, plan, sub, onOpen }: Props) {
  const facts = packFacts(pack)
  return (
    <div className="pm-hero">
      {pack.coverUrl ? (
        <img className="pm-hero-art" src={pack.coverUrl} alt="" draggable={false} />
      ) : (
        <div className="pm-hero-art pm-art-none">
          <Icon id="i-crown" />
        </div>
      )}
      <div className="pm-hero-plate">
        <div className="pm-row">
          <h2>{pack.title}</h2>
          {pack.inSubscription ? (
            <span className="pm-badge">
              <Icon id="i-crown" /> По подписке
            </span>
          ) : pack.source === 'catalog' ? (
            <span className="pm-badge">
              <Icon id="i-crown" /> Платная
            </span>
          ) : null}
          {pack.ageRating ? <span className="pm-age">{pack.ageRating}</span> : null}
        </div>
        {pack.tagline || facts ? <p className="pm-line">{pack.tagline || facts}</p> : null}
        <div className="pm-actions">
          <BuyButton pack={pack} plan={plan} sub={sub} />
          {onOpen ? (
            <button className="btn secondary" onClick={onOpen}>
              Подробнее
            </button>
          ) : null}
          <PriceLine pack={pack} plan={plan} sub={sub} />
        </div>
      </div>
    </div>
  )
}
