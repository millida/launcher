import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { Ruby } from '../components/Ruby'
import { hasMillidaAccount, openExt, PLUS_MANAGE_URL, WALLET_URL } from '../lib/api'
import { apiErrorText } from '../lib/apiError'
import {
  buyPack,
  buyShopCard,
  buyXray,
  claimPlusMonth,
  claimWeekly,
  craftItem,
  loadEconomyProgress,
  loadPlusEconomy,
  loadRules,
  loadShopDay,
  loadWorkshop,
  pickPlusMigration,
  rubles,
  wishItem,
  type EconomyProgress,
  type ItemRef,
  type PlusEconomy,
  type Rules,
  type ShopCard,
  type ShopDay,
  type ShopPack,
  type ShopSource,
  type WeeklyParcel,
  type Workshop,
  type XrayOffer,
} from '../lib/rubies'
import { loadCosmeticCatalog } from '../lib/gameProfile'
import { useAccounts } from '../state/accounts'
import { showToast } from '../state/ui'
import { showReward, type RewardEntry } from '../components/reward/RewardReveal'
import { logoutToLogin } from '../lib/session'
import { Guard } from '../components/Guard'
import { uiConfirm } from '../state/confirm'
import { Packs, topUpKopecks } from '../components/shop/Packs'
import { rarityOfPrice, shardWord, word } from '../components/shop/rarity'
import { Shard } from '../components/shop/parts'
import { ForYou, Showcase, type BuyProps } from '../components/shop/Storefront'
import { NightMarket } from '../components/shop/NightMarket'
import { XrayCard, XrayOpening } from '../components/shop/Xray'
import { ParcelBlock, PathBlock, WeeklyPathBlock, WorkshopBlock } from '../components/shop/Earn'
import { boostWeekly, claimWeeklyStep, loadWeeklyAny, type WeeklyPath } from '../components/shop/weekly'
import { MigrationModal, migrationLeft, PlusMonth } from '../components/shop/PlusMonth'
import { useShopGift } from '../components/shop/giftState'
import { PassBody } from '../components/daily/DailyPassModal'
import { Wishlist } from '../components/shop/Wishlist'
import { CreatorCode } from '../components/shop/CreatorCode'
import { buyExact, kopecksFor, wishesFromShop, type WishEntry, type WishList } from '../components/shop/wish'
import { useDaily } from '../state/daily'
import { purchaseFlow } from '../lib/purchaseTrack'
import { trackFailure } from '../lib/telemetry'
import '../styles/pixel/shop-juice.css'
import { wearNow } from '../state/wearIntent'

/** Пакеты для гостя — те же пять, что в магазине дня (модель экономики 23.09.2026). */
const GUEST_PACKS = ['handful', 'pouch', 'casket', 'hoard', 'trove']

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
/** Окно выбора старого набора PLUS уже открывалось само в этом запуске. */
let migAsked = false

const entry = (it: ItemRef): RewardEntry => ({ name: it.name, preview: it.preview, rarity: it.rarity })
/** «Надеть» из награды — сразу на фигуру (владелец 24.09.2026, 19:56). */
const wearItems = (list: ItemRef[]) => wearNow(list.map((it) => ({ code: it.code, variant: it.variant })))

/**
 * Магазин (экономика вещей 23.09.2026, как Item Shop в Fortnite + магазин
 * Brawl Stars). Две вкладки: «Витрина» — всё, что покупается, и «За игру» —
 * то, что только зарабатывается (недельный путь, мастерская, плащи за часы,
 * достижения, бесплатные сундуки).
 *
 * Красные линии модели: без «купи сейчас», без случайности за деньги
 * (рентген-кейс показывает вещь до оплаты), без платных перебросов ночного
 * рынка. Таймеры — по прямой просьбе владельца 23.09.2026, спокойные: серые,
 * без секунд и без красного.
 *
 * Раскладка — одна сетка 8/4/2 клетки на весь магазин (shop.css, «Сетка
 * магазина»): все карточки одного размера, ряды всегда полные.
 */
export function Rubies({ on }: { on: boolean }) {
  const signedIn = hasMillidaAccount()
  const walletBal = useAccounts((st) => st.list).find((a) => a.kind === 'millida' || a.kind === 'tg')?.balance
  const walletKopecks = walletBal ?? 0
  /** Баланс счёта пришёл: только тогда пакету можно сказать «не хватает». */
  const walletKnown = typeof walletBal === 'number'
  // Куда прокрутить ленту (тост «Из "Хочу" на витрине» → к «Хочу», «Пополнить» → к пакетам).
  const anchor = useShopGift((st) => st.tab)
  const [day, setDay] = useState<ShopDay | null>(null)
  const [workshop, setWorkshop] = useState<Workshop | null>(null)
  const [weekly, setWeekly] = useState<WeeklyPath | null>(null)
  const [parcel, setParcel] = useState<WeeklyParcel | null>(null)
  const [progress, setProgress] = useState<EconomyProgress | null>(null)
  const [plus, setPlus] = useState<PlusEconomy | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [catalog, setCatalog] = useState<Map<string, ItemRef>>(new Map())
  const [wishes, setWishes] = useState<WishList | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [xray, setXray] = useState<{ tier: XrayOffer['tier']; item: ItemRef | null } | null>(null)
  const [migOpen, setMigOpen] = useState(false)
  /** Счётчик в шапке «подпрыгивает», когда в него прилетела награда бонуса. */
  const [bump, setBump] = useState<{ rubies?: boolean; shards?: boolean }>({})
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

  /**
   * «Хочу» собирается на клиенте из магазина дня, мастерской и каталога: ручки
   * /rubies/wishlist у службы нет, запрос давал 404 на каждый заход (QA 2.0.1).
   */
  const reloadWishes = (d: ShopDay | null = day, w: Workshop | null = workshop) => {
    if (d) setWishes(wishesFromShop(d, w, catalog))
  }

  useEffect(() => {
    if (!on) return
    loadRules().then(setRules).catch(() => setRules(null))
    if (!signedIn) return
    void useDaily.getState().load()
    void reloadShop().then((d) => {
      if (d) useShopGift.getState().seeWishes(d)
    })
    loadWorkshop().then(setWorkshop).catch(() => setWorkshop(null))
    loadWeeklyAny()
      .then((w) => {
        setWeekly(w?.path ?? null)
        setParcel(w?.parcel ?? null)
      })
      .catch(() => {
        setWeekly(null)
        setParcel(null)
      })
    loadEconomyProgress()
      .then((p) => setProgress(Array.isArray(p.hourItems) ? p : null))
      .catch(() => setProgress(null))
    loadPlusEconomy().then(setPlus).catch(() => setPlus(null))
  }, [on, signedIn])

  // Каталог нужен только запасному «Хочу» (старая служба отдаёт одни коды).
  const wishlist = day?.wishlist ?? []
  useEffect(() => {
    if (!on || !wishlist.length || catalog.size) return
    loadCosmeticCatalog()
      .then((r) =>
        setCatalog(
          new Map(
            r.items.map((x) => [
              x.id,
              { code: x.id, name: x.name, slot: x.slot, rarity: rarityOfPrice(x.priceRubies ?? 0), preview: x.preview ?? null },
            ]),
          ),
        ),
      )
      .catch(() => undefined)
  }, [on, wishlist.length])

  // «Хочу» пересобирается, когда меняется магазин, мастерская или список.
  useEffect(() => {
    if (!on || !day) return
    reloadWishes(day, workshop)
  }, [on, day, workshop, catalog])

  useEffect(() => () => window.clearTimeout(bumpTimer.current), [])

  // Бывшему подписчику окно выбора вещей старого набора открывается само — один
  // раз за запуск; дальше — кнопкой «Выбрать» в блоке PLUS.
  const migLeft = migrationLeft(plus)
  useEffect(() => {
    if (!on || migLeft <= 0 || migAsked) return
    migAsked = true
    setMigOpen(true)
  }, [on, migLeft])

  const balance = day?.balance ?? 0
  const shards = workshop?.shards ?? day?.shards ?? 0

  const toPacks = () => document.getElementById('shopPacks')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Прокрутка по просьбе снаружи — один раз, потом якорь сбрасывается.
  useEffect(() => {
    if (!on || !day || anchor === 'today') return
    const id = anchor === 'wish' ? 'shop-wish' : anchor === 'rubies' ? 'shopPacks' : 'shop-today'
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    useShopGift.getState().setTab('today')
  }, [on, anchor, !!day, !!wishes])

  /**
   * Бонус забран (пасс в ленте): рубины и осколки — сразу в шапку, счётчики
   * подпрыгивают; сундук из клетки открывается сам, одним раскрытием, когда
   * закончится раскрытие наград пасса.
   */
  const lastClaim = useRef<typeof claimed>(null)
  useEffect(() => {
    if (!claimed || claimed === lastClaim.current) return
    lastClaim.current = claimed
    const got = claimed.granted ?? []
    const rub = got.reduce((n, g) => n + (g.kind === 'RUBIES' ? g.amount : 0), 0)
    const sh = got.reduce((n, g) => n + (g.kind === 'SHARDS' ? g.amount : 0), 0)
    if (rub) setDay((d) => (d ? { ...d, balance: d.balance + rub } : d))
    if (sh) setWorkshop((w) => (w ? { ...w, shards: Math.min(w.cap, w.shards + sh) } : w))
    if (got.some((g) => g.kind === 'CHEST')) void useDaily.getState().load()
    window.clearTimeout(bumpTimer.current)
    bumpTimer.current = window.setTimeout(() => {
      setBump({ rubies: rub > 0, shards: sh > 0 })
      bumpTimer.current = window.setTimeout(() => setBump({}), 600)
    }, 400)
  }, [claimed])
  // Сундуки больше не открываются сами при заходе: они копятся в «Моих
  // сундуках» и открываются по нажатию (владелец 24.09.2026).

  /** Таймер дошёл до нуля: витрина сменилась — спросить заново. */
  const reload = () => void reloadShop()

  /** Покупка всегда через подтверждение; нехватка — честной строкой и к пакетам. */
  const doBuy = async (card: ShopCard, source: ShopSource) => {
    if (!signedIn) return logoutToLogin()
    const result = purchaseFlow('item', card.item.code, card.price, 'rubies')
    if (card.price > balance) {
      result(false, 'insufficient')
      showToast('Не хватает ' + (card.price - balance) + ' ' + word(card.price - balance), 'error')
      return toPacks()
    }
    const ok = await uiConfirm(card.item.name + ' за ' + card.price.toLocaleString('ru-RU') + ' ' + word(card.price), {
      title: 'Купить вещь',
      confirmLabel: 'Купить',
      danger: false,
    })
    if (!ok) return result(false, 'cancel')
    setBusy(card.item.code)
    try {
      const res = await buyShopCard(card.item.code, source)
      result(true)
      setDay((d) => (d ? { ...d, balance: res.balance } : d))
      await reloadShop()
      showReward({ items: [entry(res.granted[0] ?? card.item)], onWear: () => wearItems([res.granted[0] ?? card.item]) })
    } catch (e) {
      result(false, 'error', e)
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }


  const doWish = async (code: string, next: boolean) => {
    // Сердце откликается сразу, ответ службы его только подтверждает.
    setDay((d) => (d ? { ...d, wishlist: next ? [...d.wishlist.filter((c) => c !== code), code] : d.wishlist.filter((c) => c !== code) } : d))
    try {
      const res = await wishItem(code, next)
      setDay((d) => (d ? { ...d, wishlist: res.wishlist } : d))
      if (next) showToast('В «Хочу». Вернётся — напомним', 'ok')
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      showToast(apiErrorText(e, ERR), 'error')
      void reloadShop()
    }
  }

  const doXray = async (offer: XrayOffer) => {
    const result = purchaseFlow('xray', offer.id, offer.price, 'rubies')
    if (offer.price > balance) {
      result(false, 'insufficient')
      showToast('Не хватает ' + (offer.price - balance) + ' ' + word(offer.price - balance), 'error')
      return toPacks()
    }
    const ok = await uiConfirm(offer.item.name + ' за ' + offer.price.toLocaleString('ru-RU') + ' ' + word(offer.price), {
      title: 'Открыть кейс',
      confirmLabel: 'Купить и открыть',
      danger: false,
    })
    if (!ok) return result(false, 'cancel')
    setBusy(offer.id)
    setXray({ tier: offer.tier, item: null })
    try {
      const res = await buyXray(offer.id)
      result(true)
      setDay((d) => (d ? { ...d, balance: res.balance } : d))
      setXray({ tier: offer.tier, item: res.item })
    } catch (e) {
      result(false, 'error', e)
      setXray(null)
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  const doCraft = async (w: { item: ItemRef; cost: number }) => {
    const result = purchaseFlow('craft', w.item.code, w.cost, 'shards')
    const ok = await uiConfirm(w.item.name + ' за ' + w.cost.toLocaleString('ru-RU') + ' осколков', {
      title: 'Собрать вещь',
      confirmLabel: 'Собрать',
      danger: false,
    })
    if (!ok) return result(false, 'cancel')
    setBusy(w.item.code)
    try {
      const res = await craftItem(w.item.code)
      result(true)
      setWorkshop((was) =>
        was
          ? {
              ...was,
              shards: res.shards,
              workshop: { ...was.workshop, items: was.workshop.items.map((x) => (x.item.code === w.item.code ? { ...x, owned: true } : x)) },
            }
          : was,
      )
      showReward({ items: [entry(res.item)], kicker: 'Мастерская', onWear: () => wearItems([res.item]) })
    } catch (e) {
      result(false, 'error', e)
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  const doWeekly = async (at: number) => {
    setBusy('weekly')
    try {
      const res = await claimWeeklyStep(at)
      setWeekly(res.path)
      setDay((d) => (d ? { ...d, balance: res.balance, shards: res.shards } : d))
      setWorkshop((w) => (w ? { ...w, shards: res.shards } : w))
      const g = res.granted
      if (g.kind === 'ITEM') showReward({ items: [entry(g.item)], kicker: 'Недельный путь', onWear: () => wearItems([g.item]) })
      else showReward({ level: 'small', items: [{ name: 'Осколки', icon: 'shard' }], title: '+' + g.amount + ' ' + shardWord(g.amount) })
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  /** Посылка недели: одна вещь из трёх, навсегда. */
  const doParcel = async (item: ItemRef) => {
    setBusy('weekly')
    try {
      const res = await claimWeekly(item.code)
      setParcel((p) => (p ? { ...p, ready: false, choices: null, claimedAt: new Date().toISOString() } : p))
      showReward({ items: [entry(res.item ?? item)], kicker: 'Посылка недели', onWear: () => wearItems([res.item ?? item]) })
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  /** Докупить последние звёзды пути: цена у кнопки, подтверждение — всегда. */
  const doWeeklyBoost = async (stars: number) => {
    const b = weekly?.boost
    if (!b) return
    const result = purchaseFlow('weekly_boost', String(stars), b.price, 'rubies')
    if (b.price > balance) {
      result(false, 'insufficient')
      showToast('Не хватает ' + (b.price - balance) + ' ' + word(b.price - balance), 'error')
      return toPacks()
    }
    const ok = await uiConfirm(stars + ' зв. за ' + b.price.toLocaleString('ru-RU') + ' ' + word(b.price), {
      title: 'Докупить звёзды',
      confirmLabel: 'Докупить',
      danger: false,
    })
    if (!ok) return result(false, 'cancel')
    setBusy('weekly-boost')
    try {
      const res = await boostWeekly(stars)
      result(true)
      setWeekly(res.path)
      setDay((d) => (d ? { ...d, balance: res.balance } : d))
      showReward({
        level: 'mid',
        items: [{ name: 'Звёзды', icon: 'star' }],
        kicker: 'Недельный путь',
        title: 'Путь пройден',
        sub: 'Забирай вещь',
      })
    } catch (e) {
      result(false, 'error', e)
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  /** Подписка оформляется на странице шлюза: там платят, а не в лаунчере. */
  // Сначала карточка PLUS с ценой и подтверждением, оплата — только из неё
  // (разбор оплаты 24.09.2026: прямой переход в браузер ронял конверсию).
  const doPlus = async () => {
    if (!signedIn) return logoutToLogin()
    useDaily.getState().setPlusCard(true)
  }
  const doPlusMonth = async () => {
    setBusy('plus-month')
    try {
      const res = await claimPlusMonth()
      setPlus((p) => (p && p.month ? { ...p, month: { ...p.month, claimed: true } } : p))
      showReward({
        items: res.items.map(entry),
        kicker: 'PLUS',
        title: res.items.length > 1 ? 'Вещи месяца' : undefined,
        tone: 'var(--m-rarity-legendary)',
        onWear: () => wearItems(res.items),
      })
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  const doMigrate = async (codes: string[]) => {
    setBusy('migration')
    try {
      const res = await pickPlusMigration(codes)
      setPlus((p) => (p && p.migration ? { ...p, migration: { ...p.migration, picked: [...p.migration.picked, ...codes] } } : p))
      setMigOpen(false)
      showReward({
        items: res.granted.map(entry),
        kicker: 'PLUS',
        title: 'Навсегда твои',
        sub: res.granted.length > 1 ? res.granted.length + ' вещи' : undefined,
        tone: 'var(--m-rarity-legendary)',
        onWear: () => wearItems(res.granted),
      })
    } catch (e) {
      trackFailure('shop', e, { step: 'action' })
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  /**
   * Пополнить счёт Millida на недостающее (правка владельца 24.09.2026). Сайт
   * пока не принимает сумму в ссылке — открываем тот же кошелёк, что и раньше
   * (WALLET_URL), а сумму говорим тостом.
   */
  const doWalletTopUp = (missingKopecks: number) => {
    if (!signedIn) return logoutToLogin()
    openExt(WALLET_URL)
    showToast('Пополни счёт на ' + rubles(missingKopecks) + ' и вернись за пакетом', 'ok')
  }

  const doPack = async (pack: ShopPack) => {
    if (!signedIn) return logoutToLogin()
    const result = purchaseFlow('ruby_pack', pack.code, pack.kopecks, 'kopecks')
    const short = walletKnown ? topUpKopecks(pack.kopecks - walletKopecks) : 0
    if (short > 0) {
      result(false, 'insufficient')
      return doWalletTopUp(short)
    }
    const ok = await uiConfirm(pack.rubies.toLocaleString('ru-RU') + ' ' + word(pack.rubies) + ' за ' + rubles(pack.kopecks), {
      title: 'Оплатить ' + pack.title,
      confirmLabel: 'Оплатить',
      danger: false,
    })
    if (!ok) return result(false, 'cancel')
    setBusy(pack.code)
    try {
      const res = await buyPack(pack.code)
      result(true)
      setDay((d) => (d ? { ...d, balance: res.balance } : d))
      showReward({
        level: 'mid',
        items: [{ name: 'Рубины', rubies: res.rubies }],
        title: 'Начислено',
        sub: res.rubies.toLocaleString('ru-RU') + ' ' + word(res.rubies),
      })
    } catch (e) {
      // Служба (fix/payments): 400 {status:'insufficient_funds', missingKopecks}.
      const miss = insufficientKopecks(e)
      result(false, miss !== null ? 'insufficient' : 'error', e)
      if (miss !== null) doWalletTopUp(topUpKopecks(miss || pack.kopecks - walletKopecks) || pack.kopecks)
      else showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }

  /**
   * «Докупить недостающее» из «Хочу»: ровно столько рубинов, сколько не
   * хватает, по базовому курсу — без пакета с остатком (принцип 3 CPC ЕС).
   */
  const doTopUp = async (rubies: number) => {
    if (!signedIn) return logoutToLogin()
    const result = purchaseFlow('ruby_topup', String(rubies), kopecksFor(rubies), 'kopecks')
    const ok = await uiConfirm(rubies.toLocaleString('ru-RU') + ' ' + word(rubies) + ' за ' + rubles(kopecksFor(rubies)), {
      title: 'Докупить недостающее',
      confirmLabel: 'Оплатить',
      danger: false,
    })
    if (!ok) return result(false, 'cancel')
    setBusy('topup')
    try {
      const res = await buyExact(rubies)
      result(true)
      setDay((d) => (d ? { ...d, balance: res.balance } : d))
      showReward({
        level: 'mid',
        items: [{ name: 'Рубины', rubies: res.rubies }],
        title: 'Начислено',
        sub: res.rubies.toLocaleString('ru-RU') + ' ' + word(res.rubies),
      })
    } catch (e) {
      result(false, 'error', e)
      showToast(apiErrorText(e, ERR), 'error')
    } finally {
      setBusy('')
    }
  }


  const buy: BuyProps = {
    balance,
    busy,
    wishlist,
    onBuy: (c, s) => void doBuy(c, s),
    onWish: (c, n) => void doWish(c, n),
  }
  const guestPacks = (rules?.packs.items ?? []).filter((p) => GUEST_PACKS.includes(p.code))

  /**
   * Одна лента (правка владельца 21:58: «вкладки — дерьмо, никто их не
   * листает; человек заходит ради battle pass»). Порядок — по ценности:
   * пасс крупно → витрина дня (первая карточка — «Бесплатно») → набор и «для
   * тебя» → ночной рынок → задания недели → обмен осколков → плащи за часы →
   * рубины → PLUS → «Хочу» (в самый низ, правка 24.09.2026) → баннер «Код
   * автора» (CreatorCode). Достижений нет (24.09.2026).
   */
  const feed = day ? (
    <div className="sh-flow sh-feed">
      <Guard what="Бонус за вход" silent>
      <div className="card sh-block sh-pass dp2" id="shop-today" data-section="pass">
        {on ? <PassBody active={on} inline /> : <span className="skel sh-skel" style={{ height: '420px' }} />}
      </div>
      </Guard>
      <Guard what="Витрина" silent>
      <Showcase
        featured={day.day.featured}
        deal={day.day.deal}
        items={day.day.items}
        refreshAt={day.day.refreshAt}
        onTry={() => day.day.featured && wearNow([{ code: day.day.featured.item.code, variant: day.day.featured.item.variant }])}
        onEnd={reload}
        {...buy}
      />
      </Guard>
      {/* Наборов нет (решение владельца 24.09.2026, 19:37): каждая вещь — отдельно. */}
      <Guard what="Для тебя" silent>
      {day.xray || day.day.forYou.length ? (
        <ForYou
          lead={day.xray ? <XrayCard offer={day.xray} balance={balance} busy={busy} onBuy={(o) => void doXray(o)} onEnd={reload} /> : null}
          cards={day.day.forYou}
          refreshAt={day.day.refreshAt}
          {...buy}
        />
      ) : null}
      </Guard>
      <Guard what="Ночной рынок" silent>{day.nightMarket ? <NightMarket endsAt={day.nightMarket.endsAt} cards={day.nightMarket.cards} onEnd={reload} {...buy} /> : null}</Guard>
      <Guard what="Задания недели" silent>
      {weekly ? (
        <WeeklyPathBlock data={weekly} busy={busy} onClaim={(at) => void doWeekly(at)} onBoost={(n) => void doWeeklyBoost(n)} />
      ) : parcel ? (
        <ParcelBlock data={parcel} busy={busy} onClaim={(it) => void doParcel(it)} />
      ) : null}
      </Guard>
      <Guard what="Мастерская" silent>{workshop ? <WorkshopBlock data={workshop} busy={busy} weekly={!!weekly} onCraft={(w) => void doCraft(w)} /> : null}</Guard>
      <Guard what="Путь" silent>{progress ? <PathBlock data={progress} /> : null}</Guard>
      <Guard what="Рубины" silent>
      <Packs
        packs={day.packs}
        busy={busy}
        onBuy={(p) => void doPack(p)}
        wallet={walletKnown ? walletKopecks : undefined}
        onTopUp={(n) => doWalletTopUp(n)}
      />
      </Guard>
      <Guard what="PLUS" silent>
      <PlusMonth
        plus={plus}
        busy={busy}
        onSubscribe={() => void doPlus()}
        onManage={() => openExt(PLUS_MANAGE_URL)}
        onClaim={() => void doPlusMonth()}
        onMigrate={() => setMigOpen(true)}
      />
      </Guard>
      <Guard what="Хочу" silent>
      {wishes && wishes.items.length ? (
        <div id="shop-wish" data-section="wishlist">
          <Wishlist
            data={wishes}
            shards={shards}
            wallet={walletKopecks}
            onTopUp={(n) => void doTopUp(n)}
            onCraft={(w: WishEntry) => void doCraft({ item: w.item, cost: w.cost ?? 0 })}
            onBrowse={() => document.getElementById('shop-today')?.scrollIntoView({ behavior: 'smooth' })}
            {...buy}
          />
        </div>
      ) : null}
      </Guard>
      <Guard what="Код автора" silent>
        <CreatorCode />
      </Guard>
    </div>
  ) : (
    <div className="sh-flow" aria-hidden="true">
      <span className="skel sh-skel" style={{ height: '420px' }} />
      <span className="skel sh-skel" style={{ height: '300px' }} />
    </div>
  )

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-rubies">
      <div className="page-head sh-top">
        <h1>Магазин</h1>
        {signedIn ? (
          <div className="right sh-wallet2">
            <span className={'sh-bal' + (bump.rubies ? ' bump' : '')} data-cur="rubies" data-tip="Рубины">
              <Ruby size={20} />
              <b>{day ? balance.toLocaleString('ru-RU') : '—'}</b>
            </span>
            <span className={'sh-bal' + (bump.shards ? ' bump' : '')} data-cur="shards" data-tip="Осколки: только за игру">
              <Shard size={20} />
              <b>{day || workshop ? shards.toLocaleString('ru-RU') : '—'}</b>
            </span>
            <button className="btn md primary" data-track="top_up" onClick={toPacks}>
              <Icon id="i-plus" />
              Пополнить
            </button>
          </div>
        ) : null}
      </div>

      {!signedIn ? (
        <>
          <div className="card sh-block sh-guest">
            <Ruby size={40} />
            <b>Войди, чтобы покупать и копить</b>
            <button className="btn md primary" id="rubiesLoginCta" data-track="login" onClick={() => logoutToLogin()}>
              <Icon id="i-login" />
              Войти
            </button>
          </div>
          <Packs packs={rules ? guestPacks : null} busy={busy} onBuy={(p) => void doPack(p)} />
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

      {xray ? (
        <XrayOpening
          tier={xray.tier}
          item={xray.item}
          onOpened={(item) => {
            setXray(null)
            void reloadShop()
            showReward({ items: [entry(item)], kicker: 'Рентген-кейс', onWear: () => wearItems([item]) })
          }}
        />
      ) : null}

      {migOpen && plus?.migration && migLeft > 0 ? (
        <MigrationModal
          pool={plus.migration.pool.filter((it) => !plus.migration!.picked.includes(it.code))}
          left={migLeft}
          busy={busy === 'migration'}
          onPick={(codes) => void doMigrate(codes)}
          onClose={() => setMigOpen(false)}
        />
      ) : null}

    </section>
  )
}
