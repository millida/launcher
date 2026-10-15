import { useMemo, useState } from 'react'
import { CatalogNotice } from './CatalogShell'
import { SiteGalleryCard } from './SiteRow'
import { sectionBySlug } from './site'
import { useCatalogStars } from '../../state/catalogStars'

export function FavoritesPane({ onOpenPack, onBrowse }: { onOpenPack?: (slug: string) => boolean | void; onBrowse: () => void }) {
  const items = useCatalogStars((s) => s.items)
  const [only, setOnly] = useState<string | null>(null)
  const groups = useMemo(() => {
    const count = new Map<string, number>()
    for (const e of items) count.set(e.section, (count.get(e.section) || 0) + 1)
    return [...count].map(([slug, n]) => ({ slug, n, title: sectionBySlug(slug).title }))
  }, [items])
  const active = only && groups.some((g) => g.slug === only) ? only : null
  const shown = active ? items.filter((e) => e.section === active) : items
  if (!items.length)
    return <CatalogNotice note={{ icon: 'i-star', title: 'В избранном пусто', action: { label: 'Открыть моды', primary: true, onClick: onBrowse } }} />
  return (
    <div className="mr-main cat-favorites">
      <header className="mr-head">
        <h1 className="mr-h1">
          Избранное
          <span className="mr-h1-n">{items.length}</span>
        </h1>
      </header>
      {groups.length > 1 ? (
        <nav className="sk-chips" aria-label="Разделы избранного">
          <button type="button" className={'sk-chip' + (!active ? ' on' : '')} data-track="star_tab_all" onClick={() => setOnly(null)}>
            Все
          </button>
          {groups.map((g) => (
            <button key={g.slug} type="button" className={'sk-chip' + (active === g.slug ? ' on' : '')} data-track="star_tab_section" data-id={g.slug} onClick={() => setOnly(g.slug)}>
              {g.title} <span className="mr-star-chip-n">{g.n}</span>
            </button>
          ))}
        </nav>
      ) : null}
      <div className="mr-galgrid">
        {shown.map((e, i) => (
          <SiteGalleryCard key={e.section + '/' + e.card.slug} card={e.card} sec={sectionBySlug(e.section)} list="favorites" pos={i} onOpenPack={onOpenPack} />
        ))}
      </div>
    </div>
  )
}
