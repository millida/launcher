import { Icon } from '../Icon'
import { fmt } from '../../lib/format'
import { packFacts, priceLabel, type PremiumPack, type PremiumPlan, type PremiumSubscription } from '../../lib/premium'
import { hasAccess } from './PremiumBuy'

interface Props {
  pack: PremiumPack
  plan?: PremiumPlan | null
  sub?: PremiumSubscription | null
  active?: boolean
  onOpen: () => void
}

/// Карточка ленты: арт, бейдж подписки, название, строка фактов и цена.
export function PremiumCard({ pack, plan, sub, active, onOpen }: Props) {
  const facts = packFacts(pack)
  const price = hasAccess(pack, sub) ? 'Открыто' : priceLabel(pack, plan)
  return (
    <button className={'pm-card' + (active ? ' is-active' : '')} onClick={onOpen} data-sound="open">
      <span className="pm-card-art">
        {pack.coverUrl ? (
          <img src={pack.coverUrl} alt="" draggable={false} />
        ) : (
          <span className="pm-art-none">
            <Icon id="i-crown" />
          </span>
        )}
        {pack.inSubscription || pack.source === 'catalog' ? (
          <span className="pm-badge sm">
            <Icon id="i-crown" /> {pack.inSubscription ? 'Подписка' : 'Платная'}
          </span>
        ) : null}
        <span className="pm-card-name">{pack.title}</span>
      </span>
      <span className="pm-card-foot">
        <span className="pm-card-facts">{facts}</span>
        {price ? (
          <b>{price}</b>
        ) : typeof pack.downloads === 'number' && pack.downloads > 0 ? (
          <b className="pm-dl">
            <Icon id="i-download" />
            {fmt(pack.downloads)}
          </b>
        ) : null}
      </span>
    </button>
  )
}
