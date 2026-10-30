// Фоновая работа лаунчера (предзагрузка экранов, тяжёлые подвалы интерфейса) идёт
// только в полном простое: человек ничего не нажимает, главный поток не занят
// долгими задачами, окно видно. Иначе предзагрузка ложится на первые секунды
// после входа на экран и добавляет к ним свою заморозку.

/** Задача от этой длительности сбрасывает отсчёт тишины, мс. */
const BUSY_TASK_MS = 120

let started = false
let lastBusy = typeof performance !== 'undefined' ? performance.now() : 0
let touched = false
const touchWaiters: Array<() => void> = []

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function start() {
  if (started || typeof window === 'undefined') return
  started = true
  const touch = () => {
    lastBusy = now()
    if (touched) return
    touched = true
    touchWaiters.splice(0).forEach((f) => f())
  }
  // Нажатие, клавиша, колесо — это работа руками: простой отсчитывается заново.
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, touch, { passive: true, capture: true })
  // Движение мыши — признак «человек здесь», но простой не сбрасывает.
  const presence = () => {
    window.removeEventListener('pointermove', presence, true)
    if (touched) return
    touched = true
    touchWaiters.splice(0).forEach((f) => f())
  }
  window.addEventListener('pointermove', presence, { passive: true, capture: true })
  try {
    // Тяжёлые задачи считаем занятостью: пока они идут, ничего не подгружаем. Порог выше
    // «длинной задачи» браузера (50 мс): ровный тик в 60 мс раз в секунду (часы, отсчёты)
    // простой не срывает, иначе на слабом ПК он не наступил бы никогда.
    new PerformanceObserver((list) => {
      if (list.getEntries().some((e) => e.duration >= BUSY_TASK_MS)) lastBusy = now()
    }).observe({ entryTypes: ['longtask'] })
  } catch (e) {
    // An old WebView has no longtask entries: idle then judges by the frame timer alone.
    console.warn('[idle] long tasks are not observable here', e)
  }
}

/** Человек уже работал с окном (двигал мышью, нажимал, листал). */
export function interacted(): boolean {
  start()
  return touched
}

/** Разрешится после первого взаимодействия с окном. */
export function afterFirstInteraction(): Promise<void> {
  start()
  if (touched) return Promise.resolve()
  return new Promise((res) => touchWaiters.push(res))
}

/**
 * Вызывает cb, когда окно простояло `quietMs` без нажатий и тяжёлых задач, видно,
 * а у браузера есть свободное время. Если тишины нет `maxWaitMs` (окно нагружено постоянно,
 * например живой экран на слабом ПК), всё равно вызывает на ближайшем свободном кадре:
 * отложенное не должно откладываться навсегда. Возвращает отмену.
 */
export function whenIdle(cb: () => void, quietMs = 600, maxWaitMs = 8000): () => void {
  start()
  const since = now()
  let stopped = false
  let timer = 0
  const ric = (window as unknown as { requestIdleCallback?: (f: (d: { timeRemaining(): number; didTimeout: boolean }) => void, o?: { timeout: number }) => number })
    .requestIdleCallback
  const tick = () => {
    if (stopped) return
    if (document.hidden) {
      timer = window.setTimeout(tick, 2000)
      return
    }
    const wait = quietMs - (now() - lastBusy)
    if (wait > 0 && now() - since < maxWaitMs) {
      timer = window.setTimeout(tick, wait + 20)
      return
    }
    if (!ric) {
      timer = window.setTimeout(() => !stopped && cb(), 0)
      return
    }
    ric(
      (d) => {
        if (stopped) return
        if (keepWaiting(d.didTimeout, d.timeRemaining(), now() - since, maxWaitMs)) {
          timer = window.setTimeout(tick, 250)
          return
        }
        cb()
      },
      { timeout: 3000 },
    )
  }
  timer = window.setTimeout(tick, 0)
  return () => {
    stopped = true
    window.clearTimeout(timer)
  }
}

/** Свободных мс в кадре, ради которых стоит подождать ещё. */
const FREE_FRAME_MS = 8

/** A 144 Hz frame never has 8 ms free: past `maxWaitMs` any frame will do, or the wait never ends. */
export function keepWaiting(didTimeout: boolean, remainingMs: number, waitedMs: number, maxWaitMs: number): boolean {
  return !didTimeout && remainingMs < FREE_FRAME_MS && waitedMs < maxWaitMs
}

/** То же, что whenIdle, но промисом (отмены нет: ждать не страшно). */
export const idle = (quietMs = 600, maxWaitMs = 8000) => new Promise<void>((res) => void whenIdle(res, quietMs, maxWaitMs))

/** Только для тестов. */
export function _resetIdle() {
  lastBusy = now()
  touched = false
  touchWaiters.length = 0
}
