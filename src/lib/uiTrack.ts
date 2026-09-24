import { track, telemetryEnabled } from './telemetry'
import { CLICKABLE, describeClick } from './uiClick'
import type { TrackNode } from './uiClick'

/**
 * Аналитика кликов: один делегированный слушатель на document (как initSounds),
 * который превращает любой клик по кнопке, ссылке или карточке в `ui_click`.
 *
 * Разметка, которую читает слушатель (всё необязательно):
 * - `data-track="play"` — имя элемента. Без него берётся aria-label / title /
 *   текст кнопки (не больше 40 символов, цифры → #).
 * - `data-id="slug"` / `data-kind="pack|mode|server|build|mod|..."` / `data-pos="3"`
 *   — что за объект под карточкой и на каком она месте. Ищется и у предков.
 * - `data-section="foryou"` — блок экрана (ищется у ближайшего предка).
 * - `data-src="hub_card"` — источник действия: запоминается и уходит в
 *   game_launch / server_join / catalog_install как `source`.
 * - `data-mode="BEDWARS"` — режим, внутри которого кликнули (у предка).
 * - `data-private` — внутри такого блока текст кнопок не собирается (ники,
 *   названия чатов); `data-notrack` — клик не пишется вовсе.
 *
 * Никаких пользовательских текстов: ни чатов, ни отзывов, ни поисковых строк.
 */

export type LaunchSource =
  | 'lobby_play'
  | 'hub_card'
  | 'foryou'
  | 'catalog'
  | 'mode'
  | 'server_search'
  | 'recommend'
  | 'today'
  | 'my_servers'
  | 'friend'
  | 'pack_page'
  | 'deeplink'
  | 'other'

/** Один и тот же элемент чаще раза в 400 мс — дребезг, а не второй клик. */
const DEDUPE_MS = 400

/** Клик-источник живёт 20 секунд: дольше это уже не причина запуска. */
const SOURCE_TTL_MS = 20_000

/** Потолок кликов за сессию: защита базы от залипшей мыши и автокликера. */
const SESSION_CAP = 3000

// ---------------------------------------------------------------------------
// Источник действия: последняя «значимая» карточка/кнопка и режим, из которого
// выбрали то, что сейчас стоит в лобби.

interface Intent {
  src: string
  id?: string
  kind?: string
  mode?: string
  at: number
}

let lastIntent: Intent | null = null
const ORIGIN_KEY = 'm-lobby-origin'

export function noteIntent(src: string, extra?: { id?: string; kind?: string; mode?: string }) {
  lastIntent = { src, ...extra, at: Date.now() }
}

/** Источник для события действия: свежий клик с data-src, иначе запасной. */
export function actionSource(fallback: LaunchSource | string = 'other'): { source: string; mode?: string; srcId?: string } {
  const it = lastIntent
  if (it && Date.now() - it.at <= SOURCE_TTL_MS) {
    const out: { source: string; mode?: string; srcId?: string } = { source: it.src }
    if (it.mode) out.mode = it.mode
    if (it.id) out.srcId = it.id
    return out
  }
  return { source: fallback }
}

/** Лобби запомнило выбор: откуда он пришёл, чтобы «Играть» потом знал происхождение. */
export function rememberLobbyOrigin() {
  const it = lastIntent
  const origin = it && Date.now() - it.at <= SOURCE_TTL_MS ? { src: it.src, mode: it.mode, id: it.id } : { src: 'other' }
  try {
    localStorage.setItem(ORIGIN_KEY, JSON.stringify(origin))
  } catch {}
}

export function lobbyOrigin(): { src: string; mode?: string; id?: string } | null {
  try {
    const raw = localStorage.getItem(ORIGIN_KEY)
    return raw ? (JSON.parse(raw) as { src: string; mode?: string; id?: string }) : null
  } catch {
    return null
  }
}

/** Поля события для game_launch / server_join: источник + происхождение выбора в лобби. */
export function launchAttribution(fallback: LaunchSource = 'other'): Record<string, string> {
  const a = actionSource(fallback)
  const out: Record<string, string> = { source: a.source }
  if (a.mode) out.mode = a.mode
  if (a.srcId) out.srcId = a.srcId.slice(0, 64)
  if (a.source === 'lobby_play') {
    const o = lobbyOrigin()
    if (o?.src) out.origin = o.src
    if (o?.mode && !out.mode) out.mode = o.mode
  }
  return out
}

// ---------------------------------------------------------------------------
// Показы карточек (для CTR «Рекомендуем» / «Для тебя» / режимов): одно событие
// на блок со списком id, не чаще раза в сессию на один и тот же набор.

const seenImpressions = new Set<string>()

export function trackImpression(section: string, ids: (string | null | undefined)[], screen?: string) {
  if (!telemetryEnabled()) return
  const list = ids.filter((x): x is string => !!x).map((x) => x.slice(0, 48))
  if (!list.length) return
  let joined = ''
  for (const id of list) {
    const next = joined ? joined + ',' + id : id
    if (next.length > 118) break
    joined = next
  }
  const key = section + '|' + joined
  if (seenImpressions.has(key)) return
  seenImpressions.add(key)
  track('impression', { section: section.slice(0, 32), screen: (screen || currentScreen()).slice(0, 24), ids: joined, n: list.length })
}

// ---------------------------------------------------------------------------

let screenOf: () => string = () => 'unknown'
const currentScreen = () => {
  try {
    return screenOf()
  } catch {
    return 'unknown'
  }
}

let lastEl: unknown = null
let lastAt = 0
let sent = 0

function onClick(e: MouseEvent) {
  if (!telemetryEnabled()) return
  if (e.button !== 0) return
  const t = e.target as unknown as TrackNode | null
  if (!t || typeof (t as TrackNode).closest !== 'function') return
  const info = describeClick(t, currentScreen())
  if (!info) return
  const el = t.closest(CLICKABLE)
  const now = performance.now()
  if (el === lastEl && now - lastAt < DEDUPE_MS) return
  lastEl = el
  lastAt = now
  if (info.src) noteIntent(info.src, { id: info.id, kind: info.kind, mode: info.mode })
  if (sent >= SESSION_CAP) return
  sent += 1
  const data: Record<string, string | number> = { screen: info.screen, el: info.el }
  if (info.section) data.section = info.section
  if (info.id) data.id = info.id
  if (info.kind) data.kind = info.kind
  if (info.pos !== undefined) data.pos = info.pos
  if (info.src) data.src = info.src
  if (info.mode) data.mode = info.mode
  track('ui_click', data)
}

const INIT_FLAG = '__millidaUiTrackInit'

/**
 * Включает сбор кликов и `screen_view` на каждую смену экрана.
 * `getScreen` — текущий экран; `subscribeScreen` — подписка на его смену.
 */
export function initUiTracking(getScreen: () => string, subscribeScreen?: (cb: (s: string, prev: string) => void) => () => void) {
  screenOf = getScreen
  const w = window as unknown as Record<string, boolean>
  if (w[INIT_FLAG]) return
  w[INIT_FLAG] = true
  // Capture: карточка может остановить всплытие, а клик всё равно был.
  document.addEventListener('click', onClick, true)
  const unsub = subscribeScreen?.((s, prev) => {
    if (s !== prev) track('screen_view', { screen: s, from: prev })
  })
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      document.removeEventListener('click', onClick, true)
      unsub?.()
      w[INIT_FLAG] = false
    })
  }
}
