import { describe, expect, test } from 'bun:test'
import { joinPageUrl } from './invite'

// Значение уходит в кнопку Discord-активности, которую видят посторонние:
// любой адрес, который смог бы утащить клик на другой хост, обязан отсеяться.
const CASES: Array<[string, string | null, boolean, string]> = [
  ['play.millida.net', 'Мой сервер', true, 'обычный домен'],
  ['play.millida.net:25577', null, true, 'домен с портом'],
  ['65.108.15.52:25565', null, true, 'ip с портом'],
  ['', null, false, 'пустой адрес'],
  ['evil.com/../..', null, false, 'путь в адресе'],
  ['evil.com?x=1', null, false, 'query в адресе'],
  ['https://evil.com', null, false, 'схема в адресе'],
  ['evil.com#frag', null, false, 'якорь в адресе'],
  ['play.millida.net:25565 evil', null, false, 'пробел и второй хост'],
]

describe('joinPageUrl', () => {
  for (const [addr, name, ok, why] of CASES) {
    test(`${why}: ${addr || '<пусто>'}`, () => {
      const url = joinPageUrl(addr, name)
      if (!ok) {
        expect(url).toBe('')
        return
      }
      expect(url.startsWith('https://millida.net/join?')).toBe(true)
      expect(new URL(url).searchParams.get('addr')).toBe(addr)
    })
  }

  test('имя сервера не подменяет адрес и не тащит разметку', () => {
    const url = joinPageUrl('play.millida.net', '"><b>hack')
    const q = new URL(url).searchParams
    expect(q.get('addr')).toBe('play.millida.net')
    expect(url).not.toContain('<b>')
    expect(q.get('name')).toBe('"><b>hack')
  })

  test('имя, равное адресу, не дублируется в ссылке', () => {
    expect(joinPageUrl('play.millida.net', 'play.millida.net')).toBe(
      'https://millida.net/join?addr=play.millida.net',
    )
  })
})
