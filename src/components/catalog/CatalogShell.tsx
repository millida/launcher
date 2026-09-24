import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { CatalogSkeleton } from './CatalogRow'
import '../../styles/pixel/catalog2.css'

/*
 * Millida Каталог — один компонент на два места. В лаунчере он показывает
 * клиентские вещи (сборки, моды, ресурспаки, шейдеры, карты), в разделе
 * хостинга — серверные (ядра, сборки, плагины, моды, карты). Отличается только
 * набор разделов и то, что делает кнопка строки; форма, состояния и порядок
 * элементов общие, чтобы человек не учил два разных каталога.
 */
export interface CatalogTab {
  id: string
  label: string
  icon: string
}

export type CatalogStatus = 'ok' | 'loading' | 'empty' | 'error' | 'app'

/** Что показать вместо списка. Технический текст сюда не попадает — он в консоль. */
export interface CatalogNote {
  icon: string
  title: string
  action?: { label: string; primary?: boolean; icon?: string; onClick: () => void }
}

export function CatalogSearch({
  value,
  onChange,
  delay = 350,
  width,
}: {
  value: string
  onChange: (v: string, commit: boolean) => void
  delay?: number
  width?: number
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div className="input sm cat2-search" style={width ? { width: width + 'px' } : undefined}>
      <Icon id="i-search" />
      <input
        placeholder="Поиск"
        value={value}
        onChange={(e) => {
          const v = e.target.value
          onChange(v, false)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => onChange(v, true), delay)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          clearTimeout(timer.current)
          onChange((e.target as HTMLInputElement).value, true)
        }}
      />
    </div>
  )
}

export function CatalogTabs({
  tabs,
  tab,
  onPick,
  compact,
}: {
  tabs: CatalogTab[]
  tab: string
  onPick: (id: string) => void
  compact?: boolean
}) {
  return (
    <div className={'segs cat2-tabs' + (compact ? ' compact' : '')}>
      {tabs.map((t) => (
        <button key={t.id} className={'seg' + (tab === t.id ? ' on' : '')} onClick={() => onPick(t.id)}>
          <Icon id={t.icon} />
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function CatalogNotice({ note }: { note: CatalogNote }) {
  return (
    <div className="cat-empty">
      <span className="cat-empty-ic">
        <Icon id={note.icon} />
      </span>
      <b>{note.title}</b>
      {note.action ? (
        <button
          className={'btn md ' + (note.action.primary ? 'primary' : 'secondary')}
          data-track="notice_action"
          onClick={note.action.onClick}
        >
          {note.action.icon ? <Icon id={note.action.icon} /> : null}
          {note.action.label}
        </button>
      ) : null}
    </div>
  )
}

export function CatalogShell({
  title,
  tabs,
  tab,
  onTab,
  search,
  filters,
  meta,
  sort,
  head,
  note,
  loading,
  dim,
  compact,
  more,
  layout = 'list',
  skeleton,
  children,
}: {
  /** Заголовок экрана. В хостинге каталог живёт внутри карточки — заголовка нет. */
  title?: string
  tabs: CatalogTab[]
  tab: string
  onTab: (id: string) => void
  search?: { value: string; onChange: (v: string, commit: boolean) => void }
  /** Пилюли фильтров этого каталога. */
  filters?: ReactNode
  /** Число справа в ряду фильтров — только там, где это настоящий итог. */
  meta?: ReactNode
  /** Пилюля сортировки, прижата вправо. */
  sort?: ReactNode
  /** Всё, что стоит над разделами: чип сборки, полка «своё». */
  head?: ReactNode
  note?: CatalogNote | null
  loading?: boolean
  /** Старая выдача гаснет, пока едет новая. */
  dim?: boolean
  compact?: boolean
  more?: { onClick: () => void; busy?: boolean }
  /** Плитки с обложками или строки. Пустое состояние всегда во всю ширину. */
  layout?: 'list' | 'grid'
  /** Своя заглушка на время запроса — у плиток она плиточная. */
  skeleton?: ReactNode
  children?: ReactNode
}) {
  const body = note ? <CatalogNotice note={note} /> : loading ? skeleton || <CatalogSkeleton /> : children
  const wrap = layout === 'grid' && !note ? 'cat3-grid' : 'stack'

  return (
    <>
      {title ? (
        <div className="page-head">
          <h1>{title}</h1>
          {search ? (
            <div className="right">
              <CatalogSearch value={search.value} onChange={search.onChange} width={240} />
            </div>
          ) : null}
        </div>
      ) : null}

      {head}

      <div className="cat2-bar">
        <CatalogTabs tabs={tabs} tab={tab} onPick={onTab} compact={compact} />
        {!title && search ? <CatalogSearch value={search.value} onChange={search.onChange} /> : null}
      </div>

      {filters || meta || sort ? (
        <div className="mods-filters">
          {filters}
          <span className="spacer"></span>
          {meta ? <span className="cat-count">{meta}</span> : null}
          {sort}
        </div>
      ) : null}

      <div className={wrap + (dim ? ' cat-dim' : '')}>{body}</div>

      {more ? (
        <button
          className={'btn md secondary' + (more.busy ? ' cat-busy' : '')}
          style={{ width: '100%', marginTop: '12px' }}
          onClick={more.onClick}
          disabled={more.busy}
        >
          Показать ещё
        </button>
      ) : null}
    </>
  )
}
