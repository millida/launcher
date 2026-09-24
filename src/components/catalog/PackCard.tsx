import { Icon } from '../Icon'
import { fmt } from '../../lib/format'
import { priceLabel } from '../../lib/premium'
import type { HubPack } from '../playhub/data'

/*
 * Плитка готовой сборки в разделе «Сборки» каталога Millida: та же форма, что
 * у плитки мода (обложка 16:9, название, строка фактов), но одно действие —
 * страница сборки, где «Играть» и сервер сборки. Платная — с ценой на обложке,
 * без ярлыков «платные / сливы» (владелец 24.09.2026).
 */
export function PackCard({ p, onOpen }: { p: HubPack; onOpen: () => void }) {
  const price = priceLabel(p)
  const facts = [p.loader, p.mcVersion].filter(Boolean).join(' · ')
  return (
    <article className="card cat3-card" onClick={onOpen}>
      <div className={'cat3-art' + (p.coverUrl ? '' : ' is-icon')}>
        {p.coverUrl ? (
          <img src={p.coverUrl} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />
        ) : (
          <Icon id="i-box2" />
        )}
        {price ? <span className="cat3-price">{price}</span> : null}
      </div>
      <div className="cat3-body">
        <b>{p.title}</b>
        <span className="cat3-line">
          {facts ? <span>{facts}</span> : null}
          {p.downloads ? (
            <span className="cat3-dl">
              <Icon id="i-download" />
              {fmt(p.downloads)}
            </span>
          ) : null}
        </span>
      </div>
      <div className="cat3-acts">
        <button
          className="btn sm primary"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
        >
          Открыть
        </button>
      </div>
    </article>
  )
}
