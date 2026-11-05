import { useEffect, useState } from 'react'
import { currentDeviceTier } from './deviceTier'
import { whenIdle } from './idle'
import { weakOn } from './liteMode'

/*
 * Когда можно грузить three.js (≈735 КБ) и собирать WebGL-сцену. Правило (26.10.2026):
 *  - слабый ПК (≤4 ГБ, ≤2 ядра, программная графика, упавший WebGL, «Слабый ПК» в настройках) — никогда;
 *    встроенная видеокарта под это не подпадает: персонаж есть, но после простоя, а стекло режет лёгкий режим;
 *  - иначе — после простоя окна, а не вместе с экраном: экран успевает нарисоваться с картинкой.
 * 04.11.2026 («персонаж стоит статично 2–3 секунды на запуске»): тишина по силе ПК — сильный ждёт
 * только первый кадр экрана, средний — короткую паузу, слабый — как прежде.
 */

/** Тишина перед первой загрузкой three.js, мс. */
export const QUIET_FIRST_MS = 900
/** То же на ПК среднего уровня (lib/deviceTier); сильный ждёт только первый кадр экрана. */
export const QUIET_FIRST_MID_MS = 250
/** Дольше этого не ждём тишины: на нагруженном экране 3D всё равно приходит. */
export const MAX_WAIT_MS = 5000
/** То же, когда код уже разобран: ждём только свободный кадр. */
export const QUIET_RETURN_MS = 250

let loaded = false
let firstIdle: Promise<void> | null = null

/** Можно ли вообще грузить 3D. */
export const lobby3dAllowed = () => !weakOn()

/** Первая 3D-сцена показана: дальше код в памяти, ждать тишину долго не нужно. */
export const mark3dLoaded = () => {
  loaded = true
}

/** Разрешится `true` после простоя (общему для всех, кто ждёт), `false` — если 3D здесь не положен. */
export function idle3d(): Promise<boolean> {
  if (!lobby3dAllowed()) return Promise.resolve(false)
  if (loaded) return Promise.resolve(true)
  if (!firstIdle) firstIdle = new Promise((res) => void whenIdle(res, QUIET_FIRST_MS, MAX_WAIT_MS))
  return firstIdle.then(() => lobby3dAllowed())
}

/** Сколько тишины ждать перед первой сценой на этом ПК; null — только первый кадр экрана. */
export function firstQuietMs(tier = currentDeviceTier()): number | null {
  if (tier === 'high') return null
  return tier === 'mid' ? QUIET_FIRST_MID_MS : QUIET_FIRST_MS
}

/** Сколько тишины ждать перед загрузкой кода 3D; null — первый кадр лобби. На слабом уровне разбор three.js не должен лечь на открытие лобби. */
export function preloadQuietMs(tier = currentDeviceTier()): number | null {
  return tier === 'low' ? QUIET_FIRST_MS : null
}

/** Вызвать после того, как экран нарисовал первый кадр (кадр, и задача за ним). Возвращает отмену. */
function afterFirstFrame(cb: () => void): () => void {
  let timer = 0
  const raf = requestAnimationFrame(() => {
    timer = window.setTimeout(cb, 0)
  })
  return () => {
    cancelAnimationFrame(raf)
    window.clearTimeout(timer)
  }
}

/** Хук: `true`, когда пора монтировать 3D-сцену (после простоя); на слабом ПК не наступает никогда. */
export function useIdle3d(active: boolean): boolean {
  const allowed = lobby3dAllowed()
  const [want, setWant] = useState(false)
  useEffect(() => {
    if (!allowed || want || !active) return
    const go = () => setWant(true)
    if (loaded) return whenIdle(go, QUIET_RETURN_MS, MAX_WAIT_MS)
    const quiet = firstQuietMs()
    return quiet === null ? afterFirstFrame(go) : whenIdle(go, quiet, MAX_WAIT_MS)
  }, [allowed, want, active])
  return allowed && want
}
