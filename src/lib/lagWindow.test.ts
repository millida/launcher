import { describe, expect, test } from 'bun:test'
import { LAG_FPS, LagWindow } from './lagWindow'

const base = { world: true, throttled: false, focused: true, heapMb: 1000, maxMb: 4096, gcPct: 1 }

/** Подаёт окна по 5 с, начиная с `from`; возвращает первый вердикт и время, когда он пришёл. */
function feed(w: LagWindow, fps: (i: number) => number, count: number, from = 0, extra: Partial<typeof base> = {}) {
  for (let i = 0; i < count; i++) {
    const v = w.push({ ...base, ...extra, fps: fps(i) }, from + i * 5000)
    if (v) return { v, at: from + i * 5000 }
  }
  return null
}

describe('LagWindow: лаг — это минута низкого FPS в мире, а не просадка', () => {
  test('минута по 20 FPS после загрузки мира — лаг', () => {
    const got = feed(new LagWindow(), () => 20, 40)
    expect(got?.v.fps).toBe(20)
    // 45 с на прогрузку чанков + 10 окон: раньше 90 с судить нельзя.
    expect(got!.at).toBeGreaterThanOrEqual(90_000)
  })

  test('20 FPS только первые 45 с после входа в мир — не лаг: грузятся чанки', () => {
    expect(feed(new LagWindow(), (i) => (i < 9 ? 15 : 90), 40)).toBeNull()
  })

  test('разовые просадки на фоне нормальных кадров — не лаг', () => {
    expect(feed(new LagWindow(), (i) => (i % 4 === 0 ? 8 : 70), 60)).toBeNull()
  })

  test('кадры, которые игрок сам ограничил (фон, батарея), — не лаг', () => {
    expect(feed(new LagWindow(), () => 10, 60, 0, { throttled: true })).toBeNull()
  })

  test('игра за другим окном — не лаг', () => {
    expect(feed(new LagWindow(), () => 10, 60, 0, { focused: false })).toBeNull()
  })

  test('ровно порог — не лаг', () => {
    expect(feed(new LagWindow(), () => LAG_FPS, 60)).toBeNull()
  })

  test('меню и загрузка сбрасывают отсчёт: вход в новый мир снова ждёт 45 с', () => {
    const w = new LagWindow()
    feed(w, () => 90, 20)
    for (let i = 0; i < 3; i++) w.push({ ...base, world: false, fps: 60 }, 100_000 + i * 5000)
    const got = feed(w, () => 20, 40, 120_000)
    expect(got!.at - 120_000).toBeGreaterThanOrEqual(90_000)
  })

  test('сундук на пару секунд не сбрасывает минуту', () => {
    const w = new LagWindow()
    expect(feed(w, () => 20, 18)).toBeNull()
    w.push({ ...base, world: false, fps: 60 }, 90_000)
    expect(feed(w, () => 20, 2, 95_000)?.v.fps).toBe(20)
  })

  test('сборщик мусора съедает время — причина в памяти', () => {
    expect(feed(new LagWindow(), () => 20, 40, 0, { gcPct: 25 })?.v.memory).toBe(true)
  })

  test('куча почти полна — причина в памяти', () => {
    expect(feed(new LagWindow(), () => 20, 40, 0, { heapMb: 3900 })?.v.memory).toBe(true)
  })

  test('памяти хватает — причина не в ней', () => {
    expect(feed(new LagWindow(), () => 20, 40)?.v.memory).toBe(false)
  })
})
