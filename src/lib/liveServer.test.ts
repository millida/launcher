import { expect, test } from 'bun:test'
import { publicServerLabel } from './liveServer'

const rated = [{ slug: 'hypego', ip: 'play.hypego.ru' }, { slug: '', ip: 'no-slug.example' }]

test('в живой онлайн идёт только сервер рейтинга или наш', () => {
  expect(publicServerLabel('play.hypego.ru', 'HypeGO', rated)).toBe('HypeGO')
  expect(publicServerLabel('PLAY.HypeGO.ru:25565', null, rated)).toBe('PLAY.HypeGO.ru:25565')
  expect(publicServerLabel('mpvp.millida.host', 'PvP-дуэли', [])).toBe('PvP-дуэли')
  expect(publicServerLabel('mcru.me', null, [])).toBe('mcru.me')
})

test('приватный сервер не уходит ни адресом, ни названием', () => {
  expect(publicServerLabel('93.184.216.34:25577', 'Сервер Васи', rated)).toBeNull()
  expect(publicServerLabel('vasya.aternos.me', 'Наш выживач', rated)).toBeNull()
  expect(publicServerLabel('no-slug.example', 'Без слага', rated)).toBeNull()
  expect(publicServerLabel('evil-millida.net.example.com', 'Подделка', rated)).toBeNull()
  expect(publicServerLabel('', 'Имя без адреса', rated)).toBeNull()
  expect(publicServerLabel(null, null, rated)).toBeNull()
})
