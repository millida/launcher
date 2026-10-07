import type { ItemRef, Workshop } from '../../lib/rubies'
import { Head, Shard, toneStyle } from './parts'
import { ItemShot } from './Today'

/**
 * «За осколки» (мастерская): вещи недели за осколки — картинка, имя, кнопка
 * с ценой в осколках. Осколки зарабатываются игрой; сколько их — в шапке блока.
 */
export function ShardsSection({ data, busy, onCraft }: { data: Workshop; busy: string; onCraft: (w: { item: ItemRef; cost: number }) => void }) {
  const items = data.workshop.items.filter((w) => !w.owned).slice(0, 6)
  if (!items.length) return null
  return (
    <section id="shop-shards" className="sv-sec" data-section="shards">
      <Head title="За осколки">
        <span className="sh-bal sd-bal">
          <Shard size={20} />
          <b>{data.shards.toLocaleString('ru-RU')}</b>
        </span>
      </Head>
      <div className="td-grid is-row">
        {items.map((w) => (
          <div key={w.item.code} className="sh-card td-tile" style={toneStyle(w.item)} data-kind="craft" data-id={w.item.code}>
            <button className="sv-card-pick td-pick" aria-label={w.item.name} disabled={busy === w.item.code} data-track="craft_pick" onClick={() => onCraft(w)}>
              <ItemShot item={w.item} />
            </button>
            <b className="sv-card-name">{w.item.name}</b>
            <button
              className={'btn md ' + (w.cost > data.shards ? 'secondary' : 'primary') + ' sv-pbtn'}
              disabled={busy === w.item.code}
              data-track="craft"
              onClick={() => onCraft(w)}
            >
              <Shard size={16} />
              {w.cost.toLocaleString('ru-RU')}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
