import { expect, test } from 'bun:test'

const kit = await Bun.file(new URL('./02-kit.css', import.meta.url)).text()

const ruleBody = (selector: string): string => {
  const at = kit.indexOf(selector + '{')
  expect(at, selector + ': правило пропало из кита — пин смотрит не туда').toBeGreaterThan(-1)
  return kit.slice(at + selector.length + 1, kit.indexOf('}', at))
}

/// Жалоба 28.08.2026: «чат вытолкнул всё влево». Закрытая панель чата паркуется
/// за правым краем через transform, и с `overflow:hidden` окно оставалось
/// прокручиваемым контейнером без полосы: одно движение по тачпаду уводило
/// титлбар, рейку и строки за левый край на ширину панели, а вернуть их было
/// нечем. `clip` рисует так же, но прокрутку убирает совсем.
test('окно лаунчера обрезает содержимое без прокрутки', () => {
  const body = ruleBody('.window')
  expect(body, 'окно снова стало прокручиваемым: закрытый чат уведёт интерфейс влево').toContain(
    'overflow:clip',
  )
})

/// Панель уезжает за правый край окна — именно это и делает область прокрутки
/// шире окна. Пин держит связку: пока трансформ есть, окно обязано быть clip.
test('закрытый чат стоит за правым краем окна', () => {
  expect(ruleBody('.chat'), 'чат больше не паркуется трансформом — пин выше стоит зря').toContain(
    'translateX(105%)',
  )
})
