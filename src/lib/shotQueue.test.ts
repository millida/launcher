import { describe, expect, test } from 'bun:test'
import { pickJob, shotRank } from './shotQueue'

const el = (top: number, h = 200) => ({ isConnected: true, getBoundingClientRect: () => ({ top, bottom: top + h, left: 0, right: 200, width: 200, height: h }) }) as unknown as Element

describe('очередь снимков: видимое первым', () => {
  test('видимая плитка обгоняет раньше попросившие за экраном', () => {
    expect(pickJob([{ at: 0, rank: 2 }, { at: 1, rank: 1 }, { at: 2, rank: 0 }])).toBe(2)
  })
  test('при равной видимости — по очереди', () => {
    expect(pickJob([{ at: 3, rank: 0 }, { at: 1, rank: 0 }])).toBe(1)
    expect(pickJob([])).toBe(-1)
  })
  test('ранг по положению в окне', () => {
    ;(globalThis as { window?: unknown }).window ??= { innerWidth: 1440, innerHeight: 900 }
    expect(shotRank(el(100), 900)).toBe(0)
    expect(shotRank(el(1000), 900)).toBe(1)
    expect(shotRank(el(3000), 900)).toBe(2)
    expect(shotRank(null, 900)).toBe(2)
  })
})
