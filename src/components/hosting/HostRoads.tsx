import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { api } from '../../lib/api'
import { HostStat } from './HostScene'
import { formatFixed, useT } from '../../i18n'
import { plural } from '../../lib/format'
import { hostingPlanPrice, moneyText, useMoney } from '../../lib/useMoney'

// Первый экран хостинга — две дороги: платный сервер (главная кнопка)
// и бесплатный (вторая). Все числа живые из /hosting/plans: цена, память,
// игроки, сколько хранится мир. Нет ответа — числа не показываются (не заглушка).

export interface HostPlanLite {
  code: string
  name: string
  ramMb?: number
  maxPlayers?: number
  playersComfort?: number
  playersModded?: number
  priceKopecks?: number
  sleeps?: boolean
  worldKeepDays?: number
  backupKeepDays?: number
  featured?: boolean
  fullAccess?: boolean
}

const gb = (mb: number) => formatFixed(mb / 1024, mb % 1024 === 0 ? 0 : 1)

export function hostPlanFacts(plans: HostPlanLite[]) {
  const free = plans.find((p) => !p.priceKopecks) || null
  const paid = plans.filter((p) => !!p.priceKopecks)
  const nums = (f: (p: HostPlanLite) => number | undefined) => paid.map(f).filter((n): n is number => !!n)
  const prices = nums((p) => p.priceKopecks)
  const rams = nums((p) => p.ramMb)
  const players = nums((p) => p.playersComfort || p.maxPlayers)
  const cheapest = paid.reduce<HostPlanLite | null>((best, p) => (!best || (p.priceKopecks ?? 0) < (best.priceKopecks ?? 0) ? p : best), null)
  return {
    free,
    paid,
    cheapest,
    minPrice: prices.length ? Math.min(...prices) : 0,
    ramLow: rams.length ? Math.min(...rams) : 0,
    ramHigh: rams.length ? Math.max(...rams) : 0,
    playersMax: players.length ? Math.max(...players) : 0,
  }
}

function StatSkel({ n }: { n: number }) {
  return (
    <div className="hsx-road-stats" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <span className="skel hsx-stat-skel" key={i}></span>
      ))}
    </div>
  )
}

export function HostRoads({
  paidId,
  freeId,
  onPaid,
  onFree,
}: {
  paidId: string
  freeId: string
  onPaid: () => void
  onFree: () => void
}) {
  const t = useT()
  useMoney()
  const [plans, setPlans] = useState<HostPlanLite[] | null>(null)
  useEffect(() => {
    let alive = true
    api('/hosting/plans?brand=millida')
      .then((r) => alive && setPlans(Array.isArray(r) ? r : []))
      .catch(() => alive && setPlans([]))
    return () => {
      alive = false
    }
  }, [])
  const f = hostPlanFacts(plans || [])
  const loading = plans === null
  // «Не засыпает» — только если это правда для всех платных тарифов из базы.
  const paidAwake = f.paid.length > 0 && f.paid.every((p) => !p.sleeps)

  // Две половины, как первый экран millida.net/hosting: зелёная — платный
  // сервер (целевое действие — покупка, приказ 22.09.2026), тёмно-синяя —
  // бесплатный. Факты — белые плашки с блоками, как чипы на сайте.
  return (
    <div className="hsx-roads">
      <section className="hsx-road is-green">
        <header className="hsx-road-head">
          <h2>{t('Платный сервер')}</h2>
          {loading ? (
            <span className="skel skel-line" style={{ width: 140, height: 22 }}></span>
          ) : f.minPrice ? (
            <div className="hsx-price">
              {t('от')} <b>{f.cheapest ? hostingPlanPrice(f.cheapest.code) : null}</b> {t('в месяц')}
            </div>
          ) : null}
        </header>
        {loading ? (
          <StatSkel n={4} />
        ) : (
          <div className="hsx-road-stats">
            {f.ramHigh ? (
              <HostStat block={20} big={(f.ramLow && f.ramLow !== f.ramHigh ? gb(f.ramLow) + '–' : '') + gb(f.ramHigh) + ' ' + t('ГБ')} small={t('памяти')} />
            ) : null}
            {f.playersMax ? <HostStat block={32} big={t('до {n}', { n: f.playersMax })} small={t('игроков')} /> : null}
            <HostStat block={52} big={t('Моды')} small={t('и плагины')} />
            {paidAwake ? <HostStat block={36} big="24/7" small={t('не засыпает')} /> : null}
          </div>
        )}
        <button className="btn lg primary hsx-cta" id={paidId} onClick={onPaid}>
          <Icon id="i-server-cog" /> {t('Выбрать тариф')}
        </button>
      </section>

      <section className="hsx-road is-navy">
        <header className="hsx-road-head">
          <h2>{t('Бесплатно')}</h2>
          <div className="hsx-price">
            <b>{moneyText(0, null)}</b>
          </div>
        </header>
        {loading ? (
          <StatSkel n={3} />
        ) : f.free ? (
          <div className="hsx-road-stats">
            {f.free.ramMb ? <HostStat block={5} big={t('{n} ГБ', { n: gb(f.free.ramMb) })} small={t('памяти')} /> : null}
            {f.free.maxPlayers ? <HostStat block={51} big={String(f.free.maxPlayers)} small={t('друзей')} /> : null}
            {f.free.worldKeepDays ? (
              <HostStat
                block={12}
                big={plural(f.free.worldKeepDays, t('{n} день', { n: f.free.worldKeepDays }), t('{n} дня', { n: f.free.worldKeepDays }), t('{n} дней', { n: f.free.worldKeepDays }))}
                small={t('хранится мир')}
              />
            ) : null}
          </div>
        ) : null}
        <button className="btn lg secondary hsx-cta" id={freeId} onClick={onFree}>
          <Icon id="i-play" /> {t('Начать бесплатно')}
        </button>
      </section>
    </div>
  )
}
