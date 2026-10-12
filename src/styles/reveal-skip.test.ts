import { expect, test } from 'bun:test'

const kit = await Bun.file(new URL('./02-kit.css', import.meta.url)).text()
const reveal = await Bun.file(new URL('./pixel/reveal.css', import.meta.url)).text()

const classCount = (selector: string): number => (selector.match(/\.[\w-]+/g) ?? []).length

const skipRule = (): { selector: string; body: string } => {
  const m = reveal.match(/^([^{}\n]*\.rv2-skip)\s*\{([^}]*)\}/m)
  expect(m, 'правило .rv2-skip пропало из reveal.css — пин смотрит не туда').not.toBeNull()
  return { selector: m![1]!.trim(), body: m![2]! }
}

test('кнопка кита остаётся position:relative — из-за этого пин ниже и нужен', () => {
  const m = kit.match(/^\.btn\{([^}]*)\}/m)
  expect(m, 'правило .btn пропало из кита — пин смотрит не туда').not.toBeNull()
  expect(m![1], 'кит больше не задаёт кнопке position:relative — пин специфичности .rv2-skip можно снять').toContain(
    'position:relative',
  )
})

test('«Пропустить» в открытии сундука стоит внизу справа при любом порядке CSS-файлов', () => {
  const { selector, body } = skipRule()
  expect(body, 'кнопка больше не прижата к углу окна открытия').toMatch(/position:\s*absolute/)
  expect(body, 'кнопка ушла из нижнего правого угла: сверху она закрывает строки наград').toMatch(/bottom:\s*22px;\s*right:\s*22px/)
  expect(
    classCount(selector),
    `селектор «${selector}» по специфичности равен .btn: в релизной сборке reveal.css подключается раньше кита, ` +
      'position:relative кита побеждает, и кнопка встаёт в поток над сундуком по центру',
  ).toBeGreaterThan(1)
})
