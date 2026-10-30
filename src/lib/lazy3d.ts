import { useEffect, useState } from 'react'
import { whenIdle } from './idle'
import { weakOn } from './liteMode'

/*
 * Когда можно грузить three.js (≈735 КБ) и собирать WebGL-сцену. Правило (26.10.2026):
 *  - слабый ПК (≤4 ГБ, ≤2 ядра, программная графика, упавший WebGL, «Слабый ПК» в настройках) — никогда;
 *    встроенная видеокарта под это не подпадает: персонаж есть, но после простоя, а стекло режет лёгкий режим;
 *  - иначе — после простоя окна, а не вместе с экраном: экран успевает нарисоваться с картинкой.
 */

/** Тишина перед первой загрузкой three.js, мс. */
export const QUIET_FIRST_MS = 900
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

/** Хук: `true`, когда пора монтировать 3D-сцену (после простоя); на слабом ПК не наступает никогда. */
export function useIdle3d(active: boolean): boolean {
  const allowed = lobby3dAllowed()
  const [want, setWant] = useState(false)
  useEffect(() => {
    if (!allowed || want || !active) return
    return whenIdle(() => setWant(true), loaded ? QUIET_RETURN_MS : QUIET_FIRST_MS, MAX_WAIT_MS)
  }, [allowed, want, active])
  return allowed && want
}
