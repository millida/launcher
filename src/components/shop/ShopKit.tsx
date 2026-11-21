import { useEffect, useRef, useState } from 'react'
import { hasMillidaAccount } from '../../lib/api'
import { onRealtime } from '../../lib/realtime'
import { apiErrorText } from '../../lib/apiError'
import {
  buyPack,
  buySet,
  buyShopCard,
  quoteWardrobe,
  giftQuote,
  giftShopItem,
  newRequestId,
  type GiftQuote,
  claimPackQuest,
  loadCases,
  loadPackQuests,
  claimTelegramReward,
  loadTelegramReward,
  unlinkTelegram,
  type TelegramReward,
  claimDiscordReward,
  loadDiscordReward,
  type DiscordReward,
  loadPlusEconomy,
  loadRules,
  loadSets,
  loadShopDay,
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
  type PackPromo,
} from '../../lib/rubies'
import { loadCosmeticCatalog, type CosmeticItem, type PlusTier } from '../../lib/gameProfile'
import { useAccounts } from '../../state/accounts'
import { showToast, useUi } from '../../state/ui'
import { showReward, type RewardEntry } from '../reward/RewardReveal'
import { showLogin } from '../../lib/session'
import { Ruby } from '../Ruby'
import { Guard } from '../Guard'
import { MonthOfferBlock, PackArt, PackCount, Packs } from './Packs'
import { SECOND_ART } from './packMath'
import { claimWeeklyStep, loadWeeklyAny, type WeeklyPath } from './weekly'
import { useShopGift } from './giftState'
import { Shard } from './parts'
import { PLUS_PASS, fragmentTopUp } from '../daily/chestDrops'
import { CreatorBanner, CreatorCode } from './CreatorCode'
import { useDaily } from '../../state/daily'
import { purchaseFlow } from '../../lib/purchaseTrack'
import { track, trackFailure } from '../../lib/telemetry'
import { PackPicker, ShortfallBar } from './PackPicker'
import {
  affordNoticeOn,
  affordNoticedToday,
  markAffordNoticed,
  nowAffordable,
  openPackNeed,
  type PackNeed,
  type PickOption,
} from './packNeed'
import '../../styles/pixel/shop-juice.css'
import { wearNow } from '../../state/wearIntent'
import { questsToShow } from './packQuests'
import { SocialTasks } from './SocialTasks'
import { claimFailure, type TaskFailure, type TaskKind } from './taskRules'
import { SetsSection, type SetActs } from './SetsV2'
import { ShopStage } from './ShopStage'
import { CaseArt, CaseOpening, CasesSection, caseHex, casePriceOf, type CaseMode, type CaseRun } from './Cases'
import { BonusesSection, TasksSection } from './TasksSection'
import { PlanCard } from './PlusBanner'
import { SHOP_SECTIONS } from './ShopNav'
import { PlusChip } from './PlusBanner'
import { ItemShot, ItemStage, TodaySection, TrendSection, type TodayActs } from './Today'
import { CollectionsSection } from './Collections'
import { BuyLabel, BuySheetHost, openSheet, useBuySheet } from './BuySheet'
import { openGiftPicker, useGiftPick, type GiftTarget } from './giftPick'
import { lazyHost } from '../../lib/lateMount'
import { topUpFragments } from './topUp'
import { FragBar } from './rarityUi'
import { THEME_TONE } from './Sets'
import { PriceRiseTag } from './priceRise'
import { usePlus } from '../../state/plus'
import { usePremiumTheme } from '../../lib/premiumTheme'
import { StatusCompare } from '../premium/StatusCompare'
import { intlTag, t, useT } from '../../i18n'
import '../../styles/pixel/sets.css'
import '../../styles/pixel/shop2.css'
import '../../styles/pixel/shop-narrow.css'

const err = () => t('Магазин не ответил, попробуй позже')

/** Вещь каталога — плашка мига награды. */
const entry = (it: ItemRef): RewardEntry => ({ name: it.name, preview: it.preview, rarity: it.rarity })
/** «Надеть» — сразу на фигуру (владелец 24.09.2026, 19:56). */
const GiftPickerHost = lazyHost(
  () => import('./GiftFriends').then((m) => ({ default: m.GiftPickerHost })),
  () => useGiftPick((s) => !!s.ask),
)

const wearItems = (list: ItemRef[]) => wearNow(list.map((it) => ({ code: it.code, variant: it.variant })))

import { ShardsSection } from './Shards'
import { craftItem, FRAGMENTS_CHANGED, loadWorkshop, payablePrice, type Workshop } from '../../lib/rubies'
import { SHARDS_CHANGED } from '../feedbackStatus'
import { affords, openTopup, plusPrice, refreshMoney, rubyPackPrice, rubyQuote, shortfallFor, useMoney } from '../../lib/useMoney'
import { formatMoney, isQuote, moneyShortfall, quoteText, scaleQuote, shortfallText, type MoneyShortfall } from '../../lib/money'
import { PackPromoField, forgetPackPromo } from './PackPromo'
import { fragmentWord } from './rarity'
import { noted } from '../../lib/noted'

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
  useMoney()
  const signedIn = hasMillidaAccount()
  // Куда прокрутить ленту (тост «Пополнить» → к пакетам).
  const anchor = useShopGift((st) => st.tab)
  const who = useAccounts((st) => st.list.find((a) => a.kind === 'millida' || a.kind === 'tg')?.id ?? '')
  const [memo] = useState(() => (signedIn && shopMemo?.who === who ? shopMemo : null))
  const [day, setDay] = useState<ShopDay | null>(memo?.day ?? null)
  const [weekly, setWeekly] = useState<WeeklyPath | null>(null)
  const [quests, setQuests] = useState<PackQuest[]>([])
  const [telegram, setTelegram] = useState<TelegramReward | null>(null)
  const [discord, setDiscord] = useState<DiscordReward | null>(null)
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
  /** Вещь, которую предложить купить, как только пополнение покроет её цену. */
  const pendingBuy = useRef<PackNeed['item'] | null>(null)
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
        setError(apiErrorText(e, err()))
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
      // Сбой сети не прячет задание посреди шага: остаётся то, что было видно.
      loadTelegramReward().then(setTelegram).catch(noted('shop-tasks'))
      loadDiscordReward().then(setDiscord).catch(noted('shop-tasks'))
    }
    reload()
    window.addEventListener('focus', reload)
    return () => window.removeEventListener('focus', reload)
  }, [on, signedIn])

  useEffect(() => {
    if (!on || !signedIn) return
    const refresh = () => void refreshMoney()
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

  /** Не хватает рубинов: окно выбора пакета под эту нехватку (вместо прокрутки к ряду). */
  const short = (price: number, result: ReturnType<typeof purchaseFlow>, need: Partial<PackNeed> = {}) => {
    if (price <= balance) return false
    result(false, 'insufficient')
    openPackNeed({ target: price, from: need.from ?? 'shortfall', item: need.item, title: need.title })
    return true
  }

  const balanceRef = useRef(balance)
  balanceRef.current = balance

  /** Подарок другу: цена — из ответа службы (личные скидки дарящего не действуют), повтор нажатия не списывает дважды. */
  const giftTo = async (item: ItemRef, source: ShopSource, friend: GiftTarget) => {
    let quote: GiftQuote
    try {
      quote = await giftQuote(item.code)
    } catch (e) {
      showToast(apiErrorText(e, t('Не удалось узнать цену подарка')), 'error')
      return
    }
    if (quote.price > balanceRef.current) {
      openPackNeed({ target: quote.price, from: 'gift', title: item.name })
      return
    }
    const requestId = newRequestId()
    openSheet({
      kind: 'gift',
      name: t('Подарить «{item}» другу {nick}', { item: item.name, nick: friend.nickname }),
      art: <ItemShot item={item} big />,
      confirm: <BuyLabel verb={t('Подарить за')} price={quote.price} />,
      run: async () => {
        try {
          const res = await giftShopItem(item.code, friend.userId, source, requestId)
          setDay((d) => (d ? { ...d, balance: res.balance } : d))
          showToast(t('Подарок отправлен {name}', { name: res.to?.nickname || friend.nickname }), 'ok')
          return null
        } catch (e) {
          const text = apiErrorText(e, t('Не удалось подарить. Попробуй ещё раз'))
          showToast(text, 'error')
          if (text === t('Не хватает рубинов')) openPackNeed({ target: quote.price, from: 'gift', title: item.name })
          throw e
        }
      },
    })
  }

  const doGift = (item: ItemRef, source: ShopSource) => {
    if (!signedIn) return showLogin()
    openGiftPicker(item.name, (friend) => void giftTo(item, source, friend))
  }

  /** Своя вещь витрины: то же окно, главная кнопка «Надеть», рядом «Подарить». */
  const doOwned = (card: ShopCard, source: ShopSource) =>
    openSheet({
      kind: 'item_owned',
      name: card.item.name,
      art: <ItemStage item={card.item} />,
      confirm: t('Надеть'),
      gift: () => doGift(card.item, source),
      run: async () => {
        wearItems([card.item])
        return null
      },
    })

  /** Расцветки вещи из каталога: первая — та, что на карточке витрины, остальные — по своей цене. */
  const colorwaysOf = async (code: string): Promise<CosmeticItem[]> => {
    const base = code.split('~')[0]
    const catalog = await loadCosmeticCatalog().catch(() => null)
    return (catalog?.items ?? []).filter((c) => c.baseId === base)
  }

  /** Вещь витрины: окно с вещью на игроке, после оплаты — вспышка и «Надеть». */
  const doBuy = async (shown: ShopCard, source: ShopSource, after?: () => void) => {
    if (!signedIn) return showLogin()
    if (shown.owned) return doOwned(shown, source)
    // Другие расцветки и всё, что покупается из гардероба, стоят столько, сколько скажет служба
    // (shop/quote): её число она же примет в expect. Своей формулы скидок здесь нет.
    const ways = await colorwaysOf(shown.item.code)
    const others = ways.filter((w) => w.id !== shown.item.code).map((w) => w.id)
    const ask = source === 'wardrobe' ? [shown.item.code, ...others] : others
    const quoted = ask.length ? await quoteWardrobe(ask).catch(() => null) : new Map<string, number | null>()
    let card = shown
    if (source === 'wardrobe') {
      if (!quoted) {
        showToast(t('Не удалось узнать цену, попробуй ещё раз'), 'error')
        return
      }
      const price = quoted.get(shown.item.code)
      if (price == null) {
        showToast(t('Эта вещь уже твоя или снята с продажи'), 'error')
        void reloadShop()
        return
      }
      card = { ...shown, price }
    }
    if (!payablePrice(card.price)) {
      showToast(t('Цена этой вещи ещё не пришла — обновляю магазин'), 'error')
      void reloadShop()
      return
    }
    const result = purchaseFlow('item', card.item.code, card.price, 'rubies')
    if (short(card.price, result, { from: 'item', item: { card, source } })) return
    const view = (item: ItemRef, price: number, from: ShopSource) => ({
      name: item.name,
      art: (
        <>
          <ItemStage item={item} />
          <PriceRiseTag rise={item.priceRise} corner />
        </>
      ),
      confirm: <BuyLabel price={price} />,
      gift: () => doGift(item, from),
      run: async () => {
        if (price > balanceRef.current) {
          openPackNeed({ target: price, from: 'item', title: item.name })
          return null
        }
        setBusy(item.code)
        try {
          const res = await buyShopCard(item.code, from, undefined, price)
          result(true)
          setDay((d) => (d ? { ...d, balance: res.balance } : d))
          void reloadShop()
          after?.()
          const got = res.granted[0] ?? item
          return { onWear: () => wearItems([got]) }
        } catch (e) {
          result(false, 'error', e)
          showToast(apiErrorText(e, err()), 'error')
          throw e
        } finally {
          setBusy('')
        }
      },
    })
    // Расцветка карточки — по коду; если в каталоге её нет под этим кодом, карточкой считается первая.
    const cardAt = Math.max(0, ways.findIndex((w) => w.id === card.item.code))
    // Расцветка без цены службы (не продаётся, уже куплена, служба не ответила) в окно не попадает.
    const toneList = ways.flatMap((w, i) => {
      if (i === cardAt) return [{ color: w.variants?.[0]?.color ?? null, title: w.name, view: () => view(card.item, card.price, source) }]
      const price = quoted?.get(w.id)
      if (price == null) return []
      const item = { ...card.item, code: w.id, name: w.name, rarity: (w.rarity as ItemRef['rarity'] | undefined) ?? card.item.rarity, preview: w.preview ?? card.item.preview }
      return [{ color: w.variants?.[0]?.color ?? null, title: w.name, view: () => view(item, price, 'wardrobe') }]
    })
    const tones = toneList.length > 1 ? toneList : undefined
    openSheet({
      kind: 'item',
      ...view(card.item, card.price, source),
      onCancel: () => result(false, 'cancel'),
      tones,
    })
  }

  /** Набор: окно с набором на игроке, после оплаты — вспышка и «Надеть». */
  const doBuySet = (set: SetView, way: SetColorwayView) => {
    if (!signedIn) return showLogin()
    if (!payablePrice(way.price)) {
      showToast(t('Цена набора ещё не пришла — обновляю магазин'), 'error')
      void reloadSets()
      return
    }
    const result = purchaseFlow('bundle', set.id + (way.name ? '~' + way.name : ''), way.price, 'rubies')
    if (short(way.price, result, { from: 'set', title: set.title })) return
    const all = way.items.map((x) => x.item)
    openSheet({
      kind: 'set',
      name: set.title,
      tone: THEME_TONE[set.theme],
      art: <ShopStage on items={all} />,
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
          showToast(apiErrorText(e, err()), 'error')
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
    if (!signedIn) return showLogin()
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
        return showToast(t('Не хватает осколков'), 'error')
      }
    } else if (short(price, result, { from: 'case' })) return
    openSheet({
      kind: 'case',
      name: mode === 'x10' ? c.title + ' ×10' : c.title,
      tone: caseHex(c),
      art: <CaseArt view={c} size={230} />,
      confirm: shards ? (
        <>
          {t('Открыть')}
          <Shard size={18} />
          {price.toLocaleString(intlTag())}
        </>
      ) : (
        <BuyLabel verb={mode === 'x10' ? t('Открыть ×10') : t('Открыть')} price={price} />
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
      else showReward({ level: 'small', items: [{ name: t('Осколки'), icon: 'shard' }], title: '+' + g.amount })
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      showToast(apiErrorText(e, err()), 'error')
    } finally {
      setBusy('')
    }
  }

  /**
   * «Проверить» у задания «подпишись / вступи». Исход возвращается экрану, а не
   * тостом: плитка сама показывает, что не так, рядом с кнопкой (26.10.2026).
   */
  const claimTask = async (kind: TaskKind): Promise<{ granted: boolean; amount: number } | { failure: TaskFailure }> => {
    const tg = kind === 'telegram'
    setBusy(kind)
    try {
      const res = await (tg ? claimTelegramReward() : claimDiscordReward())
      if (tg) setTelegram(res as TelegramReward)
      else setDiscord(res as DiscordReward)
      if (res.balance !== null) {
        const balance = res.balance
        setDay((d) => (d ? { ...d, balance } : d))
      }
      // Награду показывает сама плитка («Начислено» и +300), а счёт в шапке подпрыгивает:
      // отдельная плашка сверху повторяла бы то же самое второй раз.
      if (res.granted) {
        window.clearTimeout(bumpTimer.current)
        setBump(true)
        bumpTimer.current = window.setTimeout(() => setBump(false), 600)
      }
      return { granted: res.granted, amount: res.amount }
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      // Сервер мог сам сказать «сначала привяжи»: свежий вид вернёт плитку на шаг привязки.
      if (tg) void loadTelegramReward().then(setTelegram).catch(noted('shop-tasks'))
      else void loadDiscordReward().then(setDiscord).catch(noted('shop-tasks'))
      return { failure: claimFailure(e) }
    } finally {
      setBusy('')
    }
  }

  const relinkTelegram = async (): Promise<boolean> => {
    setBusy('telegram')
    try {
      await unlinkTelegram()
      setTelegram((was) => (was ? { ...was, linked: false, linkedAs: null } : was))
      void loadTelegramReward().then(setTelegram).catch(noted('shop-tasks'))
      return true
    } catch (e) {
      trackFailure('shop', e, { step: 'tg_relink' })
      showToast(apiErrorText(e, t('Не получилось отвязать Telegram, попробуй ещё раз')), 'error')
      return false
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
      showToast(apiErrorText(e, err()), 'error')
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
    if (!signedIn) return showLogin()
    const choice = (tier: PlusTier) => ({
      key: tier.toLowerCase(),
      tone: tier === 'DIAMOND' ? 'var(--m-rarity-rare)' : 'var(--m-rarity-legendary)',
      art: <PlanCard tier={tier} />,
      confirm: <>{(tier === 'DIAMOND' ? 'Diamond ' : 'PLUS ') + (plusPrice(tier) ?? '')}</>,
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
    if (!signedIn) return showLogin()
    useUi.getState().setScreen('plus')
  }

  const doWalletTopUp = (s: MoneyShortfall) => {
    if (!signedIn) return showLogin()
    openTopup(s.topup)
    showToast(s.topup ? t('Пополни счёт на {sum} и вернись за пакетом', { sum: formatMoney(s.topup.amountMinor, s.topup.currency) }) : shortfallText(s), 'ok')
  }

  /**
   * Пакет: окно с мешком рубинов, после оплаты рубины досчитываются. `picked` —
   * покупка через окно выбора пакета: после успеха пишем pack_bought и, если
   * копили на вещь, предлагаем её купить, как только баланса хватит.
   */
  const doPack = async (pack: ShopPack, art: string, promo: PackPromo | null = null, picked?: { recommended: boolean; target: number; item?: PackNeed['item'] }) => {
    if (!signedIn) return showLogin()
    const result = purchaseFlow('ruby_pack', pack.code, promo?.kopecks ?? pack.kopecks, 'kopecks')
    const quote = promo ? (isQuote(promo.quote) ? promo.quote : scaleQuote(rubyQuote(pack.code), pack.kopecks, promo.kopecks)) : rubyQuote(pack.code)
    let missing: MoneyShortfall | null = null
    if (affords(quote) === false) {
      await refreshMoney()
      missing = shortfallFor(quote)
    }
    openSheet({
      kind: missing ? 'topup' : 'pack',
      art: (
        <span className="bs-pack">
          <PackArt src={art} size="lg" />
          <PackCount n={pack.rubies} />
        </span>
      ),
      confirm: missing?.topup
        ? t('Пополнить {sum}', { sum: formatMoney(missing.topup.amountMinor, missing.topup.currency) })
        : ((promo ? quoteText(quote) : rubyPackPrice(pack.code, pack.kopecks)) ?? ''),
      extra: <PackPromoField key={promo?.code ?? ''} pack={pack.code} applied={promo} onApplied={(next) => void doPack(pack, art, next, picked)} />,
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
          const res = await buyPack(pack.code, promo?.code)
          result(true)
          if (promo) forgetPackPromo()
          setDay((d) => (d ? { ...d, balance: res.balance } : d))
          if (picked) {
            track('pack_bought', { pack: pack.code, recommended: picked.recommended, left: res.balance - picked.target })
            if (picked.item) pendingBuy.current = picked.item
          }
          // «Второй шаг» открывается первой оплатой: служба отдаёт его в свежей витрине, предлагаем прямо в окне с рубинами.
          const fresh = pack.code === 'second' ? null : await reloadShop()
          const second = fresh?.secondOffer
          return {
            rubies: { from, to: res.balance },
            ...(second
              ? {
                  next: {
                    label: t('{title}: {n} за {price}', {
                      title: second.title,
                      n: second.rubies.toLocaleString(intlTag()),
                      price: rubyPackPrice(second.code, second.kopecks) ?? '',
                    }),
                    onClick: () => void doPack(second, SECOND_ART),
                  },
                }
              : {}),
          }
        } catch (e) {
          const miss = moneyShortfall(e)
          result(false, miss ? 'insufficient' : 'error', e)
          if (miss) doWalletTopUp(miss)
          else showToast(apiErrorText(e, err()), 'error')
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
    const reload = () => void loadWorkshop().then(setWorkshop).catch(() => undefined)
    window.addEventListener(SHARDS_CHANGED, reload)
    return () => window.removeEventListener(SHARDS_CHANGED, reload)
  }, [on, signedIn])
  /** Осколки → половина фрагментов вещи; остаток докупается рубинами. */
  const doCraft = (w: { item: ItemRef; cost: number }) => {
    if (!signedIn) return showLogin()
    if (workshop && w.cost > workshop.shards) return showToast(t('Не хватает осколков'), 'error')
    const result = purchaseFlow('craft', w.item.code, w.cost, 'shards')
    openSheet({
      kind: 'craft',
      // The exchange pays half of the fragments, not the item: without saying so
      // players reported shards taken and nothing given.
      name: t('{name} — половина фрагментов', { name: w.item.name }),
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
          void reloadShop()
          window.dispatchEvent(new Event(FRAGMENTS_CHANGED))
          const got = res.fragments
          if (!got || got.have >= got.need) return { onWear: () => wearItems([res.item]) }
          // Вещь не собрана: окно не закрывается молча (17.11.2026: «осколки списались,
          // кигуруми нет»), а показывает, сколько собрано и как дособрать.
          const price = got.topUp ?? fragmentTopUp(w.item.rarity, got.have)
          const rest = price > 0 ? { item: res.item, topUp: price } : null
          return {
            art: (
              <div className="sd-got">
                <ItemShot item={w.item} big />
                <b>{t('+{n} {word} · {have} из {need}', { n: got.amount, word: fragmentWord(got.amount), have: got.have, need: got.need })}</b>
                <FragBar have={got.have} need={got.need} rarity={w.item.rarity} gain={got.amount} />
                <span>{t('Вещь соберётся, когда наберутся все фрагменты. Остаток можно докупить за рубины.')}</span>
                {rest ? (
                  <button className="btn md primary" data-track="craft_result_topup" onClick={() => doTopUpFragments(rest)}>
                    {t('Докупить')}
                    <Ruby size={16} />
                    {rest.topUp.toLocaleString(intlTag())}
                  </button>
                ) : null}
              </div>
            ),
          }
        } catch (e) {
          result(false, 'error', e)
          showToast(apiErrorText(e, err()), 'error')
          throw e
        } finally {
          setBusy('')
        }
      },
    })
  }

  /** Дособрать начатую вещь за рубины: с карточки «За осколки» и из итога обмена. */
  const doTopUpFragments = async (f: { item: ItemRef; topUp?: number }) => {
    if (!signedIn) return showLogin()
    if (!f.topUp || f.topUp <= 0) return
    useBuySheet.getState().close()
    setBusy(f.item.code)
    try {
      const res = await topUpFragments(f.item, f.topUp)
      if (!res) return
      setDay((d) => (d ? { ...d, balance: res.balance } : d))
      loadWorkshop().then(setWorkshop).catch(() => undefined)
      void reloadShop()
      void refreshMoney()
      window.dispatchEvent(new Event(FRAGMENTS_CHANGED))
      const got = res.granted.length ? res.granted : [f.item]
      showToast(t('{name} собрана', { name: f.item.name }), 'ok', undefined, { label: t('Надеть'), run: () => wearItems(got) })
    } finally {
      setBusy('')
    }
  }


  /** Пополнение покрыло цену вещи, ради которой копили, — сразу предлагаем её купить. */
  useEffect(() => {
    const p = pendingBuy.current
    if (!p || !day || balance < p.card.price) return
    pendingBuy.current = null
    void doBuy(p.card, p.source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance, !!day])

  /** «Теперь хватает»: баланс вырос не покупкой и покрыл вещь из «Хочу»/дня. */
  const prevBal = useRef<number | null>(null)
  useEffect(() => {
    if (!day) return
    const was = prevBal.current
    prevBal.current = balance
    // Первый баланс дня — только базовая точка: рост с нуля при загрузке магазина не считается.
    if (was === null || balance <= was || pendingBuy.current || !affordNoticeOn() || affordNoticedToday(day.day.refreshAt)) return
    const hit = nowAffordable(day, was)
    if (!hit) return
    markAffordNoticed(day.day.refreshAt)
    track('afford_notice_shown', { item: hit.card.item.code })
    showToast(t('Теперь хватает на «{name}»', { name: hit.card.item.name }), 'ok', undefined, {
      label: t('Посмотреть'),
      run: () => {
        track('afford_notice_click', { item: hit.card.item.code })
        useShopGift.getState().setTab('today')
        useUi.getState().setScreen('rubies')
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balance, !!day])

  /** Покупка из окна выбора пакета: ведёт через то же окно подтверждения, что и пакет. */
  const doNeedBuy = (option: PickOption, need: PackNeed, recommended: boolean) =>
    void doPack(option.pack, option.art, null, { recommended, target: need.target, item: need.item })

  const todayActs: TodayActs = { balance, busy, sub: !!tier, onBuy: (card, source) => void doBuy(card, source), onWear: (it) => wearItems([it]) }
  const doBuySetItem = (item: ItemRef, price: number) =>
    void doBuy({ item, price, basePrice: price, discountPct: 0, owned: false, leavesAt: '' }, 'wardrobe', () => void reloadSets())
  const setActs: SetActs = { balance, busy, onBuy: doBuySet, onWear: doWearSet, sub: !!tier, onBuyItem: doBuySetItem }
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
      ? { rubies: PLUS_PASS.rubies, label: t('Продлить Diamond'), onOpen: doManage, sub: true, diamond: true }
      : tier === 'PLUS'
        ? { rubies: PLUS_PASS.rubies, label: 'Diamond · ' + (plusPrice('DIAMOND') ?? ''), onOpen: () => doPlus('DIAMOND'), sub: true, diamond: true }
        : {
            rubies: PLUS_PASS.rubies,
            label: t('Купить · {price}', { price: plusPrice('PLUS') ?? '' }),
            onOpen: () => doPlus('PLUS'),
            prices: { PLUS: plusPrice('PLUS') ?? '', DIAMOND: plusPrice('DIAMOND') ?? '' },
            onPick: (picked: PlusTier) => doPlus(picked),
          }
    : undefined


  return {
    on, signedIn, day, setDay, rules, busy, plus, tier, balance, error, bump, sets, setsAt, cases, drops, casesAt, ofDayPct, opening, setOpening, caseResult,
    weekly, quests, telegram, discord, workshop, habit, order, dayCase, daySet, plusTile, todayActs, setActs, scrollTo, toPacks,
    reloadShop, reloadSets, reloadCases, doOpenCase, doWeekly, doPackQuest, claimTask, relinkTelegram, doPlus, doManage, doPack, doCraft, doNeedBuy, doTopUpFragments,
  }
}

export type Shop = ReturnType<typeof useShop>

/** Срок подписки «дд.мм» по Москве для чипа. */
export const plusUntil = (plus: { paidUntil?: string | null } | null | undefined): string =>
  plus?.paidUntil ? new Date(plus.paidUntil).toLocaleDateString(intlTag(), { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' }) : ''

/** «◇ 450» — главная кнопка покупки за осколки. */
function ShardLabel({ n }: { n: number }) {
  const t = useT()
  return (
    <>
      {t('Обменять')}
      <Shard size={18} />
      {n.toLocaleString(intlTag())}
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
  const t = useT()
  const { on, day, plus, busy, tier, balance, sets, setsAt, cases, drops, casesAt, ofDayPct, opening, weekly, quests, telegram, discord, plusTile, todayActs, setActs } = s
  const { reloadShop, reloadSets, doOpenCase, doWeekly, doPackQuest, claimTask, relinkTelegram, doPlus, doManage, doPack } = s
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
              {t('Пополнить рубины')}
            </h2>
            {chip ? <PlusChip tier={tier} until={plusUntil(plus)} onClick={tier ? doManage : () => doPlus('PLUS')} /> : null}
            {/* Баланс — в шапке магазина; здесь только в гардеробе, где своей шапки магазина нет. */}
            {chip ? (
              <span className="sh-bal pk-bal">
                <Ruby size={18} />
                <b>{balance.toLocaleString(intlTag())}</b>
              </span>
            ) : null}
          </div>
          <Guard what="Рубины" silent>
            <Packs
              packs={day.packs}
              plusTile={plusTile}
              busy={busy}
              onBuy={(p, art) => void doPack(p, art)}
              second={day.secondOffer}
              onSecond={day.secondOffer ? () => void doPack(day.secondOffer!, SECOND_ART) : undefined}
              onOfferEnd={() => void reloadShop()}
            />
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

        <ShortfallBar day={day} />

        <Guard what="Коллекции" silent>
          <CollectionsSection acts={todayActs} />
        </Guard>

        <Guard what="Скидки дня" silent>
          <TodaySection day={day} acts={todayActs} onEnd={() => void reloadShop()} />
        </Guard>

        <Guard what="В тренде" silent>
          <TrendSection acts={todayActs} />
        </Guard>

        <Guard what="Бонусы" silent>
          <BonusesSection on={on} />
        </Guard>

        <Guard what="Задания Telegram и Discord" silent>
          <SocialTasks telegram={telegram} discord={discord} busy={busy} onClaim={claimTask} onRelink={relinkTelegram} />
        </Guard>

        <Guard what="Наборы" silent>
          <SetsSection sets={sets} refreshAt={setsAt} on={on} onEnd={() => void reloadSets()} acts={setActs} />
        </Guard>

        <Guard what="Ящики" silent>
          <CasesSection cases={cases} drops={drops} refreshAt={casesAt || undefined} ofDayPct={ofDayPct} balance={balance} busy={!!opening} sub={!!tier} onOpen={doOpenCase} />
        </Guard>

        {s.workshop ? (
          <Guard what="За осколки" silent>
            <ShardsSection data={s.workshop} busy={busy} onCraft={s.doCraft} onTopUp={s.doTopUpFragments} showBalance={chip} />
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
  const t = useT()
  const { on, day, busy, opening, setOpening, balance, setDay, caseResult, toPacks, reloadCases, reloadSets, doNeedBuy } = s
  if (!on) return null
  return (
    <>
      <BuySheetHost />
      <GiftPickerHost />
      {day ? <PackPicker day={day} busy={busy} onBuy={doNeedBuy} /> : null}
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
              showToast(t('Не хватает рубинов'), 'error')
              return toPacks()
            }
            caseResult.current?.(false, 'error', e)
            caseResult.current = null
            showToast(apiErrorText(e, err()), 'error')
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
