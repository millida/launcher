import { describe, expect, mock, test } from 'bun:test'

mock.module('../i18n', () => ({
  t: (s: string, v?: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_m, k) => String(v?.[k] ?? '')),
}))
const { achievementSources, achievementNote } = await import('./achievementSource')

const item = (code: string) => ({ code, name: code, slot: 'HEAD', rarity: 'RARE', preview: null }) as never

describe('achievementSources', () => {
  const src = achievementSources({
    achievements: [
      { code: 'a', title: 'Первый шаг', points: 10, done: false, reward: { kind: 'ITEM', item: item('HALO') } },
      { code: 'b', title: 'Копилка', points: 10, done: false, reward: { kind: 'SHARDS', amount: 50 } },
    ],
    pointItems: [{ points: 150, item: item('CROWN'), owned: false }],
  })

  test('вещь-награда называет своё достижение', () => {
    expect(src.get('HALO')).toBe('Достижение «Первый шаг»')
  })
  test('награда осколками вещи не даёт', () => {
    expect(src.size).toBe(2)
  })
  test('веха по очкам называет порог', () => {
    expect(src.get('CROWN')).toBe('150 очков достижений')
  })
  test('расцветка находится по базовой вещи, неизвестная вещь — без выдумки', () => {
    expect(achievementNote(src, 'HALO~red', 'HALO')).toBe('Достижение «Первый шаг»')
    expect(achievementNote(src, 'UNKNOWN')).toBeUndefined()
  })
  test('нет данных — пустая карта', () => {
    expect(achievementSources(null).size).toBe(0)
  })
})
