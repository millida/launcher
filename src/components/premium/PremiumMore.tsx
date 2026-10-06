import { Icon } from '../Icon'
import { priceLabel, type PremiumPack } from '../../lib/premium'
import { useLobby } from '../../state/lobbyMode'

/*
 * «Другие популярные премиум-сборки» внизу премиум-страницы (владелец 06.10.2026):
 * самые продаваемые — порядок по выручке из отчёта продаж на 06.10.2026. У всех,
 * кроме Arcania (своя, изначально русская), подчёркиваем «Полностью на русском» —
 * это главное, за что платят за чужую сборку.
 */

const BEST_SELLERS: RegExp[] = [
  /^arcania/i,
  /homestead/i,
  /deceasedcraft/i,
  /nightfallcraft/i,
  /prominence/i,
  /dread/i,
  /create chronicles/i,
  /linggango/i,
]

const rank = (p: PremiumPack) => {
  const i = BEST_SELLERS.findIndex((rx) => rx.test(p.title) || rx.test(p.slug || ''))
  return i < 0 ? BEST_SELLERS.length : i
}

export function PremiumMore({ current }: { current: string }) {
  const all = useLobby((s) => s.premium)
  const list = all
    .filter((p) => p.slug && p.slug !== current && p.coverUrl)
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || (b.p.downloads || 0) - (a.p.downloads || 0) || a.i - b.i)
    .slice(0, 3)
    .map((x) => x.p)
  if (!list.length) return null
  return (
    <section className="ppx-more" aria-label="Другие премиум-сборки">
      <h2 className="ppx-more-h">
        <Icon id="i-crown" /> Ещё популярные премиум-сборки
      </h2>
      <div className="ppx-more-row">
        {list.map((p) => {
          const own = /^arcania/i.test(p.slug || '') || /^arcania/i.test(p.title)
          const price = priceLabel(p)
          return (
            <button
              key={p.id}
              type="button"
              className="ppx-more-card"
              data-track="premium_more"
              data-id={p.slug || p.id}
              onClick={() => {
                useLobby.setState({ hubTarget: { pack: p.slug! } })
                requestAnimationFrame(() => document.querySelector('.content')?.scrollTo({ top: 0 }))
              }}
            >
              <span className="ppx-more-art">
                <img src={p.coverUrl!} alt="" loading="lazy" draggable={false} />
                {own ? null : (
                  <span className="ppx-more-ru">
                    <Icon id="i-check" /> Полностью на русском
                  </span>
                )}
              </span>
              <span className="ppx-more-body">
                <b>{p.title}</b>
                <small>{own ? 'Своя сборка студии' : 'Перевод, настройка и запуск в 1 клик'}</small>
                {price ? <em>{price}</em> : null}
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
