import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { useT } from '../../i18n'
import { BalancePill, Panel } from '../../components/hosting/HostKit'
import { hostingPlanPrice, moneyText, useMoney } from '../../lib/useMoney'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { Empty, Loading, Row, Toggle, dateLabel, dtLabel } from './kit'
import { host, errText } from './api'
import type { HostingEvent, HostingSubscription } from './api'

/// Журнал сервера — подраздел «Автоматика и журнал», как на сайте.
export function Journal({ serverId }: { serverId: string }) {
  const t = useT()
  const [events, setEvents] = useState<HostingEvent[] | null>(null)
  useEffect(() => {
    setEvents(null)
    void host
      .events(serverId, 40)
      .then((r) => setEvents(Array.isArray(r) ? r : []))
      .catch(() => setEvents([]))
  }, [serverId])
  return (
    <Panel title={t('Журнал')}>
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
        <Empty icon="i-list" text={t('Записей пока нет')} />
      )}
    </Panel>
  )
}

export function TabPlan({
  serverId,
  view,
  planName,
  planCode,
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
  planCode?: string | null
  planPriceKopecks?: number | null
  subscription?: HostingSubscription | null
  canDelete?: boolean
  worldDeleteAt?: string | null
  onUpgrade: () => void
  onDeleted: () => void
  onChanged: () => void
}) {
  const t = useT()
  useMoney()
  const [autoRenew, setAutoRenew] = useState(!!subscription?.autoRenew)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => setAutoRenew(!!subscription?.autoRenew), [subscription?.autoRenew])


  const toggleRenew = async (v: boolean) => {
    setBusy('renew')
    setAutoRenew(v)
    try {
      const r = await host.setAutoRenew(serverId, v)
      showToast(v ? t('Продление включено') : t('Продление выключено — оплаченный срок остаётся'))
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
      !(await uiConfirm(t('Удалить сервер? Мир, плагины и настройки пропадут, адрес освободится не сразу.'), {
        confirmLabel: t('Удалить сервер'),
        danger: true,
      }))
    )
      return
    setBusy('delete')
    try {
      await host.remove(serverId)
      showToast(t('Сервер удалён'))
      onDeleted()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const dangerEl = (
      <section className="hp-panel hp-danger">
        <h3>{t('Удалить сервер')}</h3>
        <div className="host-danger-row">
          <div className="host-danger-sub">{canDelete === false ? t('Сначала выключи автопродление') : t('Мир, плагины и настройки пропадут')}</div>
          <button className="btn sm danger" disabled={busy === 'delete' || canDelete === false} onClick={() => void remove()}>
            <Icon id="i-trash" /> {t('Удалить')}
          </button>
        </div>
      </section>
  )
  if (view === 'danger') return dangerEl

  const shortfall = subscription?.autoRenew ? subscription.renewShortfallKopecks || 0 : 0

  return (
    <>
      <Panel
        title={t('Тариф')}
        action={
          <button className="btn sm primary" onClick={onUpgrade}>
            <Icon id="i-arrow-up" /> {t('Сменить тариф')}
          </button>
        }
      >
        <div className="set-group hp-set">
          <Row k={planName || t('Тариф')}>
            <span className="host-cfg-v">{planPriceKopecks ? t('{price} в месяц', { price: hostingPlanPrice(planCode) ?? '—' }) : t('Бесплатно')}</span>
          </Row>
          {subscription ? (
            <>
              <Row k={t('Оплачен до')} sub={t('период {n} дн.', { n: subscription.periodDays })}>
                <span className="host-cfg-v">{dateLabel(subscription.paidUntil)}</span>
              </Row>
              <Row k={t('Автопродление')} sub={t('Списывается с баланса Millida')}>
                <Toggle on={autoRenew} busy={busy === 'renew'} onChange={(v) => void toggleRenew(v)} />
              </Row>
            </>
          ) : worldDeleteAt ? (
            <Row k={t('Мир хранится до')} sub={t('Запуск сервера продлевает срок')}>
              <span className="host-cfg-v">{dateLabel(worldDeleteAt)}</span>
            </Row>
          ) : null}
          {/* Баланс стоит в шапке панели; здесь — только нехватка на продление, как на сайте. */}
          {shortfall > 0 ? (
            <Row k={t('На балансе не хватает')} sub={t('Пополни, иначе сервер приостановится')}>
              <b className="host-cfg-v" style={{ color: 'var(--m-danger)' }}>{moneyText(shortfall, subscription?.renewCurrency ?? 'RUB')}</b>
              <BalancePill />
            </Row>
          ) : null}
        </div>
      </Panel>
      {view ? null : <div style={{ marginTop: '14px' }}>{dangerEl}</div>}
    </>
  )
}
