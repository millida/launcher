import { expect, test } from 'bun:test'

const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
} as Storage

const { keepCard } = await import('./catalogHide')

test('скрыть установленное и исключить категорию', () => {
  const card = (slug: string, extra: object = {}) => ({ slug, categories: ['adventure'], ...extra }) as Parameters<typeof import('./catalogHide').keepCard>[0]
  const installed = new Set(['AANobbMI', 'cf:42', 'millida:own'])
  const cases: [Parameters<typeof import('./catalogHide').keepCard>[0], ReadonlySet<string> | null, string[], boolean, string][] = [
    [card('sodium', { mrHit: { pid: 'AANobbMI' } }), installed, [], false, 'мод из сборки по id Modrinth прячется'],
    [card('jei', { curseforgeId: 42 }), installed, [], false, 'мод с CurseForge узнаётся по cf:id'],
    [card('own'), installed, [], false, 'материал нашего каталога узнаётся по millida:slug'],
    [card('new'), installed, [], true, 'чего нет в сборке — показываем'],
    [card('sodium', { mrHit: { pid: 'AANobbMI' } }), null, [], true, 'галка выключена — установленное видно'],
    [card('x'), null, ['adventure'], false, 'исключённая категория прячет карточку'],
    [card('x'), null, ['magic'], true, 'другая исключённая категория карточку не трогает'],
  ]
  for (const [c, ids, ex, want, why] of cases) expect(keepCard(c, ids, ex), why).toBe(want)
})
