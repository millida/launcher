import { expect, test } from 'bun:test'

const kit = await Bun.file(new URL('./02-kit.css', import.meta.url)).text()
const hub = await Bun.file(new URL('./pixel/playhub.css', import.meta.url)).text()
const intro = await Bun.file(new URL('./pixel/hub-ai-intro.css', import.meta.url)).text()

const classCount = (selector: string): number => (selector.match(/\.[\w-]+/g) ?? []).length

const KIT_CLASSES = 2

test('кнопка кита .btn.lg задаёт высоту, поля и размер значка — из-за этого пины ниже и нужны', () => {
  expect(kit, 'кит больше не задаёт .btn.lg высоту и поля — пины строки поиска можно пересмотреть').toMatch(
    /^\.btn\.lg\{height:52px;padding:0 28px/m,
  )
  expect(kit, 'кит больше не жмёт значок в .btn.lg до 18px — пин размера Милли можно снять').toMatch(
    /^\.btn\.lg svg\{width:18px;height:18px\}/m,
  )
})

const cases: Array<{ why: string; css: string; rule: RegExp }> = [
  {
    why: 'поле слева под окошко Милли: без него текст «Собрать с ИИ» начинается под окошком',
    css: intro,
    rule: /^([^{}\n]*\.hub-find-ai)\s*\{\s*padding-left:\s*92px/m,
  },
  {
    why: 'Милли в окошке 64px: иначе кит сжимает её до значка 18px',
    css: intro,
    rule: /^([^{}\n]*\.hub-ai-who svg)\s*\{\s*width:\s*64px/m,
  },
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
