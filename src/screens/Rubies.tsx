import { Icon } from '../components/Icon'
import { Ruby } from '../components/Ruby'
import { TopbarPortal } from '../components/TopbarPortal'
import { logoutToLogin } from '../lib/session'
import { Packs } from '../components/shop/Packs'
import { PlusChip } from '../components/shop/PlusBanner'
import { ShopFeed, ShopOverlays, useShop } from '../components/shop/ShopKit'
import '../styles/pixel/shop-juice.css'
import '../styles/pixel/sets.css'
import '../styles/pixel/shop2.css'

/**
 * Магазин v3 (ТЗ 06.10.2026, «картинка вместо слов»): одна лента — герой
 * (набор дня и ящик дня на игроке), скидки дня, задания, наборы, ящики,
 * «за осколки», рубины и баннеры авторов. Блоки общие с экраном персонажа
 * (components/shop/ShopKit). Любая покупка идёт через одно окно подтверждения.
 */
export function Rubies({ on }: { on: boolean }) {
  const s = useShop(on)
  const { signedIn, day, rules, busy, tier, balance, error, bump } = s
  const { toPacks, doManage, doPlus, doPack, reloadShop } = s
  // Срок подписки чипом в шапке вместо полосы над магазином (владелец 06.10.2026).
  const until = s.plus?.paidUntil
    ? new Date(s.plus.paidUntil).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' })
    : ''
  const feed = <ShopFeed s={s} />

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-rubies">
      {/* Шапка: баланс, «+» к рубинам, корона (золотая — подписка есть). */}
      {signedIn ? (
        <TopbarPortal>
          <div className="tb-actions sh-wallet2">
            <span className={'sh-bal' + (bump ? ' bump' : '')} data-cur="rubies" data-tip="Рубины">
              <Ruby size={20} />
              <b>{day ? balance.toLocaleString('ru-RU') : '—'}</b>
            </span>
            <button className="btn sm primary sh-add" aria-label="Пополнить" data-track="top_up" onClick={toPacks}>
              <Icon id="i-plus" />
            </button>
            <PlusChip tier={tier} until={until} onClick={tier ? doManage : () => doPlus('PLUS')} />
          </div>
        </TopbarPortal>
      ) : null}

      {!signedIn ? (
        <>
          <div className="card sh-block sh-guest">
            <Ruby size={40} />
            <button className="btn md primary" id="rubiesLoginCta" data-track="login" onClick={() => logoutToLogin()}>
              <Icon id="i-login" />
              Войти
            </button>
          </div>
          <Packs packs={rules ? rules.packs.items : null} busy={busy} onBuy={(p, art) => void doPack(p, art)} />
        </>
      ) : error && !day ? (
        <div className="card sh-block">
          <div className="sh-head">
            <h2>{error}</h2>
            <button className="btn sm secondary" data-track="retry" onClick={() => void reloadShop()}>
              Повторить
            </button>
          </div>
        </div>
      ) : (
        feed
      )}

      <ShopOverlays s={s} />
    </section>
  )
}
