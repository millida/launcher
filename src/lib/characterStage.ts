import { LAUNCHER_API } from './api'
import { idbGet, idbSet } from './idbCache'
import type { SkinAnimId } from '../vendor/mine3d'
import { loadCosmeticModel } from './gameProfile'
import type { CosmeticModelFile } from './gameProfile'

/// Общее для всех сцен с персонажем: гардероб и главная показывают одну и ту же
/// фигуру, и свет, покой и набор движений у них не должны расходиться.

export const MILLIDA_LIGHT = {
  keyAzimuthDeg: 52,
  keyElevationDeg: 38,
  keyIntensity: 2.05,
  ambientIntensity: 0.32,
  fillIntensity: 0.46,
  shadowRadius: 4.8,
  shadowIntensity: 0.66,
}

/// Клипы автопоказа и их длительность. Анимации зациклены и не сообщают о
/// конце, поэтому каждая обрывается по времени: длительность подобрана кратно
/// периоду её собственного цикла, чтобы возврат в покой не резал позу пополам.
/// Из десяти анимаций взяты пять: sneak и glide уводят корпус за пределы сцены
/// 190x270 (position.y -1.5 и наклон -0.72), sad читается как ошибка, а run
/// раскачивает всю фигуру по x — выглядело как «персонаж уезжает вбок»
/// (владелец 23.09.2026).
/**
 * Свет витрины (снимки карточек и сцены наборов в магазине). Тени от
 * карты теней выключены: вещи из каталога (питомцы, реквизит эмоций) теней
 * не отбрасывают и не принимают, а тело отбрасывает — рядом с вороном или
 * поднятой для поцелуя рукой на фигуре появлялись тёмные пятна слева, без
 * видимой причины (владелец 06.10.2026: «рандомные тени»). Объём держат
 * заполняющий свет и мягкая тень-пятно под ногами — одинаково для всего.
 */
export const SHOP_LIGHT = { ...MILLIDA_LIGHT, castShadows: false, ambientIntensity: 0.4, fillIntensity: 0.62 }

/** Витрина, лёгкие движения: оглядеться и помахать — без танцев и облачков. */
export const SHOP_SHOW: { id: SkinAnimId; ms: number }[] = [
  { id: 'look', ms: 7390 },
  { id: 'wave', ms: 3770 },
]

export const IDLE_SHOW: { id: SkinAnimId; ms: number }[] = [
  { id: 'wave', ms: 3770 },
  { id: 'look', ms: 7390 },
  { id: 'cool', ms: 4500 },
  { id: 'dance', ms: 4245 },
  { id: 'victory', ms: 4054 },
]

export const IDLE_SHOW_FIRST_MIN = 1200
export const IDLE_SHOW_FIRST_MAX = 2500
export const IDLE_SHOW_GAP_MIN = 2500
export const IDLE_SHOW_GAP_MAX = 5000

export const between = (min: number, max: number) => min + Math.random() * (max - min)

/**
 * Кадр гардероба. Тело — меньше половины высоты сцены и чуть ниже середины:
 * крылья, шляпа и питомец на голове по умолчанию помещаются целиком, а
 * разглядеть мелочь можно колесом (владелец 24.09.2026: «персонаж дальше,
 * чтобы любые вещи помещались»). Было 0.58 по центру — крылья и питомец
 * упирались в край.
 */
export const FULL_FILL_Y = 0.44
/** Центр тела в координатах кадра (-1…1): ниже середины — место над головой. */
export const FULL_OFFSET_Y = -0.1

/** Сколько поворота даёт пиксель движения мыши. */
export const TURN_PER_PIXEL = 0.012

/**
 * Скачанные модели держим в памяти до конца сеанса: сервер отдаёт их под
 * суточный потолок, а на примерке одну и ту же вещь надевают и снимают
 * по нескольку раз.
 */
export const MODEL_CACHE = new Map<string, Promise<CosmeticModelFile | null>>()

/**
 * Модель с прошлого запуска берётся из IndexedDB без сети; старше шести часов
 * - обновляется в фоне. Новая вещь качается как раньше.
 */
const MODEL_REFRESH_MS = 6 * 3600_000

async function storedModel(modelId: string): Promise<CosmeticModelFile> {
  const key = 'cosmetic-model:' + modelId
  const row = await idbGet<CosmeticModelFile>(key)
  if (row && row.value && row.value.geometry) {
    if (Date.now() - row.at > MODEL_REFRESH_MS) {
      void loadCosmeticModel(modelId)
        .then((m) => m && m.geometry && idbSet(key, m))
        .catch(() => {})
    }
    return row.value
  }
  const fresh = await loadCosmeticModel(modelId)
  if (fresh && fresh.geometry) void idbSet(key, fresh)
  return fresh
}

export function cosmeticModel(modelId: string): Promise<CosmeticModelFile | null> {
  const ready = MODEL_CACHE.get(modelId)
  if (ready) return ready
  // Неудачу не держим: сорванный запрос иначе запоминал бы вещь как пустую до
  // перезапуска, и примерка у неё не работала бы весь вечер.
  const asked = (import.meta.env.DEV && devModels() ? devModel(modelId).then((m) => m ?? storedModel(modelId)) : storedModel(modelId)).catch(() => {
    MODEL_CACHE.delete(modelId)
    return null
  })
  MODEL_CACHE.set(modelId, asked)
  return asked
}

/**
 * Только dev: в ?preview (и в витрине экономики) модели берутся из репозитория
 * мода через dev-сервер Vite (scripts/dev-cosmetic-models.mjs) — прод отдаёт их
 * лишь вошедшему, и демо-персонаж стоял голым. В сборке ветки нет.
 */
function devModels(): boolean {
  try {
    return (
      !('__TAURI_INTERNALS__' in window) &&
      (new URLSearchParams(location.search).has('preview') || import.meta.env.VITE_ECONOMY_SHOWCASE === '1')
    )
  } catch {
    return false
  }
}

function devModel(modelId: string): Promise<CosmeticModelFile | null> {
  return fetch('/__dev/cosmetic-models/' + encodeURIComponent(modelId))
    .then((r) => (r.ok ? (r.json() as Promise<CosmeticModelFile>) : null))
    .then((m) => (m && m.geometry ? m : null))
    .catch(() => null)
}

/** Скин по нику — тот же адрес, что у гардероба. */
export const nickSkinUrl = (nick: string) => LAUNCHER_API + '/heads/skin/' + encodeURIComponent(nick)
/** Скин для публичных мест (топ): сервер подменяет непроверенный и недопустимый стандартным. */
export const safeSkinUrl = (nick: string) => nickSkinUrl(nick) + '?safe=1'

/**
 * Снести сцену и отдать её графический контекст сразу. mine3d.dispose() зовёт
 * renderer.dispose(), но контекст WebGL остаётся жить до сборки мусора, а экраны
 * лаунчера пересоздают сцену при каждом заходе. В WKWebView контекстов мало:
 * при переполнении браузер отбирает самый старый — и живой персонаж оставался
 * без скина (владелец 23.09.2026: «иногда скины пропадают»).
 */
export function releaseEngine(engine: { dispose(): void }): void {
  const renderer = (engine as unknown as { renderer?: { forceContextLoss?: () => void } }).renderer
  engine.dispose()
  try {
    renderer?.forceContextLoss?.()
  } catch {}
}

type Ndc = { minX: number; maxX: number; minY: number; maxY: number }

/**
 * Где встаёт ник: по центру тела и над самой высокой вещью. Кадр движок
 * считает по одному телу, а габарит с вещами отдаёт отдельно (outfit) —
 * центр по нему съезжал бы за крылом. Выше края кадра ник не уходит.
 */
export function tagBox(r: { ndc: Ndc; outfit?: Ndc }): { minX: number; maxX: number; maxY: number } {
  const top = Math.max(r.ndc.maxY, r.outfit ? r.outfit.maxY : r.ndc.maxY)
  return { minX: r.ndc.minX, maxX: r.ndc.maxX, maxY: Math.min(top, 0.9) }
}

/**
 * Где стоит фигура в лобби. Ноги — на 62% высоты сцены: ниже под ними кнопка
 * «Гардероб», и при ногах у самого низа ноги, кнопка и нижняя плашка слипались
 * (владелец 23.09.2026). Рост — не больше 0.73 кадра (на 13% меньше прежних
 * 0.84: «чуть меньше, чтобы стоял подальше»), но и не выше, чем оставляет место
 * под ник над головой: при поднятых ногах это решает высота окна.
 */
const LOBBY_FEET_AT = 0.77
// Крупнее (владелец 24.09.2026, 07:44: «персонаж маленький какой-то»).
const LOBBY_MAX_FILL_Y = 0.62
/** Над макушкой: ник (~25px) и зазор до края сцены. */
// Ника над головой больше нет (владелец 24.09.2026, 13:23) — место под рост.
const LOBBY_HEAD_ROOM_PX = 150

/** Кадр фигуры в сцене высотой h, стоящей на top от верха сцены высотой scene. */
export function lobbyFrame(h: number, top: number, scene: number): { fillY: number; offsetY: number } {
  const feetPx = Math.min(h - 4, Math.max(0, LOBBY_FEET_AT * scene - top))
  const feet = 1 - (2 * feetPx) / h
  const head = 1 - (2 * LOBBY_HEAD_ROOM_PX) / h
  const fillY = Math.max(0.3, Math.min(LOBBY_MAX_FILL_Y, (head - feet) / 2))
  return { fillY, offsetY: feet + fillY }
}

/**
 * Где клик по лобби ведёт в «Мой скин»: коробка вокруг самой фигуры, а не
 * вся сцена на 80% ширины окна (владелец 25.09.2026: «кликаю далеко от
 * персонажа и попадаю в гардероб»). На окне по умолчанию площадь вдвое
 * меньше прежней: ширина — полтора роста, по высоте запас над головой.
 */
export const LOBBY_HIT_WIDTH = 1.5
export const LOBBY_HIT_ABOVE = 0.3
export const LOBBY_HIT_BELOW = 0.1

export function lobbyHitBox(ndc: Ndc, w: number, h: number): { left: number; top: number; width: number; height: number } {
  const top = ((1 - ndc.maxY) / 2) * h
  const bottom = ((1 - ndc.minY) / 2) * h
  const tall = Math.max(0, bottom - top)
  const cx = ((ndc.minX + ndc.maxX) / 2 + 1) / 2 * w
  const width = Math.min(w, tall * LOBBY_HIT_WIDTH)
  const y0 = Math.max(0, top - tall * LOBBY_HIT_ABOVE)
  const y1 = Math.min(h, bottom + tall * LOBBY_HIT_BELOW)
  return { left: Math.max(0, cx - width / 2), top: y0, width, height: Math.max(0, y1 - y0) }
}
