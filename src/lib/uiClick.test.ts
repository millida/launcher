import { describe, expect, test } from 'bun:test'
import { cleanLabel, describeClick } from './uiClick'
import type { TrackNode } from './uiClick'

/** Крошечный фейковый DOM: тег, атрибуты, текст и родитель. closest понимает [attr] и имена тегов/role. */
function node(tag: string, attrs: Record<string, string> = {}, text = '', parent: TrackNode | null = null): TrackNode {
  const n: TrackNode = {
    tagName: tag.toUpperCase(),
    textContent: text,
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
    closest(selector: string) {
      const parts = selector.split(',').map((x) => x.trim())
      let cur: TrackNode | null = n
      while (cur) {
        const c: TrackNode = cur
        const ok = parts.some((p) => {
          const attr = p.match(/^\[([a-z-]+)(?:="([^"]+)")?\]$/)
          if (attr) return attr[2] ? c.getAttribute(attr[1]) === attr[2] : c.hasAttribute(attr[1])
          if (/^[a-z]+$/.test(p)) return c.tagName.toLowerCase() === p
          if (p === 'a[href]') return c.tagName === 'A' && c.hasAttribute('href')
          return false
        })
        if (ok) return c
        cur = (c as unknown as { parent: TrackNode | null }).parent
      }
      return null
    },
  }
  ;(n as unknown as { parent: TrackNode | null }).parent = parent
  return n
}

describe('cleanLabel', () => {
  test('схлопывает пробелы, режет до 40, цифры в #', () => {
    expect(cleanLabel('  Купить   за 150 руб ')).toBe('Купить за # руб')
    expect(cleanLabel('x'.repeat(60))).toHaveLength(40)
    expect(cleanLabel('1.20.1 Fabric')).toBe('# Fabric')
  })
  test('похожее на почту не собираем', () => {
    expect(cleanLabel('me@mail.ru')).toBe('')
  })
})

describe('describeClick', () => {
  test('data-track, секция, id, kind, позиция и источник от предков', () => {
    const section = node('section', { 'data-section': 'foryou', 'data-src': 'foryou' })
    const card = node('button', { 'data-id': 'arcania', 'data-kind': 'pack', 'data-pos': '2' }, 'Arcania 12 игроков', section)
    const span = node('span', {}, 'Arcania', card)
    expect(describeClick(span, 'playhub')).toEqual({
      screen: 'playhub',
      section: 'foryou',
      el: 'Arcania # игроков',
      id: 'arcania',
      kind: 'pack',
      pos: 2,
      src: 'foryou',
    })
  })

  test('в приватной зоне текст кнопки не уходит', () => {
    const list = node('div', { 'data-private': '', 'data-section': 'friends' })
    const btn = node('button', {}, 'Vasya_2010', list)
    expect(describeClick(btn, 'friends')).toEqual({ screen: 'friends', section: 'friends', el: 'private' })
    const named = node('button', { 'data-track': 'friend_open' }, 'Vasya_2010', list)
    expect(describeClick(named, 'friends')?.el).toBe('friend_open')
    const withId = node('button', { 'data-track': 'friend_open', 'data-id': 'u-42', 'data-kind': 'dm', 'data-mode': 'call' }, '', list)
    expect(describeClick(withId, 'friends')).toEqual({ screen: 'friends', section: 'friends', el: 'friend_open' })
  })

  test('disabled и data-notrack не пишутся, не-кнопки игнорируются', () => {
    expect(describeClick(node('button', { disabled: '' }, 'Играть'), 'play')).toBeNull()
    const quiet = node('div', { 'data-notrack': '' })
    expect(describeClick(node('button', {}, 'x', quiet), 'play')).toBeNull()
    expect(describeClick(node('div', {}, 'просто текст'), 'play')).toBeNull()
  })

  test('режим берётся у контейнера', () => {
    const page = node('div', { 'data-mode': 'BEDWARS', 'data-section': 'mode' })
    const row = node('button', { 'data-id': 'mc.hypixel.net', 'data-kind': 'server', 'data-src': 'mode' }, 'Hypixel', page)
    const info = describeClick(row, 'playhub')
    expect(info?.mode).toBe('BEDWARS')
    expect(info?.src).toBe('mode')
  })
})
