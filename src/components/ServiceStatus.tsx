import { useCallback, useRef, useState } from 'react'
import { api } from '../lib/api'
import { usePolling } from '../lib/usePolling'
import { STATUS_PAGE_URL, STATUS_POLL_MS, outageOf, type Outage, type StatusPage } from '../lib/serviceStatus'
import { openUrl } from '../ipc/commands'
import { useT } from '../i18n'

export function ServiceStatus() {
  const t = useT()
  const [outage, setOutage] = useState<Outage | null>(null)
  const seq = useRef(0)

  const refresh = useCallback(() => {
    const mine = ++seq.current
    // A failed request says nothing about our services (the player may be offline), so it clears the badge.
    api<StatusPage>('/status')
      .then((page) => outageOf(page))
      .catch(() => null)
      .then((next) => {
        if (mine === seq.current) setOutage(next)
      })
  }, [])

  usePolling(refresh, STATUS_POLL_MS, { hiddenMs: STATUS_POLL_MS * 4 })

  if (!outage) return null
  const label =
    outage.state === 'maintenance' ? t('Технические работы') : outage.state === 'down' ? t('Сбой сервисов') : t('Сервисы работают с перебоями')
  return (
    <button
      type="button"
      className={'tb-status ' + outage.state}
      title={outage.what || label}
      aria-label={outage.what ? label + ': ' + outage.what : label}
      onClick={() => void openUrl(STATUS_PAGE_URL)}
    >
      <span className="tb-status-dot" aria-hidden="true" />
      <span className="tb-status-text">{label}</span>
    </button>
  )
}
