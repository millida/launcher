import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { Cap, Empty, Loading, Row, Toggle, dateLabel, dtLabel } from './kit'
import { host, errText } from './api'
import type { HostingEvent, HostingSubscription, HostingUsage } from './api'

export function TabPlan({
  serverId,
  planName,
  planPriceKopecks,
  subscription,
  canDelete,
  worldDeleteAt,
  onUpgrade,
  onDeleted,
  onChanged,
}: {
  serverId: string
  planName?: string | null
  planPriceKopecks?: number | null
  subscription?: HostingSubscription | null
  canDelete?: boolean
  worldDeleteAt?: string | null
  onUpgrade: () => void
  onDeleted: () => void
  onChanged: () => void
}) {
  const [events, setEvents] = useState<HostingEvent[] | null>(null)
  const [usage, setUsage] = useState<HostingUsage | null>(null)
  const [autoRenew, setAutoRenew] = useState(!!subscription?.autoRenew)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => setAutoRenew(!!subscription?.autoRenew), [subscription?.autoRenew])

  useEffect(() => {
    void host
      .events(serverId, 25)
      .then((r) => setEvents(Array.isArray(r) ? r : []))
      .catch(() => setEvents([]))
    void host
      .usage(serverId, 30)
      .then(setUsage)
      .catch(() => setUsage(null))
  }, [serverId])

  const toggleRenew = async (v: boolean) => {
    setBusy('renew')
    setAutoRenew(v)
    try {
      const r = await host.setAutoRenew(serverId, v)
      showToast(v ? 'Продление включено' : 'Продление выключено — оплаченный срок остаётся')
      setAutoRenew(r.autoRenew)
      onChanged()
    } catch (e) {
      setAutoRenew(!v)
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (
      !(await uiConfirm('Удалить сервер? Мир, плагины и настройки пропадут, адрес освободится не сразу.', {
        confirmLabel: 'Удалить сервер',
        danger: true,
      }))
    )
      return
    setBusy('delete')
    try {
      await host.remove(serverId)
      showToast('Сервер удалён')
      onDeleted()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const price = planPriceKopecks ? (planPriceKopecks / 100).toLocaleString('ru-RU') + ' ₽ в месяц' : 'Бесплатно'

  return (
    <>
      <div className="card set-group" style={{ padding: '10px 20px 18px' }}>
        <Cap first>Тариф</Cap>
        <Row k={planName || 'Тариф'} sub={price}>
          <button className="btn sm primary" onClick={onUpgrade}>
            <Icon id="i-arrow-up" /> Сменить тариф
          </button>
        </Row>
        {subscription ? (
          <>
            <Row k="Оплачен до" sub={'период ' + subscription.periodDays + ' дн.'}>
              <span className="host-cfg-v">{dateLabel(subscription.paidUntil)}</span>
            </Row>
            <Row k="Автопродление" sub="Выключишь — сервер доработает оплаченный срок">
              <Toggle on={autoRenew} busy={busy === 'renew'} onChange={(v) => void toggleRenew(v)} />
            </Row>
          </>
        ) : worldDeleteAt ? (
          <Row k="Мир хранится до" sub="Бесплатный тариф: запусти сервер — срок продлится">
            <span className="host-cfg-v">{dateLabel(worldDeleteAt)}</span>
          </Row>
        ) : null}
      </div>

      {usage ? (
        <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
          <div className="side-cap" style={{ padding: '0 2px 10px' }}>
            За {usage.days} дней
          </div>
          <div className="kpi-row">
            <div className="kpi">
              <div className="cap">Наработка</div>
              <div className="val">{Math.round(usage.summary.runningHours)} ч</div>
              <div className="bar">
                <i style={{ width: Math.min(100, usage.summary.uptimePercent) + '%' }}></i>
              </div>
            </div>
            <div className="kpi">
              <div className="cap">Пик игроков</div>
              <div className="val">{usage.summary.peakPlayers}</div>
              <div className="bar">
                <i style={{ width: usage.summary.peakPlayers ? '100%' : '0%' }}></i>
              </div>
            </div>
            <div className="kpi">
              <div className="cap">Падений</div>
              <div className="val">{usage.summary.crashes}</div>
              <div className="bar">
                <i className={usage.summary.crashes ? 'st-danger' : ''} style={{ width: usage.summary.crashes ? '100%' : '0%' }}></i>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div className="side-cap" style={{ padding: '0 2px 10px' }}>
          Журнал сервера
        </div>
        {events === null ? (
          <Loading />
        ) : events.length ? (
          <div className="host-log">
            {events.map((e) => (
              <div className="host-log-row" key={e.id}>
                <span className="host-log-at">{dtLabel(e.createdAt)}</span>
                <span className="host-log-msg">{e.message || e.kind}</span>
                {e.actorLabel ? <span className="host-log-who">{e.actorLabel}</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-list" text="Записей пока нет." />
        )}
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div className="side-cap" style={{ padding: '0 2px 10px' }}>
          Удаление
        </div>
        <div className="host-danger-row">
          <div>
            <div className="host-danger-k">Удалить сервер</div>
            <div className="host-danger-sub">
              {canDelete === false
                ? 'Пока включено автопродление, удалить нельзя — сначала выключи его выше.'
                : 'Мир и настройки пропадут. Скачай копию, если она нужна.'}
            </div>
          </div>
          <button className="btn sm danger" disabled={busy === 'delete' || canDelete === false} onClick={() => void remove()}>
            Удалить
          </button>
        </div>
      </div>
    </>
  )
}
