import { useSyncExternalStore } from 'react'
import { liteVerdict, perfOverride, weakVerdict, webviewGpu, type LiteInput } from './deviceTier'
import { gpuLite, onGpuLite } from './gpuLite'
import { cachedHardware, learnHardware } from './hardwareHint'
import { hasTauri } from '../ipc/tauri'
import { whenIdle } from './idle'

/**
 * Лёгкий режим интерфейса (26.10.2026). Класс `m-lite` на <html> включает
 * styles/13-lite.css: без стекла (backdrop-filter), без бесконечных украшательских
 * анимаций; видеофоны и живая обложка Arcania заменяются картинкой. Решает железо
 * (по данным ядра: ≤6 ГБ, ≤2 физических ядра, нет аппаратной или слабая видеокарта, упавший WebGL) заранее, до первых тормозов,
 * ручной выбор в настройках («Авто / Полное / Слабый ПК») главнее.
 */

export const LITE_CLASS = 'm-lite'

const nav = (): Navigator & { deviceMemory?: number } =>
  (typeof navigator === 'undefined' ? {} : navigator) as Navigator & { deviceMemory?: number }

const input = (): LiteInput => ({
  deviceMemory: nav().deviceMemory,
  hardwareConcurrency: nav().hardwareConcurrency,
  forced: perfOverride(),
  gpuLite: gpuLite(),
  gpu: webviewGpu(),
  hw: cachedHardware(),
})

/** Лёгкий ли режим сейчас — по железу, ручному выбору и упавшему WebGL. */
export function liteOn(): boolean {
  return liteVerdict(input())
}

/** Слабый ПК в узком смысле (≤6 ГБ, ≤2 физических ядра, программная графика, упавший WebGL): три-D не грузим вообще. */
export function weakOn(): boolean {
  return weakVerdict(input())
}

const subs = new Set<() => void>()
let on = false
let started = false

/** Подписка на смену режима (настройка «Графика», упавший WebGL). */
export function onLiteChange(cb: () => void): () => void {
  subs.add(cb)
  return () => {
    subs.delete(cb)
  }
}

function apply() {
  const next = liteOn()
  if (next === on) return
  on = next
  document.documentElement.classList.toggle(LITE_CLASS, on)
  subs.forEach((f) => f())
}

/** Ставит класс до первого кадра и следит за сменой настройки. Один раз на окно. */
export function initLiteMode(): void {
  if (started || typeof document === 'undefined') return
  started = true
  apply()
  // Настройка «Графика» шлёт это событие (state/viewPrefs); имя видеокарты приходит от первой сцены WebGL.
  window.addEventListener('m-view-prefs', apply)
  onGpuLite(apply)
  // Первый запуск на этом ПК: железа в памяти ещё нет — спрашиваем ядро в простое и пересчитываем.
  // Уже знакомый ПК освежает сведения без спешки (сменили видеокарту).
  if (hasTauri()) whenIdle(() => void learnHardware().then(apply), cachedHardware() ? 5000 : 300)
}

/** Хук: перерисоваться, когда лёгкий режим включился или выключился. */
export function useLiteMode(): boolean {
  return useSyncExternalStore(onLiteChange, () => on, () => on)
}
