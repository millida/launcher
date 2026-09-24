import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { BalancePill, Panel, rubLabel } from '../../components/hosting/HostKit'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { Empty, Loading, Row, Toggle, dateLabel, dtLabel } from './kit'
import { host, errText } from './api'
import type { HostingEvent, HostingSubscription } from './api'

/// Журнал сервера — подраздел «Автоматика и журнал», как на сайте.
export function Journal({ serverId }: { serverId: string }) {
  const [events, setEvents] = useState<HostingEvent[] | null>(null)
  useEffect(() => {
    setEvents(null)
    void host
      .events(serverId, 40)
      .then((r) => setEvents(Array.isArray(r) ? r : []))
      .catch(() => setEvents([]))
  }, [serverId])
  return (
    <Panel title="Журнал">
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
        <Empty icon="i-list" text="Записей пока нет" />
      )}
    </Panel>
  )
}

export function TabPlan({
  serverId,
  view,
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
  /// «Тариф и оплата» или «Опасная зона» — подразделы, как на сайте.
  view?: 'plan' | 'danger'
  planName?: string | null
  planPriceKopecks?: number | null
  subscription?: HostingSubscription | null
  canDelete?: boolean
  worldDeleteAt?: string | null
  onUpgrade: () => void
  onDeleted: () => void
  onChanged: () => void
}) {
  const [autoRenew, setAutoRenew] = useState(!!subscription?.autoRenew)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => setAutoRenew(!!subscription?.autoRenew), [subscription?.autoRenew])


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

  const dangerEl = (
      <section className="hp-panel hp-danger">
        <h3>Удалить сервер</h3>
        <div className="host-danger-row">
          <div className="host-danger-sub">{canDelete === false ? 'Сначала выключи автопродление' : 'Мир, плагины и настройки пропадут'}</div>
          <button className="btn sm danger" disabled={busy === 'delete' || canDelete === false} onClick={() => void remove()}>
            <Icon id="i-trash" /> Удалить
          </button>
        </div>
      </section>
  )
  if (view === 'danger') return dangerEl

  const shortfall = subscription?.autoRenew ? subscription.renewShortfallKopecks || 0 : 0

  return (
    <>
      <Panel
        title="Тариф"
        action={
          <button className="btn sm primary" onClick={onUpgrade}>
            <Icon id="i-arrow-up" /> Сменить тариф
          </button>
        }
      >
        <div className="set-group hp-set">
          <Row k={planName || 'Тариф'}>
            <span className="host-cfg-v">{planPriceKopecks ? rubLabel(planPriceKopecks) + ' в месяц' : 'Бесплатно'}</span>
          </Row>
          {subscription ? (
            <>
              <Row k="Оплачен до" sub={'период ' + subscription.periodDays + ' дн.'}>
                <span className="host-cfg-v">{dateLabel(subscription.paidUntil)}</span>
              </Row>
              <Row k="Автопродление" sub="Списывается с баланса Millida">
                <Toggle on={autoRenew} busy={busy === 'renew'} onChange={(v) => void toggleRenew(v)} />
              </Row>
            </>
          ) : worldDeleteAt ? (
            <Row k="Мир хранится до" sub="Запуск сервера продлевает срок">
              <span className="host-cfg-v">{dateLabel(worldDeleteAt)}</span>
            </Row>
          ) : null}
          {/* Баланс стоит в шапке панели; здесь — только нехватка на продление, как на сайте. */}
          {shortfall > 0 ? (
            <Row k="На балансе не хватает" sub="Пополни, иначе сервер приостановится">
              <b className="host-cfg-v" style={{ color: 'var(--m-danger)' }}>{rubLabel(shortfall)}</b>
              <BalancePill />
            </Row>
          ) : null}
        </div>
      </Panel>
      {view ? null : <div style={{ marginTop: '14px' }}>{dangerEl}</div>}
    </>
  )
}
