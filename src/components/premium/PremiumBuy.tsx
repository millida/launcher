import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { track } from '../../lib/telemetry'
import { watchPackPurchase } from '../../state/packWatch'
import { PackInstallButton } from './PackInstall'
import { PackKeyField } from '../PackKeyModal'
import { FeedbackModal } from '../Feedback'
import { purchaseFlow } from '../../lib/purchaseTrack'
import { openPaymentUrl } from '../../lib/openPayment'
import { healthLine, loadPackHealth, type PackHealth } from '../../lib/packHealth'
import { keyCatalogPack } from '../../lib/installKeys'
import { useInstalls } from '../../state/installs'
import {
  buyPremiumPack,
  hasPlanChoice,
  liveSubscription,
  periodSuffix,
  planPrice,
  priceLabel,
  rub,
  subscribePremium,
  untilText,
  viaCatalog,
  type PremiumPack,
  type PremiumPackDetail,
  type PremiumPlan,
  type PremiumSubscription,
} from '../../lib/premium'
import '../../styles/pixel/premium-buy.css'

/*
 * Покупка и доступ премиум-сборки. Внешний вид — src/styles/pixel/premium-buy.css.
 * Кнопки — конструкция .btn.primary лаунчера один в один (срез, точки, грани,
 * подошва, нажатие), перекрашенная в премиум-золото классом `pab-prem`
 * (решение владельца 04.10.2026).
 *
 * Карточка доступа `PremiumAccessCard` — правая колонка страницы сборки,
 * `PremiumPrimaryAction` — та же главная кнопка для героя страницы. Состояние
 * оплаты общее у обеих (стор ниже): нажали в герое — «Ждём оплату» видно и
 * в карточке.
 */

export interface BuyProps {
  pack: PremiumPack
  plan?: PremiumPlan | null
  sub?: PremiumSubscription | null
  /// Второй блок цены внизу страницы: тот же смысл, крупнее подложка.
  wide?: boolean
}

/// Доступ есть: подписка активна и сборка в ней, либо куплена разово.
export const hasAccess = (pack: PremiumPack, sub?: PremiumSubscription | null): boolean =>
  !!pack.owned || (!!sub?.active && !!pack.inSubscription)

/** Оплата идёт в браузере: исход для лаунчера — открылась ли страница оплаты. */
async function openPayment(
  run: () => Promise<{ paymentUrl: string }>,
  result: (ok: boolean, reason?: 'checkout' | 'error', err?: unknown) => void,
): Promise<string | null> {
  try {
    const answer = await run()
    if (answer && answer.paymentUrl) {
      const opened = openPaymentUrl(answer.paymentUrl)
      result(opened, opened ? 'checkout' : 'error', opened ? undefined : 'payment_url_not_opened')
      return opened ? answer.paymentUrl : null
    }
    result(false, 'error', 'no_payment_url')
    showToast('Оплата не открылась', 'error')
  } catch (e) {
    result(false, 'error', e)
    showToast('Оплата не открылась', 'error')
  }
  return null
}

/* ============ Состояние оплаты: одно на сборку ============ */

type Pay = { kind: 'idle' } | { kind: 'opening' } | { kind: 'waiting'; url: string | null } | { kind: 'error' }

const IDLE: Pay = { kind: 'idle' }
const pays = new Map<string, Pay>()
const watches = new Map<string, () => void>()
const listeners = new Set<() => void>()

function setPay(id: string, p: Pay) {
  if (p.kind === 'idle') pays.delete(id)
  else pays.set(id, p)
  listeners.forEach((l) => l())
}
const subscribePays = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
function usePay(id: string): Pay {
  return useSyncExternalStore(subscribePays, () => pays.get(id) || IDLE)
}
function stopWatch(id: string) {
  watches.get(id)?.()
  watches.delete(id)
}

/**
 * Запуск оплаты. `watch` — ждать, пока сервер скажет «куплено»: тогда кнопка
 * показывает «Ждём оплату», а по приходу — тост и `onOwned`.
 */
function runPayment(
  packId: string,
  run: () => Promise<{ paymentUrl: string }>,
  result: (ok: boolean, reason?: 'checkout' | 'error', err?: unknown) => void,
  onOwned?: (() => void) | null,
  ownedText = 'Подписка оформлена',
) {
  setPay(packId, { kind: 'opening' })
  void openPayment(run, result).then((url) => {
    if (!url) {
      setPay(packId, { kind: 'error' })
      return
    }
    if (!onOwned) {
      setPay(packId, IDLE)
      return
    }
    setPay(packId, { kind: 'waiting', url })
    stopWatch(packId)
    watches.set(
      packId,
      watchPackPurchase(packId, () => {
        watches.delete(packId)
        setPay(packId, IDLE)
        showToast(ownedText)
        onOwned()
      }),
    )
  })
}

/// Подписка на план из выбора планов (путь PlanButtons: сборка по слагу).
function startPlan(pack: PremiumPack, plan: PremiumPlan, onOwned: () => void) {
  const id = pack.slug || pack.id
  track('store_open', { where: 'premium_subscribe' })
  const result = purchaseFlow('premium_sub', plan.id + ':' + id, plan.priceKopecks, 'kopecks')
  runPayment(pack.id, () => subscribePremium(plan.id, id), result, onOwned)
}

/// «Все сборки» — сначала состав пакета в подтверждении.
function confirmBundle(pack: PremiumPack, plan: PremiumPlan, onOwned: () => void) {
  void uiConfirm((plan.items || []).join('. ') || 'Все сборки автора в одной подписке.', {
    title: plan.title || 'Все сборки',
    confirmLabel: 'Оформить · ' + planPrice(plan),
    cancelLabel: 'Отмена',
  }).then((yes) => yes && startPlan(pack, plan, onOwned))
}

const choosePlan = (pack: PremiumPack, plan: PremiumPlan, onOwned: () => void) =>
  plan.id === 'pack' ? startPlan(pack, plan, onOwned) : confirmBundle(pack, plan, onOwned)

/// Подписка одним планом (путь BuyButton: сборка по id).
function startSub(pack: PremiumPack, plan: PremiumPlan, onOwned?: (() => void) | null) {
  track('store_open', { where: 'premium_subscribe' })
  const result = purchaseFlow('premium_sub', plan.id + ':' + (pack.slug || pack.id), plan.priceKopecks ?? undefined, 'kopecks')
  runPayment(pack.id, () => subscribePremium(plan.id, pack.id), result, onOwned)
}

function startBuy(pack: PremiumPack, onOwned?: (() => void) | null) {
  track('store_open', { where: 'premium_buy' })
  const result = purchaseFlow('premium_pack', pack.slug || pack.id, pack.priceKopecks ?? undefined, 'kopecks')
  runPayment(pack.id, () => buyPremiumPack(pack.id), result, onOwned, 'Сборка куплена')
}

/// Планы по порядку: «все сборки» первыми — партнёр продвигает общую подписку.
export const orderPlans = (plans: PremiumPlan[]) => [...plans].sort((a, b) => Number(a.id === 'pack') - Number(b.id === 'pack'))

const perMonth = (p: PremiumPlan) => (p.period === 'year' ? p.priceKopecks / 12 : p.priceKopecks)

/**
 * Метка плана. «Выгоднее −N%» — только если она правда: годовой план дешевле
 * месячного в пересчёте на месяц. Иначе первый план — «Рекомендуем».
 */
export function planBadge(plan: PremiumPlan, ordered: PremiumPlan[]): string {
  if (ordered.length < 2) return ''
  const monthly = ordered.filter((p) => p.period === 'month')
  if (plan.period === 'year' && monthly.length) {
    const ref = Math.max(...monthly.map((p) => p.priceKopecks))
    const save = Math.round((1 - perMonth(plan) / ref) * 100)
    if (save >= 5) return 'Выгоднее −' + save + '%'
  }
  const anyYearDeal = ordered.some((p) => p.period === 'year' && monthly.length && perMonth(p) < Math.max(...monthly.map((m) => m.priceKopecks)))
  return !anyYearDeal && plan === ordered[0] ? 'Рекомендуем' : ''
}

const planName = (plan: PremiumPlan) => (plan.id === 'pack' ? 'Эта сборка' : 'Все сборки')

/* ============ Кнопки, которыми пользуются другие экраны ============ */

/// Главная кнопка сборки. Одна primary на зону — всё остальное рядом ghost.
export function BuyButton({
  pack,
  plan,
  sub,
  size,
  onOwned,
}: BuyProps & { size?: 'sm' | 'lg'; onOwned?: (() => void) | null }) {
  const pay = usePay(pack.id)
  const cls = 'btn primary pab-prem' + (size === 'sm' ? ' sm' : size === 'lg' ? ' lg' : '')
  // Сборка каталога: цены у нас нет, доступ проверяет сервер при установке.
  if (viaCatalog(pack))
    return (
      <span className="pab-prem-wrap">
        <PackInstallButton pack={pack} size={size === 'sm' ? 'sm' : undefined} />
      </span>
    )
  /*
   * Доступ есть — ставим тем же путём каталога. Раньше «Установить» открывал
   * версии Modrinth, а сборок партнёров там нет: 28.09.2026 купившие Arcania
   * получали «Не удалось получить версии: 502».
   */
  if (hasAccess(pack, sub)) {
    if (!pack.slug) {
      return (
        <button className={cls} disabled>
          <Icon id="i-download" /> Скоро
        </button>
      )
    }
    return (
      <span className="pab-prem-wrap">
        <PackInstallButton pack={pack} size={size === 'sm' ? 'sm' : undefined} />
      </span>
    )
  }
  const busy = pay.kind === 'opening' || pay.kind === 'waiting'
  if (busy) return <WaitButton cls={cls} pay={pay} />
  if (pack.inSubscription && plan)
    return (
      <button
        className={cls}
        data-track="premium_subscribe"
        data-kind="premium"
        data-id={pack.slug || pack.id}
        onClick={() => startSub(pack, plan, onOwned)}
      >
        <Icon id="i-crown" /> Оформить
      </button>
    )
  if (typeof pack.priceKopecks === 'number' && pack.priceKopecks > 0)
    return (
      <button
        className={cls}
        data-track="premium_buy"
        data-kind="premium"
        data-id={pack.slug || pack.id}
        onClick={() => startBuy(pack, onOwned)}
      >
        <Icon id="i-gem" /> Купить
      </button>
    )
  return null
}

function WaitButton({ cls, pay }: { cls: string; pay: Pay }) {
  return (
    <button className={cls + ' pab-wait'} disabled aria-busy="true">
      <span className="pab-spin" aria-hidden="true" />
      {pay.kind === 'opening' ? 'Открываем оплату' : 'Ждём оплату'}
    </button>
  )
}

/// Сборка партнёра открывается двумя подписками: ею одной или всеми сборками
/// партнёра. Главная кнопка — все сборки: партнёр продвигает общую подписку.
export function PlanButtons({
  pack,
  plans,
  onOwned,
  size,
  wrap,
}: {
  pack: PremiumPack
  plans: PremiumPlan[]
  onOwned: () => void
  size?: 'sm'
  /// Класс обёртки каждой кнопки: у колонки покупки кнопка на всю ширину.
  wrap?: string
}) {
  const pay = usePay(pack.id)
  // Окно ушло — ждать оплату некому (как раньше: ожидание жило в кнопке).
  const live = useRef(true)
  useEffect(
    () => () => {
      live.current = false
    },
    [],
  )
  const owned = () => live.current && onOwned()
  const id = pack.slug || pack.id
  const sm = size === 'sm' ? ' sm' : ''

  const boxed = (key: string, node: ReactNode) =>
    wrap ? (
      <span className={wrap} key={key}>
        {node}
      </span>
    ) : (
      <span key={key} style={{ display: 'contents' }}>
        {node}
      </span>
    )

  if (pay.kind === 'opening' || pay.kind === 'waiting')
    return boxed('wait', <WaitButton cls={'btn primary pab-prem' + sm} pay={pay} />)
  const ordered = orderPlans(plans)
  return (
    <>
      {ordered.map((plan, i) =>
        boxed(
          plan.id,
          <button
            className={'btn ' + (i === 0 ? 'primary pab-prem' : 'secondary') + sm}
            data-track="premium_subscribe"
            data-kind="premium"
            data-id={id}
            data-plan={plan.id}
            onClick={() => choosePlan(pack, plan, owned)}
          >
            <Icon id={i === 0 ? 'i-crown' : 'i-blocks'} /> {planName(plan)} · {planPrice(plan)}
          </button>,
        ),
      )}
    </>
  )
}

/// Цена рядом с кнопкой: подписка отдельной строкой от разовой цены, чтобы они
/// не спорили. Срок и отмена показаны честно (ФЗ о рекламе, ст. 6).
export function PriceLine({ pack, plan, sub }: BuyProps) {
  if (hasAccess(pack, sub)) {
    const until = untilText(sub?.paidUntil)
    return (
      <span className="pm-price">
        <b>Доступ открыт</b>
        {sub?.active && until ? <i>Подписка до {until}</i> : null}
      </span>
    )
  }
  const main = priceLabel(pack, plan)
  if (!main) return null
  const alsoOnce =
    pack.inSubscription && plan && typeof pack.priceKopecks === 'number' && pack.priceKopecks > 0
  return (
    <span className="pm-price">
      <b>{main}</b>
      {alsoOnce ? <i>или {priceLabel({ ...pack, inSubscription: false })} разово</i> : null}
      {!pack.inSubscription ? <i>Покупка навсегда</i> : null}
    </span>
  )
}

/// Повтор блока цены внизу страницы сборки: возвращаться наверх не нужно.
export function BuyBlock({ pack, plan, sub }: BuyProps) {
  const access = hasAccess(pack, sub)
  return (
    <div className={'pm-buy pab-wide' + (access ? ' is-open' : '')}>
      <div className="pm-buy-left">
        <span className="pab-eyebrow">
          <Icon id="i-crown" /> Премиум
        </span>
        <b>{pack.title}</b>
        <PriceLine pack={pack} plan={plan} sub={sub} />
      </div>
      <div className="pm-buy-right">
        <BuyButton pack={pack} plan={plan} sub={sub} size="lg" />
        {plan && pack.inSubscription && !access ? <span className="pm-plan">{plan.title}</span> : null}
      </div>
    </div>
  )
}

const DAY = 86_400_000
/// Сколько дней доступа осталось; null — даты нет.
function daysLeft(iso?: string | null, now = Date.now()): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.ceil((t - now) / DAY))
}
/// Подписка выключена и кончается через неделю или раньше.
const expiringSoon = (sub?: PremiumSubscription | null): boolean => {
  if (!sub?.active || !sub.canceled) return false
  const d = daysLeft(sub.paidUntil)
  return d !== null && d <= 7
}
const daysWord = (n: number) => {
  const a = n % 10
  const b = n % 100
  if (a === 1 && b !== 11) return 'день'
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'дня'
  return 'дней'
}

/// Отмена не прячется: ссылка стоит там же, где подписка.
export function CancelLine({ sub }: { sub?: PremiumSubscription | null }) {
  if (!sub) return null
  if (sub.active) {
    const until = untilText(sub.paidUntil)
    const soon = expiringSoon(sub)
    return (
      <div className={'pm-note pab-manage' + (soon ? ' warn' : '')}>
        <Icon id={soon ? 'i-alert' : 'i-restart'} />
        {sub.canceled ? (
          <span>Продление выключено{until ? ', доступ до ' + until : ''}</span>
        ) : (
          <span>Списание каждый месяц{until ? ', следующее ' + until : ''}</span>
        )}
        {sub.manageUrl ? (
          <button className="btn sm ghost" data-track="premium_cancel" onClick={() => openPaymentUrl(sub.manageUrl)}>
            {sub.canceled ? 'Продлить' : 'Отменить'}
          </button>
        ) : null}
      </div>
    )
  }
  return (
    <div className="pm-note pab-manage">
      <Icon id="i-info" />
      <span>Отмена в любой момент</span>
      {sub.manageUrl ? (
        <button className="btn sm ghost" data-track="premium_manage" onClick={() => openPaymentUrl(sub.manageUrl)}>
          Подписка
        </button>
      ) : null}
    </div>
  )
}

/* ============ Карточка доступа страницы премиум-сборки ============ */

export interface AccessProps {
  /// Сборка со слитой деталью сервера (`{ ...pack, ...detail }`).
  pack: PremiumPackDetail
  /// Деталь сервера; null — ещё грузится или сборка каталога.
  detail: PremiumPackDetail | null
  /// Планы витрины (`loadPremium().plans`).
  plans: PremiumPlan[]
  /// План, о котором говорит цена: план сборки, оформленный, первый.
  plan: PremiumPlan | null
  /// Подписка витрины.
  sub: PremiumSubscription | null
  /// Имя установленной сборки на компьютере; null — не стоит.
  installed: string | null
  onPlay: (build: string) => void
  /// Доступ появился (оплата, ключ): перечитать деталь.
  onOwned: () => void
}

export interface AccessCardProps extends AccessProps {
  /// Нет — сборку на хостинг не поставить, кнопки нет.
  onHost?: (() => void) | null
  slots?: { server?: ReactNode; extra?: ReactNode }
  /// Доступ открыт, а та же кнопка уже в герое страницы — в карточке её не повторяем.
  hideMainWhenOpen?: boolean
  /// Главная кнопка всегда в шапке страницы: в карточке только выбор тарифа (владелец 06.10.2026).
  hideMain?: boolean
  /// Выбранный тариф — общий с кнопкой в шапке.
  pickId?: string | null
  onPickId?: (id: string) => void
}

type Stage =
  | { kind: 'play'; build: string }
  | { kind: 'plans'; plans: PremiumPlan[] }
  | { kind: 'install' }
  | { kind: 'soon' }
  | { kind: 'catalog' }
  | { kind: 'sub'; plan: PremiumPlan }
  | { kind: 'buy' }
  | { kind: 'none' }

/// Что сейчас главное у сборки. Порядок — как у прежней колонки PackPage.
function stageOf(p: AccessProps): Stage {
  const { pack, detail, plan, sub, installed } = p
  if (installed) return { kind: 'play', build: installed }
  if (detail && hasPlanChoice(detail) && !hasAccess(pack, sub)) return { kind: 'plans', plans: orderPlans(detail.plans || []) }
  if (viaCatalog(pack)) return { kind: 'catalog' }
  if (hasAccess(pack, sub)) return pack.slug ? { kind: 'install' } : { kind: 'soon' }
  if (pack.inSubscription && plan) return { kind: 'sub', plan }
  if (typeof pack.priceKopecks === 'number' && pack.priceKopecks > 0) return { kind: 'buy' }
  return { kind: 'none' }
}

/// Ход установки сборки каталога — тот же ключ, что у PackInstallButton.
function useInstallTask(slug: string) {
  const task = useInstalls((s) => (slug ? s.tasks[keyCatalogPack(slug)] : undefined))
  return task && task.state === 'run' ? task : null
}

function InstallBar({ slug }: { slug: string }) {
  const task = useInstallTask(slug)
  if (!task) return null
  const pct = Math.max(0, Math.min(100, Math.round(task.pct)))
  return (
    <div className="pab-prog" role="progressbar" aria-label="Установка сборки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <span className="pab-prog-track">
        <span className="pab-prog-fill" style={{ width: pct + '%' }} />
      </span>
      <span className="pab-prog-text">
        <span>Установка идёт фоном — можно уйти со страницы</span>
      </span>
    </div>
  )
}

/// Главная кнопка по состоянию. `pick` — выбранный план в карточке; без него — первый.
function MainButton({ p, stage, pick, size }: { p: AccessProps; stage: Stage; pick?: PremiumPlan | null; size?: 'lg' }) {
  const pay = usePay(p.pack.id)
  const lg = size === 'lg' ? ' lg' : ''
  // Те же классы, что у «Установить»/«Играть» обычной страницы сборки (PackPage: btn lg primary pp-cta).
  const id = p.pack.slug || p.pack.id
  if (stage.kind === 'play')
    return (
      <button
        className={'btn primary pab-prem pp-cta pab-cta' + lg}
        data-sound="open"
        data-track="play"
        data-src="pack_page"
        onClick={() => p.onPlay(stage.build)}
      >
        <Icon id="i-play" /> Играть
      </button>
    )
  if (stage.kind === 'plans') {
    if (pay.kind === 'opening' || pay.kind === 'waiting') return <WaitButton cls={'btn primary pab-prem pp-cta pab-cta' + lg} pay={pay} />
    const plan = pick || stage.plans[0]
    if (!plan) return null
    return (
      <button
        className={'btn primary pab-prem pp-cta pab-cta' + lg}
        data-track="premium_subscribe"
        data-kind="premium"
        data-id={id}
        data-plan={plan.id}
        onClick={() => choosePlan(p.pack, plan, p.onOwned)}
      >
        <Icon id="i-crown" /> Оформить · {planPrice(plan)}
      </button>
    )
  }
  if (stage.kind === 'none') return null
  return (
    <span className="pab-cta-wrap">
      <BuyButton pack={p.pack} plan={p.plan} sub={p.sub} size={size} onOwned={p.onOwned} />
    </span>
  )
}

/// Ждём оплату / оплата не открылась — короткая строка под кнопкой.
function PayNote({ packId }: { packId: string }) {
  const pay = usePay(packId)
  if (pay.kind === 'waiting')
    return (
      <div className="pab-paynote" role="status">
        <span>Оплатите во вкладке браузера — доступ откроется сам.</span>
        <span className="pab-paynote-act">
          {pay.url ? (
            <button className="btn sm ghost" data-track="premium_pay_reopen" onClick={() => pay.url && openPaymentUrl(pay.url)}>
              <Icon id="i-ext" /> Открыть снова
            </button>
          ) : null}
          <button
            className="btn sm ghost"
            data-track="premium_pay_stop"
            onClick={() => {
              stopWatch(packId)
              setPay(packId, IDLE)
            }}
          >
            Отмена
          </button>
        </span>
      </div>
    )
  if (pay.kind === 'error')
    return (
      <div className="pab-paynote err" role="alert">
        <Icon id="i-alert" />
        <span>Оплата не открылась. Проверьте интернет и нажмите ещё раз.</span>
      </div>
    )
  return null
}

/// Главная кнопка для героя страницы: та же логика, что в карточке, одна кнопка.
export function PremiumPrimaryAction(p: AccessProps & { pickId?: string | null }) {
  const stage = stageOf(p)
  const pick = stage.kind === 'plans' ? stage.plans.find((x) => x.id === p.pickId) || null : null
  return (
    <div className="pab-hero-act">
      <MainButton p={p} stage={stage} pick={pick} size="lg" />
      {p.pack.slug && (stage.kind === 'install' || stage.kind === 'catalog') ? <InstallBar slug={p.pack.slug} /> : null}
    </div>
  )
}

/// «Работает · запускали 56 мин назад», шкала и «86% запусков без ошибок».
function Trust({ slug, title }: { slug: string; title: string }) {
  const [health, setHealth] = useState<PackHealth | null>(null)
  const [report, setReport] = useState(false)
  useEffect(() => {
    let alive = true
    setHealth(null)
    if (slug) void loadPackHealth(slug).then((h) => alive && setHealth(h))
    return () => {
      alive = false
    }
  }, [slug])
  const line = healthLine(health)
  if (!line) return null
  const lit = line.pct === null ? 0 : Math.round(line.pct / 10)
  return (
    <div className={'pab-trust ' + line.tone} data-section="pack_health" data-id={slug}>
      <span className="pab-trust-row">
        <span className="pab-dot" aria-hidden="true" />
        <b>{line.head}</b>
        {line.when ? <span className="pab-trust-when">{line.when}</span> : null}
      </span>
      {line.pct !== null ? (
        <span className="pab-trust-pct">
          <span className="pab-meter" aria-hidden="true">
            {Array.from({ length: 10 }, (_, i) => (
              <i key={i} className={i < lit ? 'on' : undefined} />
            ))}
          </span>
          <span>
            <b>{line.pct}%</b> запусков без ошибок
          </span>
        </span>
      ) : null}
      {line.report ? (
        <button className="btn sm ghost pab-trust-report" data-track="pack_report" data-src="pack_page" onClick={() => setReport(true)}>
          Сообщить о проблеме
        </button>
      ) : null}
      {report ? (
        <FeedbackModal onClose={() => setReport(false)} kind="game_launch" about={'Сборка «' + title + '» (' + slug + ')'} />
      ) : null}
    </div>
  )
}

/// Цена крупно: «299 ₽» и мелко «/мес».
function Price({ kopecks, period }: { kopecks: number; period?: PremiumPlan['period'] | null }) {
  return (
    <span className="pab-price">
      <b>{rub(kopecks)}</b>
      {period ? <i>{periodSuffix(period)}</i> : null}
    </span>
  )
}

function Checks({ items }: { items?: string[] | null }) {
  const list = (items || []).filter(Boolean).slice(0, 4)
  if (!list.length) return null
  return (
    <ul className="pab-checks">
      {list.map((x) => (
        <li key={x}>
          <Icon id="i-check" />
          {x}
        </li>
      ))}
    </ul>
  )
}

/// Выбор плана: строки-переключатели, отмеченный открывает свой состав.
function PlanPick({
  plans,
  pick,
  onPick,
  disabled,
}: {
  plans: PremiumPlan[]
  pick: PremiumPlan
  onPick: (p: PremiumPlan) => void
  disabled?: boolean
}) {
  return (
    <div className="pab-plans" role="radiogroup" aria-label="Подписка">
      {plans.map((plan) => {
        const on = plan.id === pick.id
        const badge = planBadge(plan, plans)
        const sub = plan.title && plan.title !== planName(plan) ? plan.title : ''
        return (
          <button
            key={plan.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            className={'pab-plan' + (on ? ' on' : '')}
            data-track="premium_plan_pick"
            data-plan={plan.id}
            onClick={() => onPick(plan)}
          >
            <span className="pab-plan-radio" aria-hidden="true" />
            <span className="pab-plan-name">
              <b>{planName(plan)}</b>
              {sub ? <span>{sub}</span> : null}
            </span>
            <span className="pab-plan-cost">
              <b>{rub(plan.priceKopecks)}</b>
              <i>{periodSuffix(plan.period)}</i>
              {plan.period === 'year' ? <em>≈ {rub(Math.round(perMonth(plan) / 100) * 100)}/мес</em> : null}
            </span>
            {badge ? <span className="pab-plan-badge">{badge}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Правая колонка страницы премиум-сборки: состояние доступа, цена или выбор
 * плана, главная кнопка, ключ, доверие (здоровье сборки), хостинг/сервер,
 * управление подпиской и правовая строка. Ширина — от 260 до 520px.
 */
export function PremiumAccessCard(p: AccessCardProps) {
  const { pack, detail, sub, installed, onHost, slots } = p
  const stage = stageOf(p)
  const pay = usePay(pack.id)
  const slug = pack.slug || ''
  const running = !!useInstallTask(slug)
  const [ownPick, setOwnPick] = useState<string | null>(null)
  const pickId = p.onPickId ? (p.pickId ?? null) : ownPick
  const setPickId = p.onPickId ?? setOwnPick
  const [keyOpen, setKeyOpen] = useState(false)
  const live = liveSubscription(detail) ?? sub
  const access = hasAccess(pack, sub) || !!installed
  const soon = expiringSoon(live)
  const left = daysLeft(live?.paidUntil)
  const until = untilText(live?.paidUntil)
  const keyEntry = !installed && !!slug && !!detail && hasPlanChoice(detail) && !!pack.acceptsKeys && !hasAccess(pack, sub)
  const busy = pay.kind === 'opening' || pay.kind === 'waiting'

  const plans = stage.kind === 'plans' ? stage.plans : []
  const pick = plans.find((x) => x.id === pickId) || plans[0] || null

  let head: ReactNode
  if (access || stage.kind === 'install' || stage.kind === 'soon') {
    const line = live?.active && until
      ? live.canceled
        ? 'Доступ до ' + until
        : 'Подписка до ' + until
      : pack.owned
        ? 'Куплено навсегда'
        : ''
    head = (
      <div className="pab-head open">
        <span className="pab-seal" aria-hidden="true">
          <Icon id="i-check" />
        </span>
        <span className="pab-head-text">
          <b>{stage.kind === 'play' ? 'Готово к игре' : 'Доступ открыт'}</b>
          {line || soon ? (
            <span className="pab-head-line">
              {line ? <span>{line}</span> : null}
              {soon && left !== null ? (
                <span className="pab-chip warn">
                  {left === 0 ? 'Последний день' : 'Ещё ' + left + ' ' + daysWord(left)}
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>
    )
  } else if (stage.kind === 'plans') {
    head = (
      <div className="pab-head">
        <span className="pab-head-text">
          <b>Откройте доступ</b>
          <span>Выберите подписку</span>
        </span>
      </div>
    )
  } else if (stage.kind === 'sub') {
    const alsoOnce = typeof pack.priceKopecks === 'number' && pack.priceKopecks > 0
    head = (
      <div className="pab-head offer">
        <Price kopecks={stage.plan.priceKopecks} period={stage.plan.period} />
        <span className="pab-sub">
          {alsoOnce ? 'или ' + rub(pack.priceKopecks as number) + ' разово' : stage.plan.title || 'Подписка'}
        </span>
      </div>
    )
  } else if (stage.kind === 'buy') {
    head = (
      <div className="pab-head offer">
        <Price kopecks={pack.priceKopecks as number} />
        <span className="pab-sub">Покупка навсегда</span>
      </div>
    )
  } else {
    head = (
      <div className="pab-head">
        <span className="pab-head-text">
          <b>Премиум-сборка</b>
          <span>Доступ проверим при установке</span>
        </span>
      </div>
    )
  }

  const items = stage.kind === 'plans' ? pick?.items : stage.kind === 'sub' ? stage.plan.items : null
  const fine =
    stage.kind === 'plans' || stage.kind === 'sub'
      ? 'Отмена в любой момент'
      : stage.kind === 'buy'
        ? 'Один платёж, обновления включены'
        : ''

  return (
    <div className={'pab' + (access ? ' is-open' : '') + (soon ? ' is-soon' : '')} data-stage={stage.kind}>
      <div className="pab-frame">
        <div className="pab-in">
          <div className="pab-top">
            <span className="pab-eyebrow">
              <Icon id="i-crown" /> Премиум
            </span>
            {pack.ageRating ? <span className="pab-age">{pack.ageRating}</span> : null}
          </div>

          {head}

          {stage.kind === 'plans' && pick ? (
            <PlanPick plans={plans} pick={pick} onPick={(x) => setPickId(x.id)} disabled={busy} />
          ) : null}
          {!access ? <Checks items={items} /> : null}

          <div className={'pab-act' + (running ? ' is-run' : '') + ((access && p.hideMainWhenOpen) || p.hideMain ? ' is-quiet' : '')}>
            {(access && p.hideMainWhenOpen) || p.hideMain ? null : <MainButton p={p} stage={stage} pick={pick} size="lg" />}
            {slug && !(access && p.hideMainWhenOpen) && !p.hideMain && (stage.kind === 'install' || stage.kind === 'catalog') ? <InstallBar slug={slug} /> : null}
            <PayNote packId={pack.id} />
            {(fine && !busy) || (keyEntry && !keyOpen) ? (
              <span className={'pab-aux' + (fine && !busy && keyEntry && !keyOpen ? ' two' : '')}>
                {fine && !busy ? <span className="pab-fine">{fine}</span> : null}
                {keyEntry && !keyOpen ? (
                  <button className="btn sm ghost pab-keylink" data-track="premium_key_open" onClick={() => setKeyOpen(true)}>
                    <Icon id="i-key" /> Есть ключ?
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>

          {keyEntry && keyOpen ? (
            <div className="pab-key">
              <PackKeyField
                slug={slug}
                onUnlocked={() => {
                  showToast('Ключ активирован')
                  p.onOwned()
                }}
              />
            </div>
          ) : null}

          {slug ? <Trust slug={slug} title={pack.title} /> : null}

          {onHost || slots?.server ? (
            <div className={'pab-more' + (onHost && slots?.server ? ' two' : '')}>
              {onHost ? (
                <button className="btn sm secondary pab-srv" data-sound="open" data-track="host_install" onClick={onHost}>
                  <Icon id="i-server-cog" /> На хостинг
                </button>
              ) : null}
              {slots?.server}
            </div>
          ) : null}

          {slots?.extra}

          {live || sub ? <CancelLine sub={live ?? sub} /> : null}

          <span className="pab-legal">Не продукт Mojang. Моды скачиваются при установке.</span>
        </div>
      </div>
    </div>
  )
}
