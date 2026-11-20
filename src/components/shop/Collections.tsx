import { useEffect, useState } from 'react'
import { loadCosmeticCatalog, loadCosmeticOwned, type CosmeticItem } from '../../lib/gameProfile'
import { CardRail, catalogCards, type TodayActs } from './Today'
import { DayClock } from './SetsV2'
import { collectionMembers, loadCollections, type ShopCollection } from './collectionData'
import { useT } from '../../i18n'

const MIN_ITEMS = 3

export function CollectionsSection({ acts }: { acts: TodayActs }) {
  const t = useT()
  const [collections, setCollections] = useState<ShopCollection[]>([])
  const [catalog, setCatalog] = useState<CosmeticItem[]>([])
  const [owned, setOwned] = useState<ReadonlySet<string>>(new Set())
  useEffect(() => {
    let alive = true
    void Promise.all([loadCollections(), loadCosmeticCatalog()])
      .then(([list, cat]) => {
        if (!alive) return
        setCollections(list)
        setCatalog(cat.items)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (acts.busy || !collections.length) return
    let alive = true
    void loadCosmeticOwned()
      .then((r) => alive && setOwned(new Set(r.items)))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [acts.busy, collections.length])
  const shown = collections
    .map((c) => ({ c, cards: catalogCards(collectionMembers(c, catalog), owned) }))
    .filter((x) => x.cards.length >= MIN_ITEMS)
  if (!shown.length) return null
  return (
    <>
      {shown.map(({ c, cards }) => (
        <section key={c.id} id={'shop-coll-' + c.id} className="sv-sec" data-section="collection" data-id={c.id}>
          <div className="sh-head">
            <h2>{c.title}</h2>
            <span className="sh-tag">{t('Коллекция')}</span>
            {c.to ? <DayClock to={c.to} /> : null}
          </div>
          {c.description ? <p className="cl-sub">{c.description}</p> : null}
          <CardRail cards={cards} acts={acts} label={c.title} />
        </section>
      ))}
    </>
  )
}
