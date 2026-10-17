import type React from 'react'
import { Icon } from '../Icon'
import { copyText } from '../../lib/clipboard'
import { showToast } from '../../state/ui'
import { formatFixed, t, useT } from '../../i18n'

// Сцена сервера — как первый экран millida.net/hosting (приказ владельца 23.09.2026:
// «как на официальном сайте — супер просто, те же цвета»). Зелёная половина —
// сам сервер: имя, статус, адрес, одна большая кнопка. Тёмно-синяя — живые числа
// белыми плашками с воксельными блоками, как чипы на сайте. Одна и та же сцена
// стоит и в списке серверов, и в «Управлять» — человек узнаёт свой сервер.

export const HOST_ST: Record<string, [string, string]> = {
  get RUNNING(): [string, string] { return [t('Работает'), 'on'] },
  get STARTING(): [string, string] { return [t('Запускается'), 'warn'] },
  get STOPPING(): [string, string] { return [t('Останавливается'), 'warn'] },
  get STOPPED(): [string, string] { return [t('Остановлен'), 'off'] },
  get SUSPENDED(): [string, string] { return [t('Приостановлен'), 'danger'] },
  get QUEUED(): [string, string] { return [t('В очереди'), 'warn'] },
  get SLEEPING(): [string, string] { return [t('Спит'), 'off'] },
  get CRASHED(): [string, string] { return [t('Упал'), 'danger'] },
  get INSTALLING(): [string, string] { return [t('Устанавливается'), 'warn'] },
}

export const blockSrc = (n: number) => '/block-icons/Block' + n + 'Millida.png'
export const gbNum = (mb: number) => formatFixed(mb / 1024, mb % 1024 === 0 ? 0 : 1)

/// Шкала из десяти клеток, как полоска опыта в игре: плотный акцент, без градиента.
export function PixMeter({ pct, tone }: { pct: number; tone?: 'warn' | 'danger' }) {
  const on = Math.max(0, Math.min(10, Math.round(pct / 10)))
  return (
    <span className={'hsx-meter' + (tone ? ' is-' + tone : '')} aria-hidden="true">
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < on ? 'on' : ''}></i>
      ))}
    </span>
  )
}

/// Белая плашка с блоком — число крупно, подпись одной строкой.
export function HostStat({
  block,
  big,
  small,
  pct,
  onClick,
}: {
  block: number
  big: React.ReactNode
  small: string
  pct?: number | null
  onClick?: () => void
}) {
  const body = (
    <>
      <img src={blockSrc(block)} alt="" width={40} height={40} />
      <span className="hsx-stat-txt">
        <b>{big}</b>
        <i>{small}</i>
        {pct != null ? <PixMeter pct={pct} tone={pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : undefined} /> : null}
      </span>
      {onClick ? <Icon id="i-chev-r" /> : null}
    </>
  )
  return onClick ? (
    <button className="hsx-stat is-link" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="hsx-stat">{body}</div>
  )
}

export function HostScene({
  name,
  status,
  address,
  icon,
  free,
  tag,
  note,
  actions,
  stats,
  compact,
}: {
  name: string
  status: string
  address: string
  icon?: string
  free?: boolean
  tag?: string
  /// Одна строка под адресом: «Оплачен до …» / «Мир хранится до …».
  note?: string
  actions: React.ReactNode
  stats: React.ReactNode
  compact?: boolean
}) {
  const t = useT()
  const st = HOST_ST[status] || ['—', 'off']
  const copy = async () => {
    if (!address) return
    showToast((await copyText(address)) ? t('Адрес скопирован: {ip}', { ip: address }) : t('Скопируй адрес вручную: {ip}', { ip: address }))
  }
  return (
    <section className={'hsx-scene' + (compact ? ' is-compact' : '')}>
      <div className="hsx-green">
        <div className="hsx-id">
          <span className="hsx-ico">
            {icon ? (
              <img
                src={icon}
                alt=""
                onError={(e) => {
                  e.currentTarget.src = blockSrc(free ? 10 : 32)
                }}
              />
            ) : (
              <img src={blockSrc(free ? 10 : 32)} alt="" />
            )}
          </span>
          <div className="hsx-id-txt">
            <span className={'hsx-status is-' + st[1]}>
              <span className="dot"></span>
              {st[0]}
              {tag ? <em>{tag}</em> : null}
            </span>
            <h2>{name}</h2>
          </div>
        </div>
        <button className="hsx-addr" onClick={() => void copy()} disabled={!address} aria-label={t('Скопировать адрес')}>
          <span>{address || t('Адрес появится после запуска')}</span>
          {address ? <Icon id="i-copy" /> : null}
        </button>
        {note ? (
          <div className="hsx-note">
            <Icon id="i-clock" />
            {note}
          </div>
        ) : null}
        <div className="hsx-acts">{actions}</div>
      </div>
      <div className="hsx-navy">{stats}</div>
    </section>
  )
}
