import { describe, expect, test } from 'bun:test'
import { LogFeed } from './gameLogFeed'

const lines = (from: number, n: number) => Array.from({ length: n }, (_, i) => 'l' + (from + i))

describe('LogFeed: окно лога, открытое посреди игры, видит всё и без повторов', () => {
  test('снимок с начала запуска, потом новые пачки', () => {
    const f = new LogFeed(100)
    f.syncing()
    f.snapshot({ profile: 'Big', seq: 0, lines: lines(0, 3) })
    f.batch({ seq: 3, lines: lines(3, 2) })
    expect(f.lines).toEqual(lines(0, 5))
    expect(f.profile).toBe('Big')
  })

  test('пачка, которая уже вошла в снимок, не повторяется — даже если пришла после него', () => {
    const f = new LogFeed(100)
    f.syncing()
    f.batch({ seq: 2, lines: lines(2, 2) })
    f.snapshot({ profile: 'Big', seq: 0, lines: lines(0, 4) })
    f.batch({ seq: 4, lines: lines(4, 1) })
    expect(f.lines).toEqual(lines(0, 5))
  })

  test('пачка наполовину в снимке — добавляется только хвост', () => {
    const f = new LogFeed(100)
    f.syncing()
    f.snapshot({ profile: 'Big', seq: 10, lines: lines(10, 3) })
    expect(f.batch({ seq: 12, lines: lines(12, 3) })).toBe(true)
    expect(f.lines).toEqual(lines(10, 5))
  })

  test('окно держит не больше своего предела на любой длине сессии', () => {
    const f = new LogFeed(50)
    f.syncing()
    f.snapshot({ profile: 'Big', seq: 0, lines: [] })
    for (let i = 0; i < 2000; i++) f.batch({ seq: i * 10, lines: lines(i * 10, 10) })
    expect(f.lines.length).toBe(50)
    expect(f.lines[f.lines.length - 1]).toBe('l19999')
  })

  test('новый запуск начинает с пустого', () => {
    const f = new LogFeed(100)
    f.syncing()
    f.snapshot({ profile: 'A', seq: 0, lines: lines(0, 3) })
    f.start('B')
    f.batch({ seq: 3, lines: ['new'] })
    expect([f.profile, f.lines]).toEqual(['B', ['new']])
  })

  test('ядро не ответило — показываем то, что пришло пачками', () => {
    const f = new LogFeed(100)
    f.syncing()
    f.batch({ seq: 7, lines: ['x'] })
    f.snapshot(null)
    expect(f.lines).toEqual(['x'])
  })
})
