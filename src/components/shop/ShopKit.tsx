import { useEffect, useRef, useState } from 'react'
import { hasMillidaAccount, openExt, WALLET_URL } from '../../lib/api'
import { onRealtime } from '../../lib/realtime'
import { apiErrorText } from '../../lib/apiError'
import {
  buyPack,
  buySet,
  buyShopCard,
  claimPackQuest,
  loadCases,
  loadPackQuests,
  claimTelegramReward,
  loadTelegramReward,
  type TelegramReward,
  loadPlusEconomy,
  loadRules,
  loadSets,
  loadShopDay,
  rubles,
  type CaseDrop,
  type CaseView,
  type ItemRef,
  type PackQuest,
  type PlusEconomy,
  type Rules,
  type SetColorwayView,
  type SetView,
  type ShopCard,
  type ShopDay,
  type ShopSource,
  type ShopPack,
  type ShopTier,
} from '../../lib/rubies'
import type { PlusTier } from '../../lib/gameProfile'
import { useAccounts } from '../../state/accounts'
import { showToast, useUi } from '../../state/ui'
import { showReward, type RewardEntry } from '../reward/RewardReveal'
import { logoutToLogin, refreshMillidaWallet } from '../../lib/session'
import { Ruby } from '../Ruby'
import { Guard } from '../Guard'
import { MonthOfferBlock, PackArt, PackCount, Packs, topUpKopecks } from './Packs'
import { word } from './rarity'
import { claimWeeklyStep, loadWeeklyAny, type WeeklyPath } from './weekly'
import { useShopGift } from './giftState'
import { Shard } from './parts'
import { PLUS_PASS } from '../daily/chestDrops'
import { CreatorBanner, CreatorCode } from './CreatorCode'
import { useDaily } from '../../state/daily'
import { purchaseFlow } from '../../lib/purchaseTrack'
import { trackFailure } from '../../lib/telemetry'
import '../../styles/pixel/shop-juice.css'
import { wearNow } from '../../state/wearIntent'
import { questsToShow } from './packQuests'
import { TelegramRewardBlock } from './TelegramReward'
import { SetsSection, type SetActs } from './SetsV2'
import { SetShot } from './ShopStage'
import { CaseArt, CaseOpening, CasesSection, caseHex, casePriceOf, type CaseMode, type CaseRun } from './Cases'
import { BonusesSection, TasksSection } from './TasksSection'
import { PlanCard, offerOf } from './PlusBanner'
import { SHOP_SECTIONS } from './ShopNav'
import { PlusChip } from './PlusBanner'
import { ItemShot, TodaySection, type TodayActs } from './Today'
import { BuyLabel, BuySheetHost, openSheet } from './BuySheet'
import { THEME_TONE } from './Sets'
import { usePlus } from '../../state/plus'
import { usePremiumTheme } from '../../lib/premiumTheme'
import { StatusCompare } from '../premium/StatusCompare'
import '../../styles/pixel/sets.css'
import '../../styles/pixel/shop2.css'
import '../../styles/pixel/shop-narrow.css'

const ERR = 'Магазин не ответил, попробуй позже'

/**
 * Нехватка денег на счёте при покупке пакета: `missingKopecks` из ответа
 * службы (0 — сумма не дошла: мост Tauri пропускает из тела ошибки только
 * `message`, тогда недостачу считаем сами), `null` — ошибка другая.
 */
function insufficientKopecks(e: unknown): number | null {
  const text = typeof e === 'string' ? e : e instanceof Error ? e.message : JSON.stringify(e ?? '')
  if (!/insufficient_funds|http 402|не хватает денег|недостаточно средств/i.test(text)) return null
  const m = /missingKopecks\W{0,3}(\d+)/.exec(text)
  return m ? Number(m[1]) : 0
}

/** Вещь каталога — плашка мига награды. */
const entry = (it: ItemRef): RewardEntry => ({ name: it.name, preview: it.preview, rarity: it.rarity })
/** «Надеть» — сразу на фигуру (владелец 24.09.2026, 19:56). */
const wearItems = (list: ItemRef[]) => wearNow(list.map((it) => ({ code: it.code, variant: it.variant })))

import { ShardsSection } from './Shards'
import { craftItem, loadWorkshop, type Workshop } from '../../lib/rubies'
import { fragmentWord } from './rarity'

/**
 * Last loaded shop per account: a return visit draws the feed at once and
 * refreshes it in place, instead of swapping a skeleton for the whole feed in
 * the middle of the entry animation.
 */
type ShopMemo = {
  who: string
  day: ShopDay
  sets: SetView[] | null
  setsAt: string
  cases: CaseView[] | null
  drops: CaseDrop[]
  casesAt: string
  ofDayPct: number
}
let shopMemo: ShopMemo | null = null
/**
 * Магазин как набор общих блоков (06.10.2026, «один в один»): одно состояние и
 * одни покупки на магазин и на экран персонажа. useShop грузит витрину, наборы,
 * ящики, подписку, мастерскую; ShopBlocks рисует блоки (все или выбранные);
 * ShopOverlays — окно покупки и открытие ящика, только у видимого экрана.
 */
export function useShop(on: boolean) {
  const signedIn = hasMillidaAccount()
  const walletBal = useAccounts((st) => st.list).find((a) => a.kind === 'millida' || a.kind === 'tg')?.balance
  const walletKopecks = walletBal ?? 0
  /** Баланс счёта пришёл: только тогда пакету можно сказать «не хватает». */
  const walletKnown = typeof walletBal === 'number'
  // Куда прокрутить ленту (тост «Пополнить» → к пакетам).
  const anchor = useShopGift((st) => st.tab)
  const who = useAccounts((st) => st.list.find((a) => a.kind === 'millida' || a.kind === 'tg')?.id ?? '')
  const [memo] = useState(() => (signedIn && shopMemo?.who === who ? shopMemo : null))
  const [day, setDay] = useState<ShopDay | null>(memo?.day ?? null)
  const [weekly, setWeekly] = useState<WeeklyPath | null>(null)
  const [quests, setQuests] = useState<PackQuest[]>([])
  const [telegram, setTelegram] = useState<TelegramReward | null>(null)
  const [plus, setPlus] = useState<PlusEconomy | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [busy, setBusy] = useState('')
  const [sets, setSets] = useState<SetView[] | null>(memo?.sets ?? null)
  const [setsAt, setSetsAt] = useState(memo?.setsAt ?? '')
  const [cases, setCases] = useState<CaseView[] | null>(memo?.cases ?? null)
  const [drops, setDrops] = useState<CaseDrop[]>(memo?.drops ?? [])
  const [casesAt, setCasesAt] = useState(memo?.casesAt ?? '')
  const [ofDayPct, setOfDayPct] = useState(memo?.ofDayPct ?? 30)
  const [opening, setOpening] = useState<CaseRun | null>(null)
  const caseResult = useRef<ReturnType<typeof purchaseFlow> | null>(null)
  const [error, setError] = useState('')
  /** Счётчик в шапке «подпрыгивает», когда в него прилетела награда. */
  const [bump, setBump] = useState(false)
  const bumpTimer = useRef(0)
  const claimed = useDaily((st) => st.reveal)

  const reloadShop = () =>
    loadShopDay()
      .then((d) => {
        setDay(d)
        useShopGift.getState().setDay(d)
        setError('')
        return d
      })
      .catch((e) => {
        trackFailure('shop', e, { step: 'load' })
        setError(apiErrorText(e, ERR))
        return null
      })

  const reloadSets = () =>
    loadSets()
      .then((r) => {
        setSets(r.sets)
        setSetsAt(r.refreshAt)
      })
      .catch((e) => {
        trackFailure('shop', e, { step: 'sets' })
        setSets((was) => was ?? [])
      })
  const reloadCases = () =>
    loadCases()
      .then((r) => {
        setCases(r.cases)
        setDrops(r.drops ?? [])
        setCasesAt(r.refreshAt ?? '')
        setOfDayPct(r.ofDayPct ?? 30)
      })
      .catch((e) => {
        trackFailure('shop', e, { step: 'cases' })
        setCases((was) => was ?? [])
      })

  useEffect(() => {
    if (!on) return
    loadRules().then(setRules).catch(() => setRules(null))
    if (!signedIn) return
    void useDaily.getState().load()
    void reloadShop().then((d) => {
      if (d) useShopGift.getState().seeWishes(d)
    })
    void reloadSets()
    void reloadCases()
    loadWeeklyAny()
      .then((w) => setWeekly(w?.path ?? null))
      .catch(() => setWeekly(null))
    loadPlusEconomy().then(setPlus).catch(() => setPlus(null))
    loadPackQuests()
      .then((r) => setQuests(questsToShow(r)))
      .catch(() => setQuests([]))
  }, [on, signedIn])

  useEffect(() => {
    if (!on || !signedIn) return
    const reload = () => {
      loadTelegramReward().then(setTelegram).catch(() => setTelegram(null))
    }
    reload()
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [on, signedIn])

  useEffect(() => {
    if (!on || !signedIn) return
    const refresh = () => void refreshMillidaWallet()
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [on, signedIn])

  useEffect(() => {
    if (!on || !signedIn) return
    return onRealtime('account', () => void loadPlusEconomy().then(setPlus).catch(() => undefined))
  }, [on, signedIn])

  useEffect(() => () => window.clearTimeout(bumpTimer.current), [])

  useEffect(() => {
    if (signedIn && day) shopMemo = { who, day, sets, setsAt, cases, drops, casesAt, ofDayPct }
  }, [signedIn, who, day, sets, setsAt, cases, drops, casesAt, ofDayPct])

  const balance = day?.balance ?? 0
  /** Уровень подписки: из магазина, иначе из экрана подписки. */
  const tier: ShopTier = day?.plusTier !== undefined ? day.plusTier : plus?.active ? plus.tier ?? 'PLUS' : day?.plus ? 'PLUS' : null
  useEffect(() => {
    if (day || plus) usePlus.getState().setTier(tier)
  }, [tier, !!day, !!plus])

  const scrollTo = (id: string) => window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  const toPacks = () => scrollTo('shop-rubies')

  // Прокрутка по просьбе снаружи («Пополнить», «Задания») — один раз, потом якорь сбрасывается.
  useEffect(() => {
    if (!on || !day || anchor === 'today') return
    scrollTo(anchor === 'rubies' ? 'shop-rubies' : anchor === 'progress' ? 'shop-tasks' : 'shop-pass')
    useShopGift.getState().setTab('today')
  }, [on, anchor, !!day])

  /** Бонус забран: рубины — сразу в шапку, счётчик подпрыгивает. */
  const lastClaim = useRef<typeof claimed>(null)
  useEffect(() => {
    if (!claimed || claimed === lastClaim.current) return
    lastClaim.current = claimed
    const got = claimed.granted ?? []
    const rub = got.reduce((n, g) => n + (g.kind === 'RUBIES' ? g.amount : 0), 0)
    if (rub) setDay((d) => (d ? { ...d, balance: d.balance + rub } : d))
    if (got.some((g) => g.kind === 'CHEST')) void useDaily.getState().load()
    window.clearTimeout(bumpTimer.current)
    bumpTimer.current = window.setTimeout(() => {
      setBump(rub > 0)
      bumpTimer.current = window.setTimeout(() => setBump(false), 600)
    }, 400)
  }, [claimed])

  /** Не хватает рубинов: честный тост и к пакетам. */
  const short = (price: number, result: ReturnType<typeof purchaseFlow>) => {
    if (price <= balance) return false
    result(false, 'insufficient')
    showToast('Не хватает ' + (price - balance) + ' ' + word(price - balance), 'error')
    toPacks()
    return true
  }

  /** Вещь витрины: окно с вещью на игроке, после оплаты — вспышка и «Надеть». */
  const doBuy = (card: ShopCard, source: ShopSource) => {
    if (!signedIn) return logoutToLogin()
    const result = purchaseFlow('item', card.item.code, card.price, 'rubies')
    if (short(card.price, result)) return
    openSheet({
      kind: 'item',
      name: card.item.name,
      art: <ItemShot item={card.item} big />,
      confirm: <BuyLabel price={card.price} />,
      onCancel: () => result(false, 'cancel'),
      run: async () => {
        setBusy(card.item.code)
        try {
          const res = await buyShopCard(card.item.code, source)
          result(true)
          setDay((d) => (d ? { ...d, balance: res.balance } : d))
          void reloadShop()
          const got = res.granted[0] ?? card.item
          return { onWear: () => wearItems([got]) }
        } catch (e) {
          result(false, 'error', e)
          showToast(apiErrorText(e, ERR), 'error')
          throw e
        } finally {
          setBusy('')
        }
      },
    })
  }

  /** Набор: окно с набором на игроке, после оплаты — вспышка и «Надеть». */
  const doBuySet = (set: SetView, way: SetColorwayView) => {
    if (!signedIn) return logoutToLogin()
    const result = purchaseFlow('bundle', set.id + (way.name ? '~' + way.name : ''), way.price, 'rubies')
    if (short(way.price, result)) return
    const all = way.items.map((x) => x.item)
    openSheet({
      kind: 'set',
      name: set.title,
      tone: THEME_TONE[set.theme],
      art: <SetShot items={all} />,
      confirm: <BuyLabel price={way.price} />,
      onCancel: () => result(false, 'cancel'),
      run: async () => {
        setBusy(set.id)
        try {
          const res = await buySet(set.id, way.name, way.price)
          result(true)
          setDay((d) => (d ? { ...d, balance: res.balance } : d))
          void reloadSets()
          void reloadShop()
          return { onWear: () => wearItems(all) }
        } catch (e) {
          result(false, 'error', e)
          showToast(apiErrorText(e, ERR), 'error')
          void reloadSets()
          throw e
        } finally {
          setBusy('')
        }
      },
    })
  }
  const doWearSet = (_set: SetView, way: SetColorwayView) => wearItems(way.items.map((x) => x.item))

  /**
   * Ящик: окно с сундуком, потом оверлей открытия сам шлёт запрос. ×10 — цена
   * за девять в том же окне; бесплатный первый — сразу открытие, без окна.
   */
  const doOpenCase = (c: CaseView, mode: CaseMode = 'one') => {
    if (!signedIn) return logoutToLogin()
    const shards = c.currency === 'shards'
    const price = casePriceOf(c, mode)
    const result = purchaseFlow('case', c.id + (mode === 'one' ? '' : ':' + mode), price, shards ? 'shards' : 'rubies')
    if (mode === 'free') {
      caseResult.current = result
      setOpening({ ...c, mode })
      return
    }
    if (shards) {
      if (workshop && price > workshop.shards) {
        result(false, 'insufficient')
        return showToast('Не хватает осколков', 'error')
      }
    } else if (short(price, result)) return
    openSheet({
      kind: 'case',
      name: mode === 'x10' ? c.title + ' ×10' : c.title,
      tone: caseHex(c),
      art: <CaseArt view={c} size={230} />,
      confirm: shards ? (
        <>
          Открыть
          <Shard size={18} />
          {price.toLocaleString('ru-RU')}
        </>
      ) : (
        <BuyLabel verb={mode === 'x10' ? 'Открыть ×10' : 'Открыть'} price={price} />
      ),
      onCancel: () => result(false, 'cancel'),
      run: async () => {
        caseResult.current = result
        setOpening({ ...c, mode })
        return null
      },
    })
  }

  const doWeekly = async (at: number) => {
    setBusy('weekly')
    try {
      const res = await claimWeeklyStep(at)
      setWeekly(res.path)
      setDay((d) => (d ? { ...d, balance: res.balance, shards: res.shards } : d))
      const g = res.granted
      if (g.kind === 'ITEM') showReward({ items: [entry(g.item)], onWear: () => wearItems([g.item]) })
      else showReward({ level: 'small', items: [{ name: 'Осколки', icon: 'shard' }], title: '+' + g.amount })
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  const doTelegram = async () => {
    setBusy('telegram')
    try {
      const res = await claimTelegramReward()
      setTelegram(res)
      if (res.balance !== null) {
        const balance = res.balance
        setDay((d) => (d ? { ...d, balance } : d))
      }
      if (res.granted) {
        showReward({
          level: 'mid',
          items: [{ name: 'Рубины', rubies: res.amount }],
          title: 'Начислено',
          sub: res.amount.toLocaleString('ru-RU') + ' ' + word(res.amount),
        })
      } else showToast('Награда за подписку уже забрана', 'ok')
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      showToast(apiErrorText(e, ERR), 'error')
      loadTelegramReward().then(setTelegram).catch(() => setTelegram(null))
    } finally {
      setBusy('')
    }
  }

  const doPackQuest = async (quest: PackQuest) => {
    setBusy('quest:' + quest.code)
    try {
      const res = await claimPackQuest(quest.code)
      setQuests((list) => list.map((q) => (q.code === res.quest.code ? res.quest : q)))
      const got = res.item
      if (got) showReward({ items: [entry(got)], onWear: () => wearItems([got]) })
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  /**
   * PLUS / DIAMOND: окно с короной и «◆2100 каждый месяц», кнопка с ценой ведёт
   * в тот же путь оплаты, что и раньше (useDaily.startPlus: шлюз, ожидание,
   * праздник после оплаты).
   */
  const doPlus = (_want: PlusTier = 'PLUS') => {
    if (!signedIn) return logoutToLogin()
    const choice = (tier: PlusTier) => ({
      key: tier.toLowerCase(),
      tone: tier === 'DIAMOND' ? 'var(--m-rarity-rare)' : 'var(--m-rarity-legendary)',
      art: <PlanCard tier={tier} />,
      confirm: <>{(tier === 'DIAMOND' ? 'Diamond ' : 'PLUS ') + rubles(offerOf(plus, tier).priceKopecks)}</>,
      run: async () => {
        await useDaily.getState().startPlus(tier)
        return null
      },
    })
    // Два тарифа бок о бок (владелец 06.10.2026): PLUS — награды по дням, Diamond — те же сразу.
    // Знак у ника в игре (мод, BadgeMark) — под тарифами (владелец 06.10.2026).
    openSheet({ kind: 'plus', name: 'Millida PLUS', confirm: null, art: null, choices: [choice('PLUS'), choice('DIAMOND')], extra: <StatusCompare row />, run: async () => null })
  }
  // Настройки → «Тема лаунчера» → закрытый PLUS / Diamond: окно покупки здесь.
  const wantPlus = usePremiumTheme((st) => st.wantPlus)
  useEffect(() => {
    if (!on || !wantPlus || !day) return
    usePremiumTheme.setState({ wantPlus: null })
    doPlus(wantPlus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, wantPlus, !!day])
  /** Свой тариф — продлить и управлять: экран подписки. */
  const doManage = () => {
    if (!signedIn) return logoutToLogin()
    useUi.getState().setScreen('plus')
  }

  /**
   * Пополнить счёт Millida на недостающее (правка владельца 24.09.2026). Сайт
   * пока не принимает сумму в ссылке — открываем кошелёк, сумму говорим тостом.
   */
  const doWalletTopUp = (missingKopecks: number) => {
    if (!signedIn) return logoutToLogin()
    openExt(WALLET_URL)
    showToast('Пополни счёт на ' + rubles(missingKopecks) + ' и вернись за пакетом', 'ok')
  }

  /** Пакет: окно с мешком рубинов, после оплаты рубины досчитываются. */
  const doPack = async (pack: ShopPack, art: string) => {
    if (!signedIn) return logoutToLogin()
    const result = purchaseFlow('ruby_pack', pack.code, pack.kopecks, 'kopecks')
    let missing = 0
    if (walletKnown && pack.kopecks > walletKopecks) {
      const fresh = await refreshMillidaWallet()
      missing = fresh === null ? 0 : topUpKopecks(pack.kopecks - fresh)
    }
    openSheet({
      kind: missing ? 'topup' : 'pack',
      art: (
        <span className="bs-pack">
          <PackArt src={art} size="lg" />
          <PackCount n={pack.rubies} />
        </span>
      ),
      confirm: missing ? 'Пополнить ' + rubles(missing) : rubles(pack.kopecks),
      onCancel: () => result(false, 'cancel'),
      run: async () => {
        if (missing) {
          result(false, 'insufficient')
          doWalletTopUp(missing)
          return null
        }
        setBusy(pack.code)
        const from = balance
        try {
          const res = await buyPack(pack.code)
          result(true)
          setDay((d) => (d ? { ...d, balance: res.balance } : d))
          return { rubies: { from, to: res.balance } }
        } catch (e) {
          // Служба (fix/payments): 400 {status:'insufficient_funds', missingKopecks}.
          const miss = insufficientKopecks(e)
          result(false, miss !== null ? 'insufficient' : 'error', e)
          if (miss !== null) doWalletTopUp(topUpKopecks(miss || pack.kopecks - walletKopecks) || pack.kopecks)
          else showToast(apiErrorText(e, ERR), 'error')
          throw e
        } finally {
          setBusy('')
        }
      },
    })
  }

  /** Мастерская «за осколки». */
  const [workshop, setWorkshop] = useState<Workshop | null>(null)
  useEffect(() => {
    if (!on || !signedIn) return
    loadWorkshop().then(setWorkshop).catch(() => setWorkshop(null))
  }, [on, signedIn])
  /** Осколки → половина фрагментов вещи; остаток докупается рубинами. */
  const doCraft = (w: { item: ItemRef; cost: number }) => {
    if (!signedIn) return logoutToLogin()
    if (workshop && w.cost > workshop.shards) return showToast('Не хватает осколков', 'error')
    const result = purchaseFlow('craft', w.item.code, w.cost, 'shards')
    openSheet({
      kind: 'craft',
      name: w.item.name,
      art: <ItemShot item={w.item} big />,
      confirm: <ShardLabel n={w.cost} />,
      onCancel: () => result(false, 'cancel'),
      run: async () => {
        setBusy(w.item.code)
        try {
          const res = await craftItem(w.item.code)
          result(true)
          setWorkshop((was) => (was ? { ...was, shards: res.shards } : was))
          loadWorkshop().then(setWorkshop).catch(() => undefined)
          const got = res.fragments
          if (got) showToast('+' + got.amount + ' ' + fragmentWord(got.amount) + ' ' + got.have + '/' + got.need, 'ok')
          return got && got.have < got.need ? null : { onWear: () => wearItems([res.item]) }
        } catch (e) {
          result(false, 'error', e)
          showToast(apiErrorText(e, ERR), 'error')
          throw e
        } finally {
          setBusy('')
        }
      },
    })
  }

  const todayActs: TodayActs = { balance, busy, sub: !!tier, onBuy: doBuy, onWear: (it) => wearItems([it]) }
  const setActs: SetActs = { balance, busy, onBuy: doBuySet, onWear: doWearSet, sub: !!tier }
  /** Привычка: 4+ дня подряд — задания ниже ящиков; новичку — сразу под героем. */
  const streak = useDaily((st) => st.status?.streak ?? 0)
  const habit = streak >= 4
  const order = SHOP_SECTIONS.map((x) => x.id as string)
  const dayCase = cases?.find((c) => c.ofDay) ?? null
  const dayList = sets ?? []
  const daySet = dayList.find((x) => x.ofDay) ?? dayList[0] ?? null

  /** Плитка подписки первой в рубинах: у подписчика — апгрейд или «Продлить».
   *  Апгрейд PLUS → Diamond показывает состав Diamond: плитка продаёт то, что на кнопке. */
  const plusTile = plus
    ? tier === 'DIAMOND'
      ? { rubies: PLUS_PASS.rubies, label: 'Продлить Diamond', onOpen: doManage, sub: true, diamond: true }
      : tier === 'PLUS'
        ? { rubies: PLUS_PASS.rubies, label: 'Diamond · ' + rubles(offerOf(plus, 'DIAMOND').priceKopecks), onOpen: () => doPlus('DIAMOND'), sub: true, diamond: true }
        : {
            rubies: PLUS_PASS.rubies,
            label: 'Купить · ' + rubles(offerOf(plus, 'PLUS').priceKopecks),
            onOpen: () => doPlus('PLUS'),
            prices: { PLUS: rubles(offerOf(plus, 'PLUS').priceKopecks), DIAMOND: rubles(offerOf(plus, 'DIAMOND').priceKopecks) },
            onPick: (t: PlusTier) => doPlus(t),
          }
    : undefined


  return {
    on, signedIn, day, setDay, rules, busy, plus, tier, balance, error, bump, sets, setsAt, cases, drops, casesAt, ofDayPct, opening, setOpening, caseResult,
    weekly, quests, telegram, workshop, habit, order, dayCase, daySet, plusTile, todayActs, setActs, scrollTo, toPacks,
    reloadShop, reloadSets, reloadCases, doOpenCase, doWeekly, doPackQuest, doTelegram, doPlus, doManage, doPack, doCraft,
  }
}

export type Shop = ReturnType<typeof useShop>

/** Срок подписки «дд.мм» по Москве для чипа. */
export const plusUntil = (plus: { paidUntil?: string | null } | null | undefined): string =>
  plus?.paidUntil ? new Date(plus.paidUntil).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' }) : ''

/** «◇ 450» — главная кнопка покупки за осколки. */
function ShardLabel({ n }: { n: number }) {
  return (
    <>
      Обменять
      <Shard size={18} />
      {n.toLocaleString('ru-RU')}
    </>
  )
}

/**
 * Вся лента магазина — одна на экран магазина и на раздел «Магазин» в
 * гардеробе (владелец 06.10.2026: «один в один»): якоря и блоки в одном
 * порядке, одно состояние (useShop). Порядок: рубины с PLUS, набор дня и
 * ящик дня, бонусы, скидки дня, наборы, ящики, за осколки, баннеры, код.
 */
/** chip — чип подписки в шапке «Пополнить рубины» (гардероб: своей верхней панели магазина там нет). */
export function ShopFeed({ s, chip = false }: { s: Shop; chip?: boolean }) {
  const { on, day, plus, busy, tier, balance, sets, setsAt, cases, drops, casesAt, ofDayPct, opening, weekly, quests, telegram, plusTile, todayActs, setActs } = s
  const { reloadShop, reloadSets, doOpenCase, doWeekly, doPackQuest, doTelegram, doPlus, doManage, doPack } = s
  if (!day)
    return (
      <div className="sh-flow" aria-hidden="true">
        <span className="skel sh-skel" style={{ height: '520px' }} />
        <span className="skel sh-skel" style={{ height: '300px' }} />
      </div>
    )
  return (
    <>
      <div className="sh-flow sv-flow">
        <section id="shop-rubies" className="sv-sec" data-section="rubies">
          <div className="sh-head pk-head">
            <h2>
              <Ruby size={26} />
              Пополнить рубины
            </h2>
            {chip ? <PlusChip tier={tier} until={plusUntil(plus)} onClick={tier ? doManage : () => doPlus('PLUS')} /> : null}
            <span className="sh-bal pk-bal">
              <Ruby size={18} />
              <b>{balance.toLocaleString('ru-RU')}</b>
            </span>
          </div>
          <Guard what="Рубины" silent>
            <Packs packs={day.packs} plusTile={plusTile} busy={busy} onBuy={(p, art) => void doPack(p, art)} />
          </Guard>
        </section>

        <Guard what="Пропуск" silent>
          <TasksSection
            on={on}
            weekly={weekly}
            quests={quests}
            busy={busy}
            onWeekly={(at) => void doWeekly(at)}
            onQuest={(q) => void doPackQuest(q)}
            onPlus={() => (tier ? doManage() : doPlus('PLUS'))}
          />
        </Guard>

        {day.monthOffer ? (
          <Guard what="Предложение месяца" silent>
            <MonthOfferBlock offer={day.monthOffer} packs={day.packs} busy={busy === day.monthOffer.code} onBuy={() => void doPack(day.monthOffer!, '/packs/vault.png')} onEnd={() => void reloadShop()} />
          </Guard>
        ) : null}

        <Guard what="Скидки дня" silent>
          <TodaySection day={day} acts={todayActs} onEnd={() => void reloadShop()} />
        </Guard>

        <Guard what="Бонусы" silent>
          <BonusesSection on={on} />
        </Guard>

        <Guard what="Telegram-канал" silent>
          <TelegramRewardBlock view={telegram} busy={busy === 'telegram'} onClaim={() => void doTelegram()} />
        </Guard>

        <Guard what="Наборы" silent>
          <SetsSection sets={sets} refreshAt={setsAt} on={on} onEnd={() => void reloadSets()} acts={setActs} />
        </Guard>

        <Guard what="Ящики" silent>
          <CasesSection cases={cases} drops={drops} refreshAt={casesAt || undefined} ofDayPct={ofDayPct} balance={balance} busy={!!opening} sub={!!tier} onOpen={doOpenCase} />
        </Guard>

        {s.workshop ? (
          <Guard what="За осколки" silent>
            <ShardsSection data={s.workshop} busy={busy} onCraft={s.doCraft} />
          </Guard>
        ) : null}

        <div className="sv-banners">
          <Guard what="Стать автором" silent>
            <CreatorBanner />
          </Guard>
          <Guard what="Код автора" silent>
            <CreatorCode />
          </Guard>
        </div>
      </div>
    </>
  )
}

/** Окно покупки и открытие ящика: рисует только видимый экран. */
export function ShopOverlays({ s }: { s: Shop }) {
  const { on, opening, setOpening, balance, setDay, caseResult, toPacks, reloadCases, reloadSets } = s
  if (!on) return null
  return (
    <>
      <BuySheetHost />
      {opening ? (
        <CaseOpening
          view={opening}
          balance={balance}
          onBalance={(n) => {
            setDay((d) => (d ? { ...d, balance: n } : d))
            caseResult.current?.(true)
            caseResult.current = null
          }}
          onFail={(e) => {
            setOpening(null)
            if (e === 'insufficient') {
              showToast('Не хватает рубинов', 'error')
              return toPacks()
            }
            caseResult.current?.(false, 'error', e)
            caseResult.current = null
            showToast(apiErrorText(e, ERR), 'error')
          }}
          onDone={() => {
            void reloadCases()
            void reloadSets()
          }}
          onClose={() => setOpening(null)}
          onWear={(item) => {
            setOpening(null)
            wearItems([item])
          }}
        />
      ) : null}
    </>
  )
}
