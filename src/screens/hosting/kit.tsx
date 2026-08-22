import { useEffect, useState } from 'react'
import type React from 'react'
import { Icon } from '../../components/Icon'
import { uiConfirm } from '../../state/confirm'

const PAID_SUMMARY =
  'Любой платный тариф открывает всё сразу: свои файлы и SFTP, своё ядро и сборку архивом, базу данных, ' +
  'дополнительные порты, сеть серверов, доступ тех-админу и защиту от атак. Тарифы отличаются только объёмом памяти. ' +
  'Бесплатно и без тарифа: моды, плагины и готовые сборки ставятся в один клик во вкладке «Ядро и сборки». ' +
  'Их конфиги правятся и на бесплатном.'

export async function paidLock(feature: string, onTariff: () => void) {
  const ok = await uiConfirm(PAID_SUMMARY, {
    title: feature + ' — на платном тарифе',
    confirmLabel: 'Перейти на платный тариф',
    cancelLabel: 'Закрыть',
    danger: false,
  })
  if (ok) onTariff()
}

export function LockBtn({
  label,
  feature,
  icon,
  title,
  onTariff,
}: {
  label?: string
  feature: string
  icon?: string
  title?: string
  onTariff: () => void
}) {
  return (
    <button
      className={'btn sm ' + (label ? 'secondary' : 'ghost')}
      title={title || feature + ' — на платном тарифе'}
      onClick={() => void paidLock(feature, onTariff)}
    >
      <Icon id={icon || 'i-lock'} /> {label}
    </button>
  )
}

export function Toggle({ on, busy, onChange }: { on: boolean; busy?: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className={'tgl' + (on ? ' on' : '') + (busy ? ' busy' : '')} onClick={() => !busy && onChange(!on)}></span>
  )
}

export function Seg({
  value,
  options,
  busy,
  onPick,
}: {
  value: string
  options: [string, string][]
  busy?: boolean
  onPick: (v: string) => void
}) {
  return (
    <div className="segs" style={{ width: 'auto' }}>
      {options.map(([v, label]) => (
        <button
          key={v}
          className={'seg' + (value === v ? ' on' : '')}
          disabled={busy}
          style={{ height: '30px', fontSize: '12px' }}
          onClick={() => onPick(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export function Row({ k, sub, children }: { k: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <span className="lab">
        {k}
        {sub ? <small>{sub}</small> : null}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>{children}</div>
    </div>
  )
}

export function Cap({ children, first }: { children: React.ReactNode; first?: boolean }) {
  return <div className="cap" style={first ? undefined : { marginTop: '14px' }}>{children}</div>
}

export function NumField({
  value,
  min,
  max,
  busy,
  width,
  onSave,
}: {
  value: number
  min: number
  max: number
  busy?: boolean
  width?: string
  onSave: (v: number) => void
}) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  const commit = () => {
    let n = parseInt(v, 10)
    if (isNaN(n)) n = value
    n = Math.max(min, Math.min(max, n))
    if (n !== value) onSave(n)
    else setV(String(value))
  }
  return (
    <div className="input sm" style={{ width: width || '110px' }}>
      <input
        type="number"
        value={v}
        min={min}
        max={max}
        disabled={busy}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )
}

export function TextField({
  value,
  placeholder,
  busy,
  width,
  onSave,
}: {
  value: string
  placeholder?: string
  busy?: boolean
  width?: string
  onSave: (v: string) => void
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  const commit = () => {
    if (v !== value) onSave(v)
  }
  return (
    <div className="input sm" style={{ width: width || '220px' }}>
      <input
        value={v}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )
}

export function ApplyField({
  value,
  placeholder,
  label,
  busy,
  width,
  onApply,
}: {
  value: string
  placeholder?: string
  label: string
  busy?: boolean
  width?: string
  onApply: (v: string) => void
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <>
      <div className="input sm" style={{ width: width || '220px' }}>
        <input
          value={v}
          placeholder={placeholder}
          disabled={busy}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && v.trim() && onApply(v.trim())}
        />
      </div>
      <button className="btn sm secondary" disabled={busy || !v.trim() || v === value} onClick={() => onApply(v.trim())}>
        {label}
      </button>
    </>
  )
}

export function Empty({ icon, text }: { icon?: string; text: string }) {
  return (
    <div className="host-empty">
      {icon ? <Icon id={icon} /> : null}
      <span>{text}</span>
    </div>
  )
}

// Канон 3.9: загрузка — скелетон формы контента, а не «Загружаем…» текстом.
// `text` оставлен в типе для совместимости вызовов, но не рендерится.
export function Loading({ rows = 3 }: { text?: string; rows?: number }) {
  return (
    <div className="skel-rows" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skel-row" key={i}>
          <span className="skel" style={{ width: '28px', height: '28px', borderRadius: '8px' }} />
          <span className="skel skel-line" style={{ width: i % 2 ? '38%' : '52%' }} />
          <span className="skel skel-line" style={{ width: '72px', marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}

export const gbLabel = (mb: number) => (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1).replace('.', ',')

export const sizeLabel = (bytes: number) => {
  if (bytes < 1024) return bytes + ' Б'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' КБ'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' МБ'
  return (bytes / 1024 / 1024 / 1024).toFixed(2).replace('.', ',') + ' ГБ'
}

export const dtLabel = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const dateLabel = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export const downloadsLabel = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.', ',') + ' млн'
  if (n >= 1000) return Math.round(n / 1000) + ' тыс.'
  return String(n)
}
