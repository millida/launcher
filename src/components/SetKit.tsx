import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/// Кирпичики экрана настроек: строка «название · управление», плита-группа,
/// тумблер, сегменты и поиск по строкам. Вынесены отдельно,
/// чтобы вложенные блоки (облако, общее хранилище) рисовались той же строкой.

/* ---------- Поиск: строка сама решает, показываться ли ---------- */

export const Query = createContext('')

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е')

export function useMatch(text: string): boolean {
  const q = useContext(Query)
  if (!q) return true
  const hay = norm(text)
  return norm(q)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

/* ---------- Кирпичики экрана ---------- */

export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="s2-group">
      {title ? <div className="s2-cap">{title}</div> : null}
      <div className="s2-plate">{children}</div>
    </div>
  )
}

/// Строка настройки: название, одна строка пояснения (если без неё
/// непонятно), управление справа. `keys` — слова для поиска сверх названия.
export function Row({
  title,
  hint,
  keys = '',
  top,
  id,
  children,
}: {
  title: string
  hint?: ReactNode
  keys?: string
  top?: boolean
  id?: string
  children?: ReactNode
}) {
  const ok = useMatch(title + ' ' + keys + ' ' + (typeof hint === 'string' ? hint : ''))
  if (!ok) return null
  return (
    <div className={'s2-row' + (top ? ' top' : '')} id={id}>
      <span className="s2-lab">
        <b>{title}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
      <div className="s2-ctl">{children}</div>
    </div>
  )
}

/// Блок целиком (устройства, облако): показывается при поиске,
/// только если запрос попал в его слова.
export function Block({ keys, children }: { keys: string; children: ReactNode }) {
  return useMatch(keys) ? <>{children}</> : null
}

export function Toggle({
  on,
  onChange,
  id,
  busy,
  disabled,
  label,
}: {
  on: boolean
  onChange: () => void
  id?: string
  busy?: boolean
  disabled?: boolean
  label: string
}) {
  return (
    <span
      role="switch"
      aria-checked={on}
      aria-label={label}
      tabIndex={0}
      id={id}
      className={'tgl' + (on ? ' on' : '') + (busy ? ' busy' : '')}
      style={disabled ? { opacity: 0.45 } : undefined}
      onClick={(e) => {
        e.stopPropagation()
        onChange()
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange()
        }
      }}
    ></span>
  )
}

export function Segs<T extends string | number>({
  value,
  options,
  onPick,
}: {
  value: T
  options: [T, string][]
  onPick: (v: T) => void
}) {
  return (
    <div className="segs">
      {options.map(([v, label]) => (
        <button key={String(v)} data-nosound className={'seg' + (value === v ? ' on' : '')} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}

