import { expect, test } from 'bun:test'

const kit = await Bun.file(new URL('./02-kit.css', import.meta.url)).text()
const hub = await Bun.file(new URL('./pixel/playhub.css', import.meta.url)).text()

const classCount = (selector: string): number => (selector.match(/\.[\w-]+/g) ?? []).length

const KIT_CLASSES = 2

test('кнопка кита .btn.lg задаёт высоту и поля — из-за этого пины ниже и нужны', () => {
  expect(kit, 'кит больше не задаёт .btn.lg высоту и поля — пины строки поиска можно пересмотреть').toMatch(
    /^\.btn\.lg\{height:52px;padding:0 28px/m,
  )
})

const cases: Array<{ why: string; css: string; rule: RegExp }> = [
  {
    why: 'кнопки строки поиска одной высоты с полем — 60px',
    css: hub,
    rule: /^(\.hub-find [^{}\n]*)\s*\{\s*height:\s*60px/m,
  },
  {
    why: 'у «Найти» широкие поля 40px',
    css: hub,
    rule: /^([^{}\n]*\.hub-find-go)\s*\{\s*padding-inline:\s*40px/m,
  },
]

for (const { why, css, rule } of cases) {
  test(`строка поиска библиотеки при любом порядке CSS-файлов: ${why}`, () => {
    const m = css.match(rule)
    expect(m, `правило пропало (${why}) — пин смотрит не туда`).not.toBeNull()
    const selector = m![1]!.trim()
    expect(
      classCount(selector),
      `селектор «${selector}» по специфичности не выше .btn.lg: в релизной сборке порядок CSS-файлов другой, ` +
        `побеждает кит, и ломается: ${why}`,
    ).toBeGreaterThan(KIT_CLASSES)
  })
}

test('на главной нет кнопки ИИ-сборщика с Милли: вход в него только в каталоге сборок', async () => {
  const src = await Bun.file(new URL('../components/playhub/HubFind.tsx', import.meta.url)).text()
  expect(src, 'заметная кнопка ИИ рядом с «Найти» вернулась — она гнала лишние запросы к модели').not.toMatch(/openMilli|hub-find-ai|<Milli\b/)
})
