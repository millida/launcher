import { api } from './api'
import { hasTauri } from '../ipc/tauri'
import { millidaPacks } from '../ipc/commands'
import type { MillidaPack } from '../ipc/commands'
import { RU_LOADER } from './format'

/// Витрина платных сборок (docs/REDESIGN-2026-09-22.md §2.2).
///
/// Ни одного числа и названия в коде нет: всё приходит с сервера. Пока бэкенд
/// не отдаёт эти адреса, экран показывает короткое «скоро», а не выдуманные
/// карточки.
///
/// Схема продажи: продаётся доступ к сборке (манифест, моды тянутся с площадки
/// при установке), а не архив с чужими jar — лицензии ARR и правила Mojang
/// (docs/research-2026-09-22/roblox-and-paid-packs.md §2.4).

export type PremiumPeriod = 'month' | 'year'

/// Уровень подписки: цена, срок и состав — всё словами сервера.
export interface PremiumPlan {
  id: string
  title: string
  priceKopecks: number
  period: PremiumPeriod
  /// Состав уровня короткими строками: «Все сборки», «Свой сервер».
  items?: string[]
}

/// Состояние подписки игрока. `manageUrl` — страница отмены: прятать отмену
/// нельзя (FTC против Epic, $245 млн).
export interface PremiumSubscription {
  active: boolean
  planId?: string | null
  /// ISO-дата, до которой оплачено.
  paidUntil?: string | null
  canceled?: boolean
  manageUrl?: string | null
}

/// Карточка сборки в ленте.
export interface PremiumPack {
  id: string
  /// Слаг сборки в каталоге: по нему идёт установка тем же путём, что у
  /// бесплатных сборок.
  slug?: string | null
  title: string
  /// Одна строка сути. Длинные описания сюда не кладутся.
  tagline?: string | null
  coverUrl?: string | null
  modsCount?: number | null
  mcVersion?: string | null
  loader?: string | null
  /// Живой онлайн сборки. Нет данных — плитка не рисуется.
  online?: number | null
  /// Возрастная маркировка по 436-ФЗ: «6+», «12+».
  ageRating?: string | null
  /// Входит в подписку — бейдж рядом с названием.
  inSubscription?: boolean
  /// Разовая покупка. Нет — продаётся только по подписке.
  priceKopecks?: number | null
  /// Уже оплачено: вместо «Оформить» показываем «Установить».
  owned?: boolean
  /// Скачиваний — живое число каталога.
  downloads?: number | null
  /// У сборки есть свой сервер.
  hasServer?: boolean
  /// Кто собрал. Своё имя рядом с чужой работой не ставится.
  author?: string | null
  /// Откуда пришла карточка. 'catalog' — наш каталог сборок: цены и подписки в
  /// нём нет, доступ открывается ключом, установка идёт путём каталога.
  source?: 'premium' | 'catalog'
  /// Продавец сборки выдаёт свои ключи: рядом с подпиской остаётся ввод ключа.
  acceptsKeys?: boolean
}

export interface PremiumPatch {
  date?: string | null
  text: string
}

export interface PremiumPackDetail extends PremiumPack {
  screenshots?: string[]
  videoUrl?: string | null
  /// Что входит: «Роль в Discord», «Белый список сервера».
  includes?: string[]
  /// Уровни подписки, в которых сборка есть.
  plans?: PremiumPlan[]
  patches?: PremiumPatch[]
  updatedAt?: string | null
  /// Подписка на эту сборку отдельно.
  subscription?: PremiumSubscription | null
  /// Подписка на все сборки того же партнёра.
  bundle?: PremiumSubscription | null
}

/// Подписка, которой человек пользуется сейчас: своя на сборку или на все сборки.
export function liveSubscription(detail: PremiumPackDetail | null): PremiumSubscription | null {
  if (!detail) return null
  if (detail.bundle?.active) return detail.bundle
  if (detail.subscription?.active) return detail.subscription
  return null
}

/// Сборка открывается несколькими подписками: одна эта или все сборки партнёра.
export const hasPlanChoice = (detail: PremiumPackDetail | null): boolean =>
  !!detail && Array.isArray(detail.plans) && detail.plans.length > 1

export interface PremiumShowcase {
  subscription?: PremiumSubscription | null
  plans?: PremiumPlan[]
  /// Какая сборка стоит в герое. Пусто — берём первую из списка.
  featuredId?: string | null
  packs?: PremiumPack[]
}

export function loadPremium(): Promise<PremiumShowcase> {
  return api<PremiumShowcase>('/launcher/premium')
}

/// Наш каталог сборок. В приложении — своя команда, в браузере — тот же список
/// адресом: каталог открыт и без Tauri.
function loadCatalogPacks(): Promise<MillidaPack[]> {
  return hasTauri() ? millidaPacks() : api<MillidaPack[]>('/catalog/packs')
}

/// Платная сборка каталога в виде карточки витрины. Ни цены, ни подписки, ни
/// онлайна в каталоге нет — эти поля остаются пустыми и на экран не выходят.
export function packFromCatalog(p: MillidaPack): PremiumPack {
  return {
    id: p.slug,
    slug: p.slug,
    title: p.title,
    tagline: p.summary || null,
    coverUrl: p.cover,
    mcVersion: p.game || null,
    loader: p.loader ? RU_LOADER(p.loader) : null,
    downloads: typeof p.downloads === 'number' ? p.downloads : null,
    hasServer: !!p.hasServer,
    author: p.author || null,
    source: 'catalog',
  }
}

/// Витрина: сначала будущий адрес подписок, иначе — платные сборки каталога,
/// которые у нас есть прямо сейчас. Пусто в обоих — экран говорит «скоро».
export async function loadShowcase(): Promise<PremiumShowcase> {
  const shown = await loadPremium().catch(() => null)
  if (shown && shown.packs && shown.packs.length)
    return { ...shown, packs: shown.packs.map((x) => ({ source: 'premium' as const, ...x })) }
  const list = await loadCatalogPacks()
  const packs = (Array.isArray(list) ? list : []).filter((p) => p && p.accessRequired).map(packFromCatalog)
  return { subscription: (shown && shown.subscription) || null, plans: (shown && shown.plans) || [], packs }
}

export function loadPremiumPack(id: string): Promise<PremiumPackDetail> {
  return api<PremiumPackDetail>('/launcher/premium/' + encodeURIComponent(id))
}

/// Оформление: сервер возвращает адрес оплаты, лаунчер открывает его снаружи.
export function subscribePremium(planId: string, packId?: string): Promise<{ paymentUrl: string }> {
  return api<{ paymentUrl: string }>('/launcher/premium/subscribe', {
    method: 'POST',
    body: JSON.stringify({ planId, packId }),
  })
}

/// Разовая покупка одной сборки, если сервер её предлагает.
export function buyPremiumPack(id: string): Promise<{ paymentUrl: string }> {
  return api<{ paymentUrl: string }>('/launcher/premium/' + encodeURIComponent(id) + '/buy', {
    method: 'POST',
  })
}

/// Копейки сервера — в рубли без копеечного хвоста, когда он нулевой.
export function rub(kopecks: number): string {
  const value = (kopecks || 0) / 100
  const rounded = Math.round(value * 100) / 100
  const text = Number.isInteger(rounded)
    ? rounded.toLocaleString('ru-RU')
    : rounded.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return text + ' ₽'
}

export const periodSuffix = (p?: PremiumPeriod | null): string =>
  p === 'year' ? '/год' : p === 'month' ? '/мес' : ''

export const planPrice = (plan: PremiumPlan): string => rub(plan.priceKopecks) + periodSuffix(plan.period)

/// Дата подписки человеческим видом: «до 12 октября».
export function untilText(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

/// Строка под названием: только живые числа сервера, через разделитель.
export function packFacts(p: PremiumPack): string {
  const parts: string[] = []
  if (typeof p.modsCount === 'number' && p.modsCount > 0) parts.push(p.modsCount.toLocaleString('ru-RU') + ' модов')
  if (p.mcVersion) parts.push(p.mcVersion)
  if (p.loader) parts.push(p.loader)
  return parts.join(' · ')
}

/// Сборка ставится путём каталога: доступ проверяет сервер, ключ спрашивает
/// то же окно, что в каталоге.
export const viaCatalog = (p: PremiumPack): boolean => p.source === 'catalog' && !!p.slug

/// Что показывает кнопка цены: подписка, разовая цена или ничего.
export function priceLabel(p: PremiumPack, plan?: PremiumPlan | null): string {
  if (p.owned) return ''
  if (p.inSubscription && plan) return planPrice(plan)
  if (typeof p.priceKopecks === 'number' && p.priceKopecks > 0) return rub(p.priceKopecks)
  return ''
}
