import { expect, test } from 'bun:test'

const kit = await Bun.file(new URL('./02-kit.css', import.meta.url)).text()

const ruleBody = (selector: string): string => {
  const at = kit.indexOf(selector + '{')
  expect(at, selector + ': правило пропало из кита — пин смотрит не туда').toBeGreaterThan(-1)
  return kit.slice(at + selector.length + 1, kit.indexOf('}', at))
}

const zIndex = (selector: string): number => {
  const found = /z-index:(-?\d+)/.exec(ruleBody(selector))
  expect(found, selector + ': z-index пропал — попап и модалка снова спорят вслепую').not.toBeNull()
  return Number(found![1])
}

/// Жалоба 03.09.2026 из хостинга: список версий выглядел пустым. Абсолютный
/// попап жил внутри карточки — соседние карточки закрывали его строки, а
/// прокручиваемый `.content` обрезал остальное. Позицию теперь считает Select и
/// ставит её инлайном, поэтому фиксированное позиционирование обязательно.
test('выпадающий список селекта стоит фиксированно', () => {
  const body = ruleBody('.m-select-pop')
  expect(body, 'попап вернулся в поток карточки — его снова закроют соседние карточки').toContain(
    'position:fixed',
  )
  expect(body, 'жёсткие top/left перебьют посчитанную позицию портала').not.toContain('top:')
  expect(body, 'жёсткие top/left перебьют посчитанную позицию портала').not.toContain('left:')
})

/// Селекты живут и внутри модалок: попап рисуется в body, поэтому подложка
/// модалки обязана остаться ниже него.
test('попап селекта выше подложки модалки', () => {
  expect(
    zIndex('.m-select-pop'),
    'подложка модалки перекрыла список — выбрать в модалке снова нельзя',
  ).toBeGreaterThan(zIndex('.modal-bg'))
})
