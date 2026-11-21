import type { FragmentCard, ItemRef, Workshop } from '../../lib/rubies'
import { Head, Shard, toneStyle } from './parts'
import { Ruby } from '../Ruby'
import { ItemShot } from './Today'
import { FragBar } from './rarityUi'
import { fragmentTopUp } from '../daily/chestDrops'
import { intlTag, useT } from '../../i18n'

/**
 * «За осколки» (мастерская): вещи недели за осколки. Обмен даёт половину
 * фрагментов вещи, а не её целиком (17.11.2026: игрок отдал 200 осколков за
 * кигуруми и решил, что вещь не пришла). Поэтому карточка говорит об этом
 * сама, а начатая вещь показывает полосу и кнопку «Докупить» за рубины.
 */
export function ShardsSection({
  data,
  busy,
  onCraft,
  onTopUp,
  showBalance = true,
}: {
  data: Workshop
  busy: string
  onCraft: (w: { item: ItemRef; cost: number }) => void
  /** Дособрать начатую вещь за рубины. Без него кнопки «Докупить» нет. */
  onTopUp?: (f: FragmentCard) => void
  /** Счётчик в шапке блока — только там, где нет шапки магазина с осколками (гардероб). */
  showBalance?: boolean
}) {
  const t = useT()
  const items = data.workshop.items.filter((w) => !w.owned).slice(0, 6)
  if (!items.length) return null
  const started = new Map((data.fragments ?? []).map((f) => [f.item.code, f]))
  return (
    <section id="shop-shards" className="sv-sec" data-section="shards">
      <Head title={t('За осколки')}>
        {showBalance ? (
          <span className="sh-bal sd-bal">
            <Shard size={20} />
            <b>{data.shards.toLocaleString(intlTag())}</b>
          </span>
        ) : null}
      </Head>
      <div className="td-grid is-row">
        {items.map((w) => {
          const prog = started.get(w.item.code)
          const price = prog ? (prog.topUp ?? fragmentTopUp(w.item.rarity, prog.have)) : 0
          const topUp = prog && prog.have > 0 && prog.have < prog.need && onTopUp && price > 0 ? { ...prog, topUp: price } : null
          return (
            <div key={w.item.code} className="sh-card td-tile" style={toneStyle(w.item)} data-kind="craft" data-id={w.item.code}>
              <button className="sv-card-pick td-pick" aria-label={w.item.name} disabled={busy === w.item.code} data-track="craft_pick" onClick={() => onCraft(w)}>
                <ItemShot item={w.item} />
              </button>
              <b className="sv-card-name">{w.item.name}</b>
              {prog && prog.have > 0 ? (
                <span className="td-frag">
                  <FragBar have={prog.have} need={prog.need} rarity={w.item.rarity} />
                </span>
              ) : (
                <span className="sd-half">{t('½ фрагментов вещи')}</span>
              )}
              {topUp ? (
                <button
                  className="btn md primary sv-pbtn"
                  disabled={busy === w.item.code}
                  data-track="craft_topup"
                  onClick={() => onTopUp?.(topUp)}
                >
                  {t('Докупить')}
                  <Ruby size={16} />
                  {topUp.topUp.toLocaleString(intlTag())}
                </button>
              ) : (
                <button
                  className={'btn md ' + (w.cost > data.shards ? 'secondary' : 'primary') + ' sv-pbtn'}
                  disabled={busy === w.item.code}
                  data-track="craft"
                  onClick={() => onCraft(w)}
                >
                  <Shard size={16} />
                  {w.cost.toLocaleString(intlTag())}
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
