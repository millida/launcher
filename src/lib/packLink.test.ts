import { describe, expect, test } from 'bun:test'
import { millidaPackCode } from './packLink'

describe('millidaPackCode', () => {
  test.each([
    ['https://millida.net/p/YQPPAYWG', 'YQPPAYWG'],
    ['millida.net/p/yqppaywg/', 'YQPPAYWG'],
    ['https://www.millida.net/p/YQPP-AYWG?from=tg#x', 'YQPPAYWG'],
    ['  yqpp-aywg ', 'YQPPAYWG'],
  ])('%s is a Millida pack, opened by code', (text, code) => {
    expect(millidaPackCode(text)).toBe(code)
  })

  test.each([
    'https://example.org/pack/pack.toml',
    'https://millida.net/p/YQPPAYWG/pack.toml',
    'https://millida.net/play/YQPPAYWG',
    'https://evil.example/p/YQPPAYWG',
    'YQPPAYW0',
    '',
  ])('%s stays a packwiz link', (text) => {
    expect(millidaPackCode(text)).toBeNull()
  })
})
