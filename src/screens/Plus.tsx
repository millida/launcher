import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import '../styles/pixel/plus.css'
import { Icon } from '../components/Icon'
import { Ruby } from '../components/Ruby'
import { Shard } from '../components/shop/parts'
import { ChestLive } from '../components/daily/ChestLive'
import { Milli } from '../components/milli/Milli'
import { seasonCell, TRACK_DAYS } from '../components/daily/track'
import { api, hasMillidaAccount } from '../lib/api'
import { DEFAULT_PLUS_OFFERS, loadPlusEconomy, loadRules, rubles, type PlusEconomy, type Reward, type Rules } from '../lib/rubies'
import { loadCosmeticCatalog } from '../lib/gameProfile'
import { getAccount, isMillidaKind, useAccounts } from '../state/accounts'
import { useGameNick } from '../state/gameNick'
import { useDaily } from '../state/daily'
import { useUi } from '../state/ui'
import { onRealtime } from '../lib/realtime'

/**
 * Экран Millida PLUS в лаунчере. Пересобран 30.09.2026 вместе с
 * millida.net/plus: то же содержание и тот же порядок глав, что у лендинга,
 * а лендинг повторяет /launcher (приказ владельца «возьми лендинг лаунчера
 * целиком»):
 *   первый экран (золотой воин с копьём, чипы) → рубины → Милли → сундуки и
 *   целые вещи → значок PLUS в игре → как это работает → без PLUS / с PLUS →
 *   оформить или за друзей → вопросы.
 * Сетка «вторая строка наград» снята («никому не интересно») — сразу итог.
 *
 * Всё обещанное выдаёт служба: строка PLUS — track.ts (копия SEASON_TRACK),
 * осколки ×1,5 и потолок 150 — economy.catalog.ts, шанс целой вещи и пакеты
 * рубинов — живые из /rubies/rules, лимиты Милли и что она кладёт в сборку —
 * живые из /catalog/milli/limits, значок — launcher-cosmetics.service.ts и
 * глиф мода badge_plus.png (§6), дни за друзей — friend-referral.rules.ts.
 * Оплата — тот же путь, что у кнопки в магазине (state/daily.ts, startPlus).
 */

const SHARD_BOOST = '1,5'
const SHARD_LIMIT = 100
const SHARD_LIMIT_PLUS = 150
const LOOT = ['FIRE_WINGS_REMASTER', 'AXOLOTL', 'CHERRY_BLOSSOM_PARTICLES', 'NITRO_GEM']
const SHOP_SLOTS = ['WINGS', 'PET', 'EFFECT', 'BACK', 'HAT']
const REFERRAL = [
  { friends: 1, days: 3 },
  { friends: 5, days: 14 },
  { friends: 10, days: 30 },
]
const REFERRAL_NOTE = REFERRAL.map((r) => r.friends + ' — ' + r.days + ' дн.').join(' · ')
const EXTRA_LABEL: Record<string, string> = {
  shaders: 'Шейдеры',
  resourcepacks: 'Ресурспаки',
  maps: 'Карты',
  seeds: 'Сиды',
  skins: 'Скины',
  server: 'На сервер',
}
/* Режим «думает дольше и проверяет» делает соседняя ветка: карточка встанет
   сама, когда служба отдаст его в plusModes. */
const DEEP_MODES = ['deep', 'thorough', 'think', 'thinking', 'enhanced', 'pro']
const PROMPTS = ['Хоррор с зомби на 1.20.1', 'Техно и заводы', 'Уютная ферма с едой', 'Магия и данжи']
const OTHERS = ['Kirill_2011', 'dasha_mc', 'Nagibator', 'xX_Pro_Xx', 'SanyaCraft']
const API = 'https://api.millida.net/v2'

type Row = 'free' | 'plus'
const CELLS = Array.from({ length: TRACK_DAYS }, (_, i) => seasonCell(i + 1))

function totals(row: Row) {
  const t = { rubies: 0, chests: 0, rare: 0, epic: 0, legend: 0 }
  for (const c of CELLS)
    for (const r of c[row] as Reward[]) {
      if (r.kind === 'RUBIES') t.rubies += r.amount
      else if (r.kind === 'CHEST') {
        t.chests += 1
        if (r.tier === 'RARE') t.rare += 1
        if (r.tier === 'EPIC') t.epic += 1
        if (r.tier === 'LEGEND') t.legend += 1
      }
    }
  return t
}
const FREE = totals('free')
const PLUS = totals('plus')
const n = (v: number) => v.toLocaleString('ru-RU')
const pl = (v: number, one: string, few: string, many: string) => {
  const m10 = v % 10
  const m100 = v % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

interface MilliLimits {
  free: { day: number; month: number }
  plus: { day: number; month: number }
  plusExtras?: string[]
  plusModes?: string[]
}
interface Stats {
  downloads: number
  online?: number
}
interface ShopItem {
  id: string
  name: string
  preview: string
  price: number
}

function Badge({ size = 16 }: { size?: number }) {
  return <img className="lp-mc-badge" src="/plus/badge-plus.png" alt="PLUS" width={size} height={size} draggable={false} />
}

function Block({ title, sub, children, foot, dark }: { title: ReactNode; sub?: ReactNode; children: ReactNode; foot?: ReactNode; dark?: boolean }) {
  return (
    <div className={'card lp-block' + (dark ? ' is-dark' : '')}>
      <div className="lp-head">
        <h2>{title}</h2>
        {sub ? <span>{sub}</span> : null}
      </div>
      {children}
      {foot ? <div className="lp-foot">{foot}</div> : null}
    </div>
  )
}

export function Plus({ on }: { on: boolean }) {
  const [plus, setPlus] = useState<PlusEconomy | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [milli, setMilli] = useState<MilliLimits | null>(null)
  const [loot, setLoot] = useState<{ id: string; name: string; preview: string }[]>([])
  const [shop, setShop] = useState<ShopItem[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [prompt, setPrompt] = useState(0)
  const [hold, setHold] = useState(false)
  const busy = useDaily((s) => s.busy)
  const pay = useDaily((s) => s.pay)
  useAccounts()
  const acc = getAccount()
  const gameName = useGameNick((s) => s.name)
  const nick = acc && isMillidaKind(acc.kind) && gameName ? gameName : acc ? acc.nick : ''
  const mine = /^[A-Za-z0-9_]{1,16}$/.test(nick) ? nick : ''
  const shown = mine || 'PixelKate'

  useEffect(() => {
    if (!on) return
    let alive = true
    loadRules()
      .then((r) => alive && setRules(r))
      .catch(() => undefined)
    api<MilliLimits>('/catalog/milli/limits')
      .then((m) => alive && m?.plus?.day && setMilli(m))
      .catch(() => undefined)
    api<Stats>('/launcher/stats')
      .then((s) => alive && typeof s?.downloads === 'number' && setStats(s))
      .catch(() => undefined)
    loadCosmeticCatalog()
      .then((c) => {
        if (!alive) return
        const by = new Map<string, (typeof c.items)[number]>()
        const slots = new Map<string, ShopItem[]>()
        for (const i of c.items) {
          const base = (i as { baseId?: string }).baseId || i.id
          if (i.channel !== 'SHOP' || i.staffOnly || !i.preview) continue
          if (!by.has(base)) by.set(base, i)
          const price = i.priceRubies
          if (typeof price === 'number' && price > 350 && price <= PLUS.rubies && SHOP_SLOTS.includes(i.slot) && !i.name.startsWith('(')) {
            const list = slots.get(i.slot) || []
            if (!list.some((x) => x.id === base)) list.push({ id: base, name: i.name, preview: i.preview, price })
            slots.set(i.slot, list)
          }
        }
        setLoot(LOOT.map((id) => by.get(id)).filter((i): i is NonNullable<typeof i> => !!i).map((i) => ({ id: i.id, name: i.name, preview: i.preview! })))
        const mixed: ShopItem[] = []
        for (let k = 0; mixed.length < 16; k += 1) {
          const round = SHOP_SLOTS.map((s) => slots.get(s)?.[k]).filter((x): x is ShopItem => !!x)
          if (!round.length) break
          mixed.push(...round)
        }
        setShop(mixed.slice(0, 16))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [on])

  useEffect(() => {
    if (!on || !hasMillidaAccount()) return
    const load = () => void loadPlusEconomy().then(setPlus).catch(() => setPlus(null))
    load()
    return onRealtime('account', load)
  }, [on])

  useEffect(() => {
    if (!on || hold || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setPrompt((v) => (v + 1) % PROMPTS.length), 2800)
    return () => window.clearInterval(id)
  }, [on, hold])

  const price = plus?.priceKopecks || (rules?.packs as { plus?: { priceKopecks?: number } } | undefined)?.plus?.priceKopecks || 0
  const small = useMemo(() => [...(rules?.packs.items || [])].sort((a, b) => a.kopecks - b.kopecks)[0], [rules])
  const rate = rules?.packs.rubiesPerRuble || 0
  const whole = useMemo(() => {
    const pct = (rules?.chests.items || []).map((c) => c.wholePayerPct || 0).filter((v) => v > 0)
    if (!pct.length) return ''
    const lo = Math.min(...pct)
    const hi = Math.max(...pct)
    return lo === hi ? lo + ' %' : lo + '–' + hi + ' %'
  }, [rules])
  const extras = (milli?.plusExtras || []).filter((k) => EXTRA_LABEL[k])
  const packExtras = extras.filter((k) => k !== 'server')
  const deep = (milli?.plusModes || []).some((m) => DEEP_MODES.includes(m.toLowerCase()))
  const active = !!plus?.active
  const until = plus?.paidUntil
    ? new Date(plus.paidUntil).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
    : ''
  const offers = plus?.offers?.length ? plus.offers : DEFAULT_PLUS_OFFERS
  const offer = (tier: 'PLUS' | 'DIAMOND') => offers.find((o) => o.tier === tier) || DEFAULT_PLUS_OFFERS.find((o) => o.tier === tier)!
  const buy = (tier: 'PLUS' | 'DIAMOND' = 'PLUS') => void useDaily.getState().startPlus(tier)
  const waiting = !!pay && Date.now() - pay.at < 15 * 60_000

  const cta = active ? (
    <span className="lp-active">
      <Icon id="i-check" />
      {plus?.canceled ? 'PLUS до ' + until + ' · без продления' : 'PLUS активен до ' + until}
    </span>
  ) : (
    <button className="btn lg primary lp-cta" disabled={busy === 'plus'} data-track={waiting ? 'plus_open_payment' : 'plus_subscribe'} onClick={() => buy('PLUS')}>
      <Icon id="i-crown" />
      {waiting ? 'Открыть оплату' : 'Оформить PLUS'}
    </button>
  )

  const chips: { art: ReactNode; title: string; sub: string }[] = [
    { art: <Ruby size={34} />, title: n(PLUS.rubies) + ' рубинов', sub: 'За 28 дней входа' },
    { art: <ChestLive ready={false} tier="LEGEND" size={34} />, title: PLUS.chests + ' ' + pl(PLUS.chests, 'сундук', 'сундука', 'сундуков'), sub: 'Легендарный — в конце' },
    ...(milli ? [{ art: <Milli size={34} />, title: 'Милли: ' + milli.plus.day + ' в день', sub: 'Вместо ' + milli.free.day }] : []),
    { art: <Shard size={30} />, title: 'Осколки ×' + SHARD_BOOST, sub: SHARD_LIMIT_PLUS + ' в день вместо ' + SHARD_LIMIT },
    ...(whole && loot[0] ? [{ art: <img src={loot[0].preview} alt="" draggable={false} />, title: 'Целая вещь', sub: whole + ' из сундука' }] : []),
    { art: <img src="/plus/badge-plus@8x.png" alt="" draggable={false} className="px" />, title: 'Значок PLUS', sub: 'В табе и над головой' },
  ].slice(0, 6)

  const cmp: [string, string, string, boolean][] = [
    ['Рубины за 28 дней', n(FREE.rubies), n(FREE.rubies + PLUS.rubies), true],
    ['Сундуки за 28 дней', String(FREE.chests), String(FREE.chests + PLUS.chests), true],
    ...(whole ? [['Целая вещь из сундука', 'Нет', whole, false] as [string, string, string, boolean]] : []),
    ['Осколки в день', String(SHARD_LIMIT), SHARD_LIMIT_PLUS + ', ×' + SHARD_BOOST, true],
    ...(milli ? [['Милли в день', String(milli.free.day), String(milli.plus.day), true] as [string, string, string, boolean]] : []),
    ...(packExtras.length ? [['Шейдеры и карты от Милли', 'Нет', 'Да', false] as [string, string, string, boolean]] : []),
    ...(extras.includes('server') ? [['Сборка на сервер', 'Нет', 'Да', false] as [string, string, string, boolean]] : []),
    ['Значок PLUS', 'Нет', 'Да', false],
  ]

  return (
    <section className={'screen lp' + (on ? ' on' : '')} id="s-plus">
      {/* Первый экран */}
      <div className="lp-hero">
        <span className="lp-hero-grid" aria-hidden="true" />
        <div className="lp-hero-head">
          <span className="lp-eyebrow">Подписка Millida</span>
          <h1>
            Millida <em>PLUS</em>
          </h1>
          {price ? <p>{rubles(price)} / 28 дней · отмена в любой день</p> : <span className="skel lp-price-skel" aria-hidden="true" />}
          <div className="lp-hero-cta">{cta}</div>
          {waiting && !active ? <small className="lp-note">Ждём оплату в браузере</small> : null}
        </div>
        <div className="lp-stage">
          <div className="lp-chips is-left">
            {chips.slice(0, 3).map((c) => (
              <span key={c.title} className="lp-chip">
                <span className="lp-chip-art">{c.art}</span>
                <span>
                  <b>{c.title}</b>
                  <i>{c.sub}</i>
                </span>
              </span>
            ))}
          </div>
          <div className="lp-rig">
            <span className="lp-rig-light" aria-hidden="true" />
            <img src="/plus/hero-gold.webp" alt="Игрок в золотой броне с копьём" draggable={false} />
          </div>
          <div className="lp-chips is-right">
            {chips.slice(3).map((c) => (
              <span key={c.title} className="lp-chip">
                <span className="lp-chip-art">{c.art}</span>
                <span>
                  <b>{c.title}</b>
                  <i>{c.sub}</i>
                </span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Рубины */}
      <Block
        title={
          <>
            <em>{n(PLUS.rubies)}</em> рубинов в месяц
          </>
        }
        sub={small ? '«' + small.title + '» за ' + rubles(small.kopecks) + ' — ' + n(small.rubies) : undefined}
      >
        <div className="lp-ruby-row">
          <div>
            <Ruby size={34} />
            <b className="is-gold">{n(PLUS.rubies)}</b>
            <small>за 28 дней входа</small>
          </div>
          {rate ? (
            <div>
              <b>{rubles(Math.round(PLUS.rubies / rate) * 100)}</b>
              <small>по цене магазина</small>
            </div>
          ) : null}
          <div>
            <b>+{n(FREE.rubies)}</b>
            <small>бесплатная строка остаётся</small>
          </div>
        </div>
        {shop.length ? (
          <div className="lp-shop">
            {shop.map((s) => (
              <div key={s.id} className="lp-shop-item">
                <img src={s.preview} alt="" draggable={false} loading="lazy" />
                <span className="lp-shop-name">{s.name}</span>
                <span className="lp-shop-price">
                  <Ruby size={14} />
                  {n(s.price)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Block>

      {/* Милли */}
      {milli ? (
        <Block
          title={
            <>
              Милли собирает <em>больше</em>
            </>
          }
          sub="ИИ-сборщик в каталоге и на сайте"
        >
          <div className="lp-ai-wrap">
            <div className="lp-aib">
              <div className="lp-aib-head">
                <Milli size={64} mode="talk" />
                <div>
                  <b>Милли с PLUS</b>
                  <i>Опиши, во что хочешь играть</i>
                </div>
              </div>
              <div className="lp-aib-field" aria-live="polite">
                <span>{PROMPTS[prompt]}</span>
                <span className="lp-aib-go">Собрать</span>
              </div>
              <div className="lp-aib-chips">
                {PROMPTS.map((t, i) => (
                  <button
                    key={t}
                    className={'lp-aib-chip' + (i === prompt ? ' on' : '')}
                    aria-pressed={i === prompt}
                    onClick={() => {
                      setHold(true)
                      setPrompt(i)
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="lp-aiex">
              <div className="lp-aiex-card is-on">
                <b>
                  {milli.plus.day} {pl(milli.plus.day, 'запрос', 'запроса', 'запросов')} в день
                </b>
                <div className="lp-bars">
                  <span style={{ '--w': Math.max(4, (milli.free.day / milli.plus.day) * 100) + '%' } as CSSProperties}>
                    <i>Без PLUS</i>
                    <em>{milli.free.day}</em>
                  </span>
                  <span className="is-plus" style={{ '--w': '100%' } as CSSProperties}>
                    <i>PLUS</i>
                    <em>{milli.plus.day}</em>
                  </span>
                </div>
                <small>
                  <strong>{n(milli.plus.month)} в месяц</strong> · без PLUS — {milli.free.month}
                </small>
              </div>
              {packExtras.length ? (
                <div className="lp-aiex-card">
                  <b>В сборке не только моды</b>
                  <div className="lp-kinds">
                    {packExtras.map((k) => (
                      <span key={k}>{EXTRA_LABEL[k]}</span>
                    ))}
                  </div>
                </div>
              ) : null}
              {extras.includes('server') ? (
                <div className="lp-aiex-card">
                  <b>Сборка на сервер</b>
                  <small>
                    <strong>Одной кнопкой</strong> · на Millida Hosting
                  </small>
                </div>
              ) : null}
              {deep ? (
                <div className="lp-aiex-card">
                  <b>Думает дольше</b>
                  <small>
                    <strong>Проверяет сборку</strong> · перед тем как отдать
                  </small>
                </div>
              ) : null}
            </div>
          </div>
        </Block>
      ) : null}

      {/* Сундуки */}
      <Block
        title={
          <>
            Сундуки и <em>целые вещи</em>
          </>
        }
        foot={cta}
      >
        <div className="lp-cards">
          <div className="lp-cardx">
            <div className="lp-cardx-art">
              <ChestLive ready={false} tier="RARE" size={64} />
              <ChestLive ready={false} tier="LEGEND" size={100} />
              <ChestLive ready={false} tier="EPIC" size={64} />
            </div>
            <b>
              {PLUS.chests} {pl(PLUS.chests, 'сундук', 'сундука', 'сундуков')}
            </b>
            <small>
              {PLUS.rare} редких · {PLUS.epic} эпических · {PLUS.legend} легендарный
            </small>
          </div>
          {whole ? (
            <div className="lp-cardx">
              <div className="lp-cardx-art lp-loot">
                {loot.map((l) => (
                  <img key={l.id} src={l.preview} alt={l.name} draggable={false} />
                ))}
              </div>
              <b>Целая вещь {whole}</b>
              <small>Без PLUS — только фрагменты</small>
            </div>
          ) : null}
          <div className="lp-cardx">
            <div className="lp-cardx-art">
              <Shard size={72} />
              <strong className="lp-x">×{SHARD_BOOST}</strong>
            </div>
            <b>Осколки ×{SHARD_BOOST}</b>
            <small>
              {SHARD_LIMIT_PLUS} в день вместо {SHARD_LIMIT}
            </small>
          </div>
        </div>
      </Block>

      {/* Значок в игре */}
      <Block
        title={
          <>
            Значок PLUS <em>в игре</em>
          </>
        }
        sub="так тебя видят на сервере"
      >
        <div className="lp-mc">
          <img className="lp-mc-bg" src="/plus/scene.webp" alt="" draggable={false} />
          <span className="lp-mc-shade" aria-hidden="true" />
          <div className="lp-mc-tab">
            {[OTHERS[0]!, shown, ...OTHERS.slice(1)].map((p) => (
              <div key={p} className={'lp-mc-row' + (p === shown ? ' is-you' : '')}>
                <img className="lp-mc-head" src={API + '/heads/avatar/' + encodeURIComponent(p) + '?size=32'} alt="" draggable={false} />
                <span className="lp-mc-name">
                  {p === shown ? <Badge /> : null}
                  {p}
                </span>
                <span className="lp-mc-ping" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            ))}
          </div>
          {['dasha_mc', 'Nagibator'].map((p, i) => (
            <div key={p} className={'lp-mc-fig is-other ' + (i === 0 ? 'is-left' : 'is-right')} aria-hidden="true">
              {i === 0 ? <span className="lp-mc-note">Все остальные</span> : null}
              <span className="lp-mc-plate">{p}</span>
              <img className="lp-mc-body" src={API + '/heads/body3d/' + encodeURIComponent(p) + '.webp?size=256'} alt="" draggable={false} />
            </div>
          ))}
          <div className="lp-mc-fig is-you">
            <span className="lp-mc-light" aria-hidden="true" />
            <span className="lp-mc-note is-gold">{mine ? 'Это ты' : 'Так выглядит твой ник'}</span>
            <span className="lp-mc-plate">
              <Badge size={20} />
              {shown}
            </span>
            <img key={shown} className="lp-mc-body" src={API + '/heads/body3d/' + encodeURIComponent(shown) + '.webp?size=384'} alt={'Скин игрока ' + shown} draggable={false} />
          </div>
        </div>
        <div className="lp-where">
          <span>
            <Badge size={16} />В табе
          </span>
          <span>Над головой</span>
          <span>В профиле на millida.net</span>
          {stats ? <span>Видят {n(stats.downloads)} скачавших лаунчер</span> : null}
        </div>
      </Block>

      {/* Как это работает */}
      <Block
        title={
          <>
            Как это <em>работает</em>
          </>
        }
      >
        <div className="lp-path">
          {[
            ['Оформи PLUS', price ? rubles(price) + ' / 28 дней' : 'Раз в 28 дней'],
            ['Заходи в лаунчер', 'Клетка наград за день'],
            ['Забирай', 'Рубины, сундуки, осколки'],
          ].map(([t, s], i, all) => (
            <Fragment key={t}>
              <div className="lp-path-card">
                <span>{i + 1}</span>
                <b>{t}</b>
                <small>{s}</small>
              </div>
              {i < all.length - 1 ? <Icon id="i-chev-r" /> : null}
            </Fragment>
          ))}
        </div>
        <div className="lp-foot-note">Отмена в профиле — оплаченные дни остаются</div>
      </Block>

      {/* Сравнение */}
      <Block
        title={
          <>
            Без PLUS и <em>с PLUS</em>
          </>
        }
        sub="бесплатная строка остаётся у всех"
      >
        <div className="lp-cmp" role="table">
          <div className="lp-cmp-row is-head" role="row">
            <span role="columnheader" />
            <span role="columnheader">Бесплатно</span>
            <span role="columnheader">
              <em className="lp-cmp-plus">
                <Icon id="i-crown" />
                PLUS
              </em>
            </span>
          </div>
          {cmp.map(([label, free, pls, partial]) => (
            <div key={label} className="lp-cmp-row" role="row">
              <span role="rowheader">{label}</span>
              <span role="cell" className={partial ? 'is-part' : 'is-no'}>
                {free}
              </span>
              <span role="cell" className="is-yes">
                {pls}
              </span>
            </div>
          ))}
        </div>
      </Block>

      {/* Оформить */}
      <Block
        title={
          <>
            Оформить <em>PLUS</em>
          </>
        }
        sub="или получить за друзей"
      >
        <div className="lp-buy">
          {(['PLUS', 'DIAMOND'] as const).map((tier) => (
            <div key={tier} className={'lp-buy-card' + (tier === 'PLUS' ? ' is-main' : ' is-diamond')}>
              <div>
                <b>{tier === 'PLUS' ? 'PLUS' : 'PLUS Diamond'}</b>
                <strong className="lp-buy-price">{rubles(offer(tier).priceKopecks)} / 28 дней</strong>
                {tier === 'DIAMOND' ? <small>Все награды пропуска сразу</small> : <small>Награды каждый день</small>}
              </div>
              {active ? (
                cta
              ) : (
                <button
                  className={'btn lg lp-cta' + (tier === 'PLUS' ? ' primary' : '')}
                  disabled={busy === 'plus'}
                  data-track={'plus_subscribe_' + tier.toLowerCase()}
                  onClick={() => buy(tier)}
                >
                  <Icon id="i-crown" />
                  {waiting ? 'Открыть оплату' : 'Оформить'}
                </button>
              )}
            </div>
          ))}
          <div className="lp-buy-card">
            <div>
              <b>За друзей</b>
              <small>{REFERRAL_NOTE}</small>
            </div>
            <button className="btn lg" data-track="plus_invite" onClick={() => useUi.getState().setScreen('friends')}>
              <Icon id="i-users" />
              Пригласить
            </button>
          </div>
        </div>
      </Block>

      {/* Вопросы */}
      <Block
        title={
          <>
            Частые <em>вопросы</em>
          </>
        }
      >
        <div className="lp-faq">
          {[
            ['Сколько стоит?', (price ? rubles(price) : '299 ₽') + ' за 28 дней. Автопродление выключается на millida.net в профиле, оплаченные дни остаются.'],
            ['Как приходят рубины и сундуки?', 'Каждый день входа открывает клетку наград в бонусе за вход: за 28 дней это ' + n(PLUS.rubies) + ' рубинов и ' + PLUS.chests + ' сундуков сверх бесплатных. Сундуки ждут в «Моих сундуках».'],
            ['Что, если пропустить день?', 'Клетка открывается за день входа, пропуск клетку не добавляет. Забранное остаётся.'],
            ...(milli
              ? [['Что даёт PLUS в Милли?', milli.plus.day + ' запросов в день и ' + n(milli.plus.month) + ' в месяц вместо ' + milli.free.day + ' и ' + milli.free.month + '. Милли кладёт в сборку шейдеры, ресурспаки и карты и ставит её на сервер одной кнопкой.']]
              : []),
            ['Можно получить бесплатно?', 'Да, за друзей: первый приглашённый — 3 дня PLUS, пять друзей — ещё 14 дней, десять — 30. Друг засчитывается после двух часов игры.'],
            ['Что остаётся после отмены?', 'Рубины, сундуки, фрагменты и вещи, которые ты забрал. Гаснут клетки PLUS, осколки ×1,5, лимиты Милли и значок.'],
          ].map(([q, a]) => (
            <details key={q} name="lp-faq" className="lp-faq-item">
              <summary>
                {q}
                <Icon id="i-chev-d" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </Block>
    </section>
  )
}
