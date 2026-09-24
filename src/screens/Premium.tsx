import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { PremiumHero } from '../components/premium/PremiumHero'
import { PremiumCard } from '../components/premium/PremiumCard'
import { PremiumPage } from '../components/premium/PremiumPage'
import { CancelLine } from '../components/premium/PremiumBuy'
import { useLobby } from '../state/lobbyMode'
import { loadShowcase, type PremiumPack, type PremiumPlan, type PremiumShowcase } from '../lib/premium'

/// Витрина платных сборок (docs/REDESIGN-2026-09-22.md §2.2).
///
/// Источник составной: сначала будущий адрес подписок, иначе — платные сборки
/// нашего каталога, которые есть уже сейчас. Все карточки, цены и числа —
/// с сервера: чего в ответе нет, того на экране нет.
export function Premium({ on }: { on: boolean }) {
  const [data, setData] = useState<PremiumShowcase | null>(null)
  const [state, setState] = useState<'load' | 'ready' | 'error'>('load')
  const [openId, setOpenId] = useState('')
  // С главной приходят сразу к сборке, выбранной в «Что играем сегодня».
  const target = useLobby((s) => s.premiumTarget)
  useEffect(() => {
    if (!on || !target) return
    setOpenId(target)
    useLobby.setState({ premiumTarget: null })
  }, [on, target])
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!on) return
    let alive = true
    setState((s) => (s === 'ready' ? s : 'load'))
    loadShowcase()
      .then((d) => {
        if (!alive) return
        setData(d)
        setState('ready')
      })
      .catch((e) => {
        if (!alive) return
        // Адреса ещё нет на сервере — это «скоро», а не поломка: ругаться
        // на человека за неготовый бэкенд нечем.
        if (/404/.test(String(e))) {
          setData({ packs: [] })
          setState('ready')
        } else setState('error')
      })
    return () => {
      alive = false
    }
  }, [on, tick])

  const packs: PremiumPack[] = (data && data.packs) || []
  const plans: PremiumPlan[] = (data && data.plans) || []
  const sub = (data && data.subscription) || null
  /// Уровень, о котором говорит витрина: оформленный игроком, иначе первый.
  const plan: PremiumPlan | null = plans.find((x) => x.id === (sub && sub.planId)) || plans[0] || null

  const opened = packs.find((p) => p.id === openId) || null
  const featured = packs.find((p) => p.id === (data && data.featuredId)) || packs[0] || null
  const rest = featured ? packs.filter((p) => p.id !== featured.id) : packs

  // Сборка одна: витрина из неё и состоит — второго экрана, куда идти, нет.
  const single = !opened && packs.length === 1 ? packs[0] : null
  if (single)
    return (
      <section className={'screen' + (on ? ' on' : '')} id="s-premium">
        <div className="page-head">
          <h1>Премиум</h1>
        </div>
        <PremiumPage pack={single} plan={plan} sub={sub} />
      </section>
    )

  if (opened)
    return (
      <section className={'screen' + (on ? ' on' : '')} id="s-premium">
        <PremiumPage pack={opened} plan={plan} sub={sub} onBack={() => setOpenId('')} />
      </section>
    )

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-premium">
      <div className="page-head">
        <h1>Премиум</h1>
      </div>

      {state === 'load' ? (
        <div className="pm-skel">
          <span className="skel pm-skel-hero" />
          <div className="pm-grid">
            {[0, 1, 2].map((i) => (
              <span className="skel pm-skel-card" key={i} />
            ))}
          </div>
        </div>
      ) : null}

      {state === 'error' ? (
        <div className="pm-state card">
          <Icon id="i-alert" />
          <b>Витрина не открылась</b>
          <button className="btn sm secondary" onClick={() => setTick(tick + 1)}>
            <Icon id="i-restart" /> Повторить
          </button>
        </div>
      ) : null}

      {state === 'ready' && !packs.length ? (
        <div className="pm-state card">
          <Icon id="i-crown" />
          <b>Платные сборки скоро</b>
          <button className="btn sm secondary" onClick={() => setTick(tick + 1)}>
            <Icon id="i-restart" /> Обновить
          </button>
        </div>
      ) : null}

      {state === 'ready' && featured ? (
        <>
          <PremiumHero
            pack={featured}
            plan={plan}
            sub={sub}
            onOpen={() => setOpenId(featured.id)}
          />
          <CancelLine sub={sub} />
          {rest.length ? (
            <div className="pm-shelf">
              <h3>Другие сборки</h3>
              <div className="pm-grid">
                {rest.map((p) => (
                  <PremiumCard key={p.id} pack={p} plan={plan} sub={sub} onOpen={() => setOpenId(p.id)} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
