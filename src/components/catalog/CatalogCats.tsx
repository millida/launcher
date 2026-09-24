import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { SITE_SECTIONS, loadSections, materials } from './site'
import type { SiteSection, SiteSectionStat } from './site'

/*
 * «Категории» — главная каталога millida.net (/katalog): плитки разделов со
 * сценой-обложкой в правом нижнем углу, названием со стрелкой и числом
 * материалов. Обложки — те же файлы, что на сайте (`/catalog-art/<раздел>.png`).
 * В лаунчере разделов шесть — то, что ставится в игру; серверное живёт в
 * «Хостинге». «Моды» и «Сборки» — крупные, как «Моды» на сайте.
 */
export function CatalogCats({ onOpen }: { onOpen: (s: SiteSection) => void }) {
  const [stats, setStats] = useState<SiteSectionStat[] | null>(null)
  useEffect(() => {
    let alive = true
    void loadSections()
      .then((l) => alive && setStats(l))
      .catch(() => alive && setStats([]))
    return () => {
      alive = false
    }
  }, [])
  return (
    <div className="mr-cats" data-section="catalog_cats">
      {SITE_SECTIONS.map((s) => {
        const n = stats ? (stats.find((x) => x.section === s.slug)?.items ?? 0) : undefined
        // Карт в каталоге сайта пока нет («Наполняется»), в лаунчере они из
        // CurseForge — пустой счётчик у них не пишем.
        const note = n === undefined ? null : n > 0 ? materials(n) : s.kind === 'world' ? '' : 'Наполняется'
        return (
          <button key={s.slug} className={'card mr-cat-tile is-' + s.slug} data-sound="nav" data-track={'cat_' + s.slug} onClick={() => onOpen(s)}>
            <span className="mr-cat-head">
              <b>{s.title}</b>
              <Icon id="i-arrow-r" />
            </span>
            {note === null ? <span className="skel skel-line mr-cat-skel"></span> : note ? <span className="mr-cat-count">{note}</span> : null}
            <img
              className="mr-cat-art"
              src={`/catalog-art/${s.slug}.png`}
              srcSet={`/catalog-art/${s.slug}.png 1x, /catalog-art/${s.slug}@2x.png 2x`}
              alt=""
              draggable={false}
              loading="lazy"
            />
          </button>
        )
      })}
    </div>
  )
}
