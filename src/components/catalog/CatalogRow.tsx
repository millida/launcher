import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { fmt } from '../../lib/format'
import { mirrorAsset } from '../../lib/api'

/*
 * Строка Millida Каталога. Одна на весь лаунчер: и клиентский каталог, и
 * каталог хостинга показывают вещь одинаково — обложка, название, автор, одна
 * строка описания, число скачиваний и ОДНА главная кнопка. Всё остальное
 * (категории, версии, источник) живёт в карточке и в фильтрах, иначе строка
 * превращается в три строки текста и перестаёт читаться.
 */
export interface CatalogAction {
  label: string
  /** Уже стоит: кнопка остаётся на месте, но перестаёт быть главной. */
  done?: boolean
  disabled?: boolean
  onClick: () => void
}

const DONE_STYLE = { background: 'var(--m-accent-soft)', color: 'var(--m-accent)' }

export function CatalogRow({
  icon,
  fallbackIcon = 'i-box2',
  title,
  author,
  desc,
  downloads,
  downloadsLabel,
  action,
  aside,
  onOpen,
  attrs,
  buttonClass,
  buttonAttrs,
}: {
  icon?: string | null
  fallbackIcon?: string
  title: string
  author?: string
  desc?: string
  downloads?: number
  /** Что именно считает число: «скачиваний» у мода, «установок» у сборки FTB. */
  downloadsLabel?: string
  action?: CatalogAction
  /** Плашка статуса или второстепенная кнопка справа от главной. */
  aside?: ReactNode
  onOpen?: (e: React.MouseEvent<HTMLDivElement>) => void
  attrs?: Record<string, string | undefined>
  buttonClass?: string
  buttonAttrs?: Record<string, string | number | undefined>
}) {
  const word = downloadsLabel || 'скачиваний'
  return (
    <div className={'mod-row' + (onOpen ? ' cat2-open' : '')} onClick={onOpen} {...attrs}>
      <span className="mod-icon">
        {icon ? (
          <img src={mirrorAsset(icon)} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />
        ) : (
          <Icon id={fallbackIcon} />
        )}
      </span>
      <span className="mod-body">
        <span className="mod-name">
          <b>{title}</b>
          {author ? <span>от {author}</span> : null}
        </span>
        {desc ? <span className="mod-desc">{desc}</span> : null}
      </span>
      {downloads ? (
        <span className="cat-dl" aria-label={fmt(downloads) + ' ' + word}>
          <Icon id="i-download" />
          <b>{fmt(downloads)}</b>
        </span>
      ) : null}
      {aside}
      {action ? (
        <button
          className={'btn sm inst ' + (action.done ? 'secondary done' : 'primary') + (buttonClass ? ' ' + buttonClass : '')}
          style={action.done ? DONE_STYLE : undefined}
          disabled={action.disabled}
          onClick={action.onClick}
          {...buttonAttrs}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

/** Строки-заглушки на время запроса — вместо пустоты и слова «Загружаем…». */
export function CatalogSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="mod-row cat-skel" aria-hidden="true">
          <span className="skel cat-skel-icon"></span>
          <span className="mod-body">
            <span className="skel skel-line" style={{ width: 180 + ((i * 47) % 120) + 'px' }}></span>
            <span className="skel skel-line" style={{ width: '70%', marginTop: '10px', height: '10px' }}></span>
          </span>
          <span className="skel cat-skel-btn"></span>
        </div>
      ))}
    </>
  )
}
