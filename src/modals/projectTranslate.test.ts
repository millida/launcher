import { expect, test } from 'bun:test'
import { blockKind, blockLines, hasWords, normView, ruOrPending, savedLang, skelBlocks, splitBlocks, trComplete } from './projectTranslate'

test('описание режется на блоки как на сервере: пустая строка, код целиком', () => {
  const body = '# FerriteCore\n\nReduces memory usage.\nSecond line.\n\n```java\nint a;\n\nint b;\n```\n\n- one\n- two\n\n![shot](https://cdn.modrinth.com/a.png)'
  const bs = splitBlocks(body)
  expect(bs.length).toBe(5)
  expect(bs[2]).toBe('```java\nint a;\n\nint b;\n```')
  expect(bs.map((b) => blockKind(b))).toEqual(['heading', 'para', 'code', 'list', 'image'])
  expect(blockLines(bs[2])).toBe(3)
  expect(blockLines('x'.repeat(150))).toBe(3)
  expect(blockLines('[link text](https://example.com/very/long/url/that/should/not/count/at/all/because/it/is/hidden)')).toBe(1)
  expect(skelBlocks(body)[3]).toEqual({ kind: 'list', lines: 2 })
})

test('ответ сервера без новых полей не роняет окно', () => {
  const v = normView({ done: true, blocks: [{ src: 'Hi', ru: 'Привет' }, { src: 'x', ru: null }, null, { ru: 'нет src' }] })
  expect(v.blocks.length).toBe(2)
  expect(v.summary).toBeNull()
  expect(v.engine).toBeNull()
  expect(trComplete(v)).toBe(false)
  const w = normView({
    done: true,
    blocks: [{ src: 'Hi', ru: 'Привет', id: 'b1', kind: 'para', tier: 'ai', lines: 1 }],
    summary: { title: 'FerriteCore', text: 'Экономит память.', loaders: ['Fabric'], categories: ['Оптимизация'], adds: [], source: 'curated' },
    engine: { ai: true, draft: true, queued: 0, retryInSec: null },
    description: { src: 'Memory usage optimizations', ru: 'Оптимизация памяти', tier: 'ai' },
  })
  expect(w.blocks[0].id).toBe('b1')
  expect(w.summary?.text).toBe('Экономит память.')
  expect(trComplete(w)).toBe(true)
})

test('короткие тексты: без слов — как есть, со словами — ждём перевод', () => {
  expect(hasWords('6.0.1')).toBe(false)
  expect(hasWords('FerriteCore 6.0.1 (Fabric)')).toBe(true)
  expect(hasWords('Уже по-русски')).toBe(false)
  expect(ruOrPending(null, '1.20.1-6.0.1')).toBe('1.20.1-6.0.1')
  expect(ruOrPending(null, 'Main menu')).toBeNull()
  expect(ruOrPending({ src: 'Main menu', ru: 'Главное меню', tier: 'ai' }, 'Main menu')).toBe('Главное меню')
})

test('язык описания по умолчанию — русский', () => {
  expect(savedLang()).toBe('ru')
})
