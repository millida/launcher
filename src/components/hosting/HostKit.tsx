import type React from 'react'
import { Icon } from '../Icon'
import { WALLET_URL, openExt } from '../../lib/api'
import { track } from '../../lib/telemetry'
import { useAccounts } from '../../state/accounts'

// Мелкие детали экрана хостинга, общие для списка и разделов.

/// Статус → подпись и тон бейджа. Закрашенная точка — живое, полая — нет.
export const HOST_ST: Record<string, [string, 'success' | 'warning' | 'danger' | 'neutral', boolean]> = {
  RUNNING: ['Работает', 'success', true],
  STARTING: ['Запускается', 'warning', true],
  QUEUED: ['В очереди', 'warning', true],
  INSTALLING: ['Устанавливается', 'warning', true],
  STOPPING: ['Останавливается', 'warning', true],
  STOPPED: ['Остановлен', 'neutral', false],
  SLEEPING: ['Спит', 'neutral', false],
  CRASHED: ['Упал', 'danger', false],
  SUSPENDED: ['Приостановлен', 'danger', false],
  ARCHIVED: ['В архиве', 'neutral', false],
}

const CORE_NAME: Record<string, string> = {
  paper: 'Paper',
  purpur: 'Purpur',
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  spigot: 'Spigot',
  velocity: 'Velocity',
  bungeecord: 'BungeeCord',
}

/// «Paper 1.21.4».
export const buildLabel = (s: { core?: string; version?: string }) =>
  [s.core ? CORE_NAME[s.core.toLowerCase()] || s.core : '', s.version || ''].filter(Boolean).join(' ')

export function StatusBadge({ status }: { status: string }) {
  const st = HOST_ST[status] || [status || '—', 'neutral', false]
  return (
    <span className={'hp-badge is-' + st[1]}>
      <span className={'hp-dot' + (st[2] ? '' : ' hollow')}></span>
      {st[0]}
    </span>
  )
}

/// Логотип сервера: своя иконка или блок Millida.
export function ServerIcon({ icon, size }: { icon?: string; size: number }) {
  const fallback = '/block-icons/Block32Millida.png'
  return (
    <span className="hp-ico" style={{ width: size, height: size }}>
      <img
        src={icon || fallback}
        alt=""
        className={icon ? 'is-own' : ''}
        onError={(e) => {
          e.currentTarget.src = fallback
          e.currentTarget.className = ''
        }}
      />
    </span>
  )
}

export const rubLabel = (kopecks: number) => Math.round(kopecks / 100).toLocaleString('ru-RU') + ' ₽'

/// Баланс кошелька Millida компактной плашкой: кошелёк, сумма, «+» — пополнение.
export function BalancePill() {
  const acc = useAccounts((s) => s.list).find((a) => a.kind === 'millida' || a.kind === 'tg')
  if (!acc) return null
  return (
    <button
      className="hp-balance"
      data-tip="Пополнить кошелёк Millida"
      onClick={() => {
        track('store_open', { where: 'wallet_topup' })
        openExt(WALLET_URL)
      }}
    >
      <Icon id="i-wallet" />
      <b>{rubLabel(acc.balance || 0)}</b>
      <span className="hp-balance-add">
        <Icon id="i-plus" />
      </span>
    </button>
  )
}

/// Секция раздела: заголовок, справа действие, ниже содержимое.
export function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={'hp-panel' + (className ? ' ' + className : '')}>
      <div className="hp-panel-head">
        <h3>{title}</h3>
        {action ? <div className="hp-panel-act">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}
