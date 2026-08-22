import { describe, expect, it } from 'bun:test'
import { canonAddr } from '../lib/serverAddr'

describe('canonAddr', () => {
  const cases: [string, string, string][] = [
    ['MigosMc.net', 'migosmc.net', 'регистр из карточки рейтинга не должен плодить второй сервер'],
    ['migosmc.net:25565', 'migosmc.net', 'порт по умолчанию из лога игры — тот же адрес'],
    ['mc.example.ru:25577', 'mc.example.ru:25577', 'нестандартный порт остаётся частью ключа'],
    ['play.example.ru.', 'play.example.ru', 'корневая точка из DNS-записи не отличает адрес'],
    ['', '', 'пустой адрес не превращается в ключ'],
  ]
  for (const [input, want, why] of cases) it(why, () => expect(canonAddr(input)).toBe(want))
})
