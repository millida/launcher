import type React from 'react'
import { Icon } from '../Icon'
import { WALLET_URL, openExt } from '../../lib/api'
import { track } from '../../lib/telemetry'
import { useAccounts } from '../../state/accounts'
import { intlTag, t, useT } from '../../i18n'

// Мелкие детали экрана хостинга, общие для списка и разделов.

/// Статус → подпись и тон бейджа. Закрашенная точка — живое, полая — нет.
type HostStatus = [string, 'success' | 'warning' | 'danger' | 'neutral', boolean]

export const HOST_ST: Record<string, HostStatus> = {
  get RUNNING(): HostStatus { return [t('Работает'), 'success', true] },
  get STARTING(): HostStatus { return [t('Запускается'), 'warning', true] },
  get QUEUED(): HostStatus { return [t('В очереди'), 'warning', true] },
  get INSTALLING(): HostStatus { return [t('Устанавливается'), 'warning', true] },
  get STOPPING(): HostStatus { return [t('Останавливается'), 'warning', true] },
  get STOPPED(): HostStatus { return [t('Остановлен'), 'neutral', false] },
  get SLEEPING(): HostStatus { return [t('Спит'), 'neutral', false] },
  get CRASHED(): HostStatus { return [t('Упал'), 'danger', false] },
  get SUSPENDED(): HostStatus { return [t('Приостановлен'), 'danger', false] },
  get ARCHIVED(): HostStatus { return [t('В архиве'), 'neutral', false] },
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

export const rubLabel = (kopecks: number) => Math.round(kopecks / 100).toLocaleString(intlTag()) + ' ₽'

/// Баланс кошелька Millida компактной плашкой: кошелёк, сумма, «+» — пополнение.
export function BalancePill() {
  const t = useT()
  const acc = useAccounts((s) => s.list).find((a) => a.kind === 'millida' || a.kind === 'tg')
  if (!acc) return null
  return (
    <button
      className="hp-balance"
      data-tip={t('Пополнить кошелёк Millida')}
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
