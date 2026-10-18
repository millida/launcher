import { create } from 'zustand'
import { api, hasMillidaAccount } from '../../lib/api'
import { affords, catalogQuote, openTopup, refreshMoney, shortfallFor } from '../../lib/useMoney'
import { moneyShortfall, type MoneyShortfall } from '../../lib/money'
import { openPaymentUrl } from '../../lib/openPayment'
import { apiErrorText, isTransientApiError } from '../../lib/apiError'
import { purchaseFlow } from '../../lib/purchaseTrack'
import { uiConfirm } from '../../state/confirm'
import { showToast } from '../../state/ui'
import { openAccountAdd } from '../../state/accountAdd'
import { isRealtimeLive, onRealtime } from '../../lib/realtime'
import { pokeGate, purchaseWaitMs } from '../../lib/realtimePace'
import { accessState, livePriceKopecks, newIdempotencyKey, paidVerdict, purchasesFrom, verdictText } from './paid'
import type { AccessState, Pricing, Purchase } from './paid'
import { t } from '../../i18n'

/*
 * Покупка и подписка материала каталога Millida из лаунчера — те же адреса и
 * тот же порядок, что у кнопки «Купить» на странице материала сайта
 * (`item-paid-cta.tsx`): доступ → подтверждение с ценой → списание с кошелька
 * (или оплата подписки у шлюза) → доступ открыт → установка.
 */

const item = (slug: string) => '/catalog/items/' + encodeURIComponent(slug)

export interface PaidTarget {
  slug: string
  title: string
  pricing: Pricing
  priceKopecks: number
}

export type BuyStep = 'confirm' | 'funds'

export interface BuyDialog extends PaidTarget {
  step: BuyStep
  repriced: boolean
  shortfall: MoneyShortfall | null
}

interface PaidState {
  access: Record<string, AccessState>
  /** Подписка оформлена у шлюза, ждём, когда сервер откроет доступ. */
  waiting: Record<string, boolean>
  purchases: Purchase[] | null
  purchasesFailed: boolean
  dialog: BuyDialog | null
  busy: boolean
}

export const usePaid = create<PaidState>(() => ({
  access: {},
  waiting: {},
  purchases: null,
  purchasesFailed: false,
  dialog: null,
  busy: false,
}))

const setAccess = (slug: string, v: AccessState) => usePaid.setState((s) => ({ access: { ...s.access, [slug]: v } }))

const inflight = new Map<string, Promise<AccessState>>()

/** Доступ к платному материалу; без входа — закрыт, без запроса. Один запрос на все строки одного материала. */
export function loadAccess(slug: string, fresh = false): Promise<AccessState> {
  if (!hasMillidaAccount()) {
    setAccess(slug, 'locked')
    return Promise.resolve('locked')
  }
  const known = usePaid.getState().access[slug]
  if (!fresh && known && known !== 'unknown') return Promise.resolve(known)
  const running = inflight.get(slug)
  if (running) return running
  const p = api<unknown>(item(slug) + '/access')
    .then((body) => {
      const v = accessState(body)
      setAccess(slug, v)
      const live = livePriceKopecks(body)
      const d = usePaid.getState().dialog
      if (live && d && d.slug === slug && d.priceKopecks !== live) usePaid.setState({ dialog: { ...d, priceKopecks: live, repriced: true } })
      return v
    })
    .catch(() => {
      setAccess(slug, 'locked')
      return 'locked' as AccessState
    })
    .finally(() => inflight.delete(slug))
  inflight.set(slug, p)
  return p
}

export async function loadPurchases(): Promise<void> {
  if (!hasMillidaAccount()) {
    usePaid.setState({ purchases: [], purchasesFailed: false })
    return
  }
  try {
    const rows = purchasesFrom(await api<unknown>('/catalog/purchases/me'))
    usePaid.setState((s) => {
      const access = { ...s.access }
      for (const r of rows) access[r.slug] = 'open'
      return { purchases: rows, purchasesFailed: false, access }
    })
  } catch {
    usePaid.setState((s) => ({ purchasesFailed: true, purchases: s.purchases || [] }))
  }
}

/** Покупки привязаны к аккаунту Millida: без него — одно окно «Войти». */
export async function requireMillida(): Promise<boolean> {
  if (hasMillidaAccount()) return true
  if (await uiConfirm(t('Покупки и доступ хранятся в аккаунте Millida.'), { title: t('Войди в Millida'), confirmLabel: t('Войти'), danger: false })) {
    openAccountAdd('millida')
  }
  return false
}

/** Что делать после покупки — ставить. Одно на открытое окно. */
let afterOwned: (() => void) | null = null
/** Ключ повтора живёт, пока идёт одна попытка: обрыв после списания не спишет второй раз. */
let buyKey: string | null = null
/** Воронка покупки (`purchase_start` → `purchase_result`) открытого окна. */
let flow: ReturnType<typeof purchaseFlow> | null = null

const oneTimeShortfall = (d: PaidTarget): MoneyShortfall | null => (d.pricing === 'ONE_TIME' ? shortfallFor(catalogQuote(d.priceKopecks)) : null)

/**
 * «Купить» / «Подписаться» на строке. Доступ уже есть (купил на сайте, ключ,
 * подписка партнёра) — сразу `onOwned`; нет — окно подтверждения с ценой и
 * балансом.
 */
export async function startPaid(t: PaidTarget, onOwned: () => void): Promise<void> {
  if (!(await requireMillida())) return
  const state = await loadAccess(t.slug, true)
  if (state === 'open') {
    onOwned()
    return
  }
  afterOwned = onOwned
  buyKey = null
  flow = purchaseFlow(t.pricing === 'SUBSCRIPTION' ? 'catalog_sub' : 'catalog_item', t.slug, t.priceKopecks, 'kopecks')
  usePaid.setState({ dialog: { ...t, step: 'confirm', repriced: false, shortfall: null }, busy: false })
  await refreshMoney()
  const d = usePaid.getState().dialog
  const short = d && d.slug === t.slug ? oneTimeShortfall(d) : null
  if (d && short) usePaid.setState({ dialog: { ...d, step: 'funds', shortfall: short } })
}

export function closeBuy(): void {
  const st = usePaid.getState()
  if (st.busy) return
  if (flow) flow(false, st.dialog && st.dialog.step === 'funds' ? 'insufficient' : 'cancel')
  flow = null
  afterOwned = null
  buyKey = null
  usePaid.setState({ dialog: null })
}

function owned(slug: string, text: string): void {
  setAccess(slug, 'open')
  const done = afterOwned
  afterOwned = null
  buyKey = null
  if (flow) flow(true)
  flow = null
  usePaid.setState({ dialog: null, busy: false })
  showToast(text, 'ok', 'achievement')
  void loadPurchases()
  if (done) done()
}

async function fail(e: unknown, d: BuyDialog): Promise<void> {
  const v = paidVerdict(e)
  if (v.kind === 'login') {
    if (flow) flow(false, 'signin')
    flow = null
    usePaid.setState({ dialog: null })
    await requireMillida()
    return
  }
  if (v.kind === 'funds') {
    await refreshMoney()
    usePaid.setState({ dialog: { ...d, step: 'funds', shortfall: moneyShortfall(e) ?? oneTimeShortfall(d) } })
    return
  }
  if (v.kind === 'price-changed') {
    // Живую цену принесёт ответ доступа; окно остаётся открытым с пометкой.
    await loadAccess(d.slug, true)
    const cur = usePaid.getState().dialog
    if (cur) usePaid.setState({ dialog: { ...cur, repriced: true } })
    return
  }
  if (v.kind === 'owned') {
    owned(d.slug, t('Уже куплено'))
    return
  }
  if (flow) flow(false, 'error', e)
  flow = null
  usePaid.setState({ dialog: null })
  showToast(verdictText(v) || apiErrorText(e, d.pricing === 'SUBSCRIPTION' ? t('Не удалось оформить подписку') : t('Не удалось купить')), 'error')
}

/** Главная кнопка окна: купить, оформить подписку или пополнить. */
export async function confirmBuy(): Promise<void> {
  const st = usePaid.getState()
  const d = st.dialog
  if (!d || st.busy) return
  if (d.step === 'funds') {
    openTopup(d.shortfall?.topup ?? null)
    return
  }
  usePaid.setState({ busy: true })
  try {
    if (d.pricing === 'SUBSCRIPTION') {
      const r = await api<{ paymentUrl?: string }>(item(d.slug) + '/subscribe', { method: 'POST', body: JSON.stringify({}) })
      usePaid.setState({ busy: false })
      if (!openPaymentUrl(r && r.paymentUrl)) return
      afterOwnedBySlug.set(d.slug, afterOwned)
      afterOwned = null
      if (flow) flow(true, 'checkout')
      flow = null
      usePaid.setState((s) => ({ dialog: null, waiting: { ...s.waiting, [d.slug]: true } }))
      watchPayment()
      return
    }
    buyKey = buyKey || newIdempotencyKey()
    await api(item(d.slug) + '/buy', {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey: buyKey, expectedPriceKopecks: d.priceKopecks }),
    })
    usePaid.setState({ busy: false })
    void refreshMoney()
    owned(d.slug, t('Куплено'))
  } catch (e) {
    usePaid.setState({ busy: false })
    // Обрыв связи или 5xx могли уже списать: повтор идёт с тем же ключом.
    if (isTransientApiError(e)) {
      showToast(apiErrorText(e, t('Millida не ответила — повтори')), 'error')
      return
    }
    buyKey = null
    await fail(e, d)
  }
}

/* ── Возврат из оплаты подписки ── */

const afterOwnedBySlug = new Map<string, (() => void) | null>()
let watching = false
const PAYMENT_WAIT = { everyMs: 3_000, tries: 20 }

/** Игрок платит в браузере; вернулся в лаунчер — спрашиваем доступ, пока не откроется. */
function watchPayment(): void {
  if (watching) return
  watching = true
  let tries = 0
  let busy = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async () => {
    clearTimeout(timer)
    const slugs = Object.keys(usePaid.getState().waiting).filter((k) => usePaid.getState().waiting[k])
    if (!slugs.length) return stop()
    busy = true
    try {
      for (const slug of slugs) {
        if ((await loadAccess(slug, true)) !== 'open') continue
        usePaid.setState((s) => ({ waiting: { ...s.waiting, [slug]: false } }))
        const done = afterOwnedBySlug.get(slug)
        afterOwnedBySlug.delete(slug)
        showToast(t('Подписка оформлена'), 'ok', 'achievement')
        void loadPurchases()
        if (done) done()
      }
    } finally {
      busy = false
    }
    if (gate.take()) return void tick()
    tries += 1
    if (tries >= PAYMENT_WAIT.tries) {
      tries = 0
      return
    }
    timer = setTimeout(() => void tick(), purchaseWaitMs(isRealtimeLive(), PAYMENT_WAIT.everyMs))
  }
  const gate = pokeGate(
    () => busy,
    () => {
      tries = 0
      void tick()
    },
  )
  const offPoke = onRealtime('account', gate.poke)
  const onFocus = () => {
    clearTimeout(timer)
    tries = 0
    void tick()
  }
  const stop = () => {
    clearTimeout(timer)
    window.removeEventListener('focus', onFocus)
    offPoke()
    watching = false
  }
  window.addEventListener('focus', onFocus)
}

/** Пополнили в браузере и вернулись — окно «Не хватает» само становится «Купить». */
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    const d = usePaid.getState().dialog
    if (!d || d.step !== 'funds') return
    void refreshMoney().then(() => {
      const cur = usePaid.getState().dialog
      if (cur && cur.slug === d.slug && cur.pricing === 'ONE_TIME' && affords(catalogQuote(cur.priceKopecks)) === true) usePaid.setState({ dialog: { ...cur, step: 'confirm', shortfall: null } })
    })
  })
}
