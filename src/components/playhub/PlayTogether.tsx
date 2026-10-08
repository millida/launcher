import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { loadListing } from '../catalog/site'
import type { SiteCard, SiteSlug } from '../catalog/site'
import { dayIndex, hashStr, rng } from '../../lib/recsMix'
import { readSignals } from '../../lib/recsSignals'

/**
 * «Играть вдвоём» — тот же блок, что на millida.net/katalog (владелец
 * 30.09.2026, 15:06): сборки и карты с задачей «С другом» из разных тем —
 * приключения, хоррор, паркур, головоломки, мини-игры — по очереди, два ряда,
 * без повторов. Данные — листинг каталога Millida, как у сайта.
 */

interface Pick {
  section: 'modpacks' | 'maps'
  card: SiteCard
}

/** Подборки по очереди; замер 30.09.2026 — в каждой хватает на два ряда. */
const POOLS: { section: 'modpacks' | 'maps'; category: string; perPage: number }[] = [
  { section: 'modpacks', category: 'приключения', perPage: 24 },
  { section: 'maps', category: 'хоррор', perPage: 16 },
  { section: 'maps', category: 'паркур', perPage: 16 },
  { section: 'modpacks', category: 'хоррор', perPage: 16 },
  { section: 'maps', category: 'пазлы', perPage: 16 },
  { section: 'maps', category: 'мини-игры', perPage: 16 },
]
/** Два ряда по пять. */
const SHOWN = 10
/** Библиотека: два ряда по шесть — двойная «Свой сервер», девять карточек и «Ещё». */
const SHOWN_LEAD = 9
const ONEBLOCK = /one\s?-?block|ванблок/i

/**
 * Система как на сайте (`mixFriends`, владелец 30.09.2026, 21:04): порог
 * качества (скриншот; у сборок ещё от 500 скачиваний — карты StickyPiston
 * без счётчика источника, у них порог только по скриншоту), счёт — скачивания в логарифме и
 * свежесть с суточным шумом ±20 %, любимый раздел (карты или сборки по
 * журналу посещений и установок) встаёт в очереди первым, первая подборка
 * меняется по дням.
 */
export interface TogetherOpts {
  seed: number
  now?: number
  affinity?: readonly number[]
}

const MIN_DOWNLOADS = 500

export function togetherScore(c: SiteCard, now: number): number {
  const dl = Math.max(c.downloads || 0, c.sourceDownloads || 0)
  const upd = c.updatedAt ? Date.parse(c.updatedAt) : NaN
  const days = Number.isFinite(upd) ? (now - upd) / 864e5 : Infinity
  return Math.log10(1 + dl) + (days < 180 ? 0.6 : days < 540 ? 0.2 : 0)
}

/** По очереди из каждой подборки, без повторов, без оптимизации и чужих OneBlock. */
export function mixTogether(pools: Pick[][], n = SHOWN, opts?: TogetherOpts): Pick[] {
  const out: Pick[] = []
  const seen = new Set<string>()
  let order = pools
  if (opts) {
    const now = opts.now ?? Date.now()
    const rand = rng(opts.seed || 1)
    const ranked = pools.map((p) =>
      p
        .filter((r) => !!r.card.cover && (r.section === 'maps' || Math.max(r.card.downloads || 0, r.card.sourceDownloads || 0) >= MIN_DOWNLOADS))
        .map((r) => ({ r, s: togetherScore(r.card, now) * (0.8 + 0.4 * rand()) }))
        .sort((a, b) => b.s - a.s)
        .map((x) => x.r),
    )
    const start = ranked.length ? (opts.seed >>> 0) % ranked.length : 0
    const idx = ranked.map((_, i) => (i + start) % ranked.length)
    const w = (i: number) => opts.affinity?.[i] ?? 1
    idx.sort((a, b) => w(b) - w(a))
    order = idx.map((i) => ranked[i]!)
  }
  for (let i = 0; out.length < n && order.some((p) => i < p.length); i++)
    for (const list of order) {
      const r = list[i]
      if (!r) continue
      if (r.card.categories.includes('оптимизация') || ONEBLOCK.test(r.card.slug) || ONEBLOCK.test(r.card.title)) continue
      const key = r.section + '/' + r.card.slug
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
      if (out.length >= n) break
    }
  return out
}

const LOADER: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }

export function PlayTogether({ onPack, onMap, onItem, lead, onMore }: { onPack: (slug: string, title: string) => void; onMap: (title: string) => void; onItem?: (section: string, card: SiteCard) => void; /** Первая двойная клетка ряда — «Свой сервер» (хостинг). */ lead?: ReactNode; /** «Ещё» — весь каталог «С другом». */ onMore?: () => void }) {
  const [list, setList] = useState<Pick[] | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.all(
      POOLS.map((p) =>
        loadListing({ section: p.section as SiteSlug, category: p.category, use: 'friends', sort: 'popular', perPage: p.perPage })
          .then((l) => (l.items || []).map((card): Pick => ({ section: p.section, card })))
          .catch(() => [] as Pick[]),
      ),
    ).then((pools) => {
      if (!alive) return
      // Интерес к разделу — журнал посещений и установок этого компьютера.
      const sig = readSignals()
      const pull = (sec: string) => 1 + Math.log1p((sig.visits?.[sec] || 0) + 2 * (sig.installs?.[sec] || 0))
      setList(mixTogether(pools, lead ? SHOWN_LEAD : SHOWN, { seed: hashStr('together') ^ dayIndex(), affinity: POOLS.map((p) => pull(p.section)) }))
    })
    return () => {
      alive = false
    }
  }, [])

  if (list && !list.length) return null
  return (
    <div className="hub-grid pt-grid" data-section="play_together" data-src="hub_card">
      {lead}
      {list === null
        ? Array.from({ length: lead ? SHOWN_LEAD : SHOWN }, (_, i) => (
            <span key={i} className="ph-card skel-card" aria-hidden="true">
              <span className="ph-card-art skel"></span>
              <span className="ph-card-body">
                <span className="skel skel-line" style={{ width: '60%' }}></span>
                <span className="skel skel-line" style={{ width: '35%', height: 9 }}></span>
              </span>
            </span>
          ))
        : list.map((p, i) => {
            const loader = p.card.loaders.map((l) => LOADER[l.toLowerCase()]).find(Boolean)
            const meta = [loader, p.card.versions[0]].filter(Boolean).join(' · ')
            return (
              <button
                key={p.section + '/' + p.card.slug}
                className="ph-card"
                data-sound="open"
                data-kind={p.section === 'maps' ? 'map' : 'pack'}
                data-id={p.card.slug}
                data-pos={i}
                onClick={() => (onItem ? onItem(p.section, p.card) : p.section === 'maps' ? onMap(p.card.title) : onPack(p.card.slug, p.card.title))}
              >
                <span className="ph-card-art">
                  {p.card.cover || p.card.icon ? (
                    <img
                      src={(p.card.cover || p.card.icon)!}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      onError={(e) => {
                        e.currentTarget.style.visibility = 'hidden'
                      }}
                    />
                  ) : null}
                  <span className="ph-card-tag">{p.section === 'maps' ? 'Карта' : 'Сборка'}</span>
                </span>
                <span className="ph-card-body">
                  <b>{p.card.title}</b>
                  <span className="ph-card-meta">
                    {meta || (
                      <>
                        <Icon id="i-users" /> С другом
                      </>
                    )}
                  </span>
                </span>
              </button>
            )
          })}
      {onMore && list ? (
        <button className="ph-card fy-more" data-sound="nav" data-track="together_more" onClick={onMore}>
          <span className="fy-more-ic">
            <Icon id="i-chev-r" />
          </span>
          <b>Ещё</b>
          <span className="ph-card-meta">Всё «С другом»</span>
        </button>
      ) : null}
    </div>
  )
}
