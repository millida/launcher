import { lazy } from 'react'
import type { ScreenId } from '../state/ui'
import { afterFirstInteraction, idle } from '../lib/idle'
import { markScreenReady } from '../lib/screenReady'

/** Тишина перед первой предзагрузкой, мс. */
export const PRELOAD_QUIET_MS = 3000
/** Тишина между двумя предзагрузками, мс. */
export const PRELOAD_GAP_MS = 400

// Imports are shared with lazy() so a prewarmed chunk is reused, not fetched twice.
const loaders = {
  play: () => import('./Play'),
  premium: () => import('./Premium'),
  plus: () => import('./Plus'),
  builds: () => import('./Builds'),
  servers: () => import('./Servers'),
  mods: () => import('./Mods'),
  skins: () => import('./Skins'),
  rubies: () => import('./Rubies'),
  friends: () => import('./Friends'),
  top: () => import('./Top'),
  chat: () => import('./Messages'),
  hosting: () => import('./Hosting'),
  playhub: () => import('./PlayHub'),
  pvp: () => import('./Pvp'),
  settings: () => import('../modals/Settings'),
} satisfies Record<ScreenId, () => Promise<unknown>>

const started = new Set<ScreenId>()

/** Любое начало загрузки экрана (переходом, наведением, предзагрузкой) — отметка «уже грузится». */
function open<K extends ScreenId>(id: K): ReturnType<(typeof loaders)[K]> {
  started.add(id)
  const loaded = loaders[id]() as ReturnType<(typeof loaders)[K]>
  void loaded.then(() => markScreenReady(id), () => undefined)
  return loaded
}

// Раскладка «Классика»: главная обёрнута в ClassicHome, а он тянет Play — статически его
// нельзя импортировать из App, иначе всё лобби уезжает в стартовый бандл.
export const ClassicHome = lazy(() => import('./ClassicHome').then((m) => ({ default: m.ClassicHome })))
export const Play = lazy(() => open('play').then((m) => ({ default: m.Play })))
export const Premium = lazy(() => open('premium').then((m) => ({ default: m.Premium })))
export const Plus = lazy(() => open('plus').then((m) => ({ default: m.Plus })))
export const Builds = lazy(() => open('builds').then((m) => ({ default: m.Builds })))
export const Servers = lazy(() => open('servers').then((m) => ({ default: m.Servers })))
export const Mods = lazy(() => open('mods').then((m) => ({ default: m.Mods })))
export const Skins = lazy(() => open('skins').then((m) => ({ default: m.Skins })))
export const Rubies = lazy(() => open('rubies').then((m) => ({ default: m.Rubies })))
export const Friends = lazy(() => open('friends').then((m) => ({ default: m.Friends })))
export const Top = lazy(() => open('top').then((m) => ({ default: m.Top })))
export const Messages = lazy(() => open('chat').then((m) => ({ default: m.Messages })))
export const Hosting = lazy(() => open('hosting').then((m) => ({ default: m.Hosting })))
export const PlayHub = lazy(() => open('playhub').then((m) => ({ default: m.PlayHub })))
export const Pvp = lazy(() => open('pvp').then((m) => ({ default: m.Pvp })))
export const Settings = lazy(() => open('settings').then((m) => ({ default: m.Settings })))

export function preloadScreen(id: ScreenId) {
  if (started.has(id)) return
  void open(id).catch(() => started.delete(id))
}

/**
 * В каком порядке заходят на экраны (телеметрия 26.10.2026, просмотры за двое суток):
 * лобби, библиотека, магазин, скины, друзья — 93% всех просмотров; остальные редкие.
 */
export const PRELOAD_ORDER: readonly ScreenId[] = [
  'play',
  'playhub',
  'rubies',
  'skins',
  'friends',
  'settings',
  'chat',
  'hosting',
  'top',
  'servers',
  'mods',
  'builds',
  'plus',
  'premium',
  'pvp',
]

/** Сколько экранов подгружать вперёд на слабом ПК: остальные откроются по требованию. */
export const WEAK_PRELOAD = 2

/** Какие экраны ещё стоит подгрузить, в порядке вероятности; `current` и уже начатые пропускаются. */
export function preloadPlan(current: ScreenId, weak: boolean, done: ReadonlySet<ScreenId> = started): ScreenId[] {
  const todo = PRELOAD_ORDER.filter((id) => id !== current && !done.has(id))
  return weak ? todo.slice(0, WEAK_PRELOAD) : todo
}

let preloading = false

/**
 * Предзагрузка экранов по одному, в простое. Раньше все 15 запрашивались разом через
 * requestIdleCallback — ≈600 КБ кода и CSS разбирались в первые секунды и добавляли свою
 * заморозку первому заходу на экран. Теперь: не раньше первого движения мышью/нажатия и
 * 3 с полной тишины; по одному экрану, между ними — свободный кадр и пауза; на слабом
 * ПК — только два самых вероятных. Нажатие в ходе работы сдвигает следующий шаг дальше.
 */
export function preloadScreens(current: () => ScreenId, weak: () => boolean = () => false): void {
  if (preloading) return
  preloading = true
  void (async () => {
    await afterFirstInteraction()
    await idle(PRELOAD_QUIET_MS, PRELOAD_QUIET_MS * 5)
    for (const id of preloadPlan(current(), weak())) {
      preloadScreen(id)
      // Чанк и его CSS разбираются; следующий — только когда окно снова свободно.
      await idle(PRELOAD_GAP_MS, PRELOAD_GAP_MS * 8)
    }
  })()
}
