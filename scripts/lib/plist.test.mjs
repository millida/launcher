import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parsePlistXml, renderPlist } from './plist.mjs'

const here = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const tauriDir = resolve(here, '..', '..', 'src-tauri')

const wrap = (body) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    body,
    '</dict>',
    '</plist>',
  ].join('\n')

describe('parsePlistXml', () => {
  const cases = [
    ['строка', '<key>A</key><string>hi</string>', { A: 'hi' }],
    ['пустая строка', '<key>A</key><string/>', { A: '' }],
    ['булево', '<key>A</key><true/><key>B</key><false/>', { A: true, B: false }],
    ['число', '<key>A</key><integer>7</integer>', { A: 7 }],
    ['вложенный словарь', '<key>A</key><dict><key>B</key><string>c</string></dict>', { A: { B: 'c' } }],
    ['массив словарей', '<key>A</key><array><dict><key>B</key><string>c</string></dict></array>', { A: [{ B: 'c' }] }],
    ['пустой массив', '<key>A</key><array/>', { A: [] }],
    ['экранирование', '<key>A</key><string>a &amp; b &lt;c&gt;</string>', { A: 'a & b <c>' }],
    ['комментарий между ключами', '<!-- why --><key>A</key><string>x</string>', { A: 'x' }],
  ]

  for (const [name, body, expected] of cases) {
    test(name, () => {
      expect(parsePlistXml(wrap(body), 'test')).toEqual(expected)
    })
  }

  test('оборванный тег виден как ошибка, а не как пустой словарь', () => {
    expect(() => parsePlistXml(wrap('<key>A</key><string>hi'), 'test')).toThrow(/test/)
  })

  test('значение без ключа не проглатывается', () => {
    expect(() => parsePlistXml(wrap('<string>hi</string>'), 'test')).toThrow(/key/)
  })
})

test('renderPlist переживает обратный разбор', () => {
  const source = { A: 'a & b', B: true, C: 7, D: ['x'], E: { F: 'g' } }
  expect(parsePlistXml(renderPlist(source), 'test')).toEqual(source)
})

/**
 * The pin that matters: this key is what lets macOS prompt for the microphone,
 * and it reaches the bundle only because the cross bundler parses this file.
 */
test('Info.plist лаунчера объявляет доступ к микрофону', () => {
  const plist = parsePlistXml(readFileSync(join(tauriDir, 'Info.plist'), 'utf8'), 'Info.plist')
  expect(typeof plist.NSMicrophoneUsageDescription).toBe('string')
  expect(plist.NSMicrophoneUsageDescription.length).toBeGreaterThan(0)
})

test('Entitlements.plist разрешает вход звука под hardened runtime', () => {
  const plist = parsePlistXml(readFileSync(join(tauriDir, 'Entitlements.plist'), 'utf8'), 'Entitlements.plist')
  expect(plist['com.apple.security.device.audio-input']).toBe(true)
})
