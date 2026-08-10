import { expect, test } from 'bun:test'
import {
  CUSTOM_MARK,
  draftCss,
  draftManifest,
  draftProblem,
  emptyDraft,
  parseDraft,
  rebaseCss,
} from './theme-draft'
import type { ThemeDraft } from './theme-draft'

function draft(over: Partial<ThemeDraft> = {}): ThemeDraft {
  return { ...emptyDraft(), id: 'my-theme', name: 'Моя тема', ...over }
}

/// Редактор — единственный, кто пишет верхний блок файла; всё, что ниже
/// маркера, принадлежит автору. Потеря любой из двух частей означает, что
/// конструктор и ручной CSS нельзя использовать вместе.
test('черновик переживает круг «сохранили — открыли»', () => {
  const before = draft({
    tokens: { '--m-bg': '#101010', '--m-r-card': '18px' },
    css: '.card{border-width:2px}',
    description: 'Тёмная',
  })
  const after = parseDraft(draftManifest(before), draftCss(before))

  expect(after.tokens['--m-bg']).toBe('#101010')
  expect(after.tokens['--m-r-card']).toBe('18px')
  expect(after.css).toBe('.card{border-width:2px}')
  expect(after.base).toBe('any')
})

test('чужой CSS без маркеров уходит в ручную часть целиком и не переписывается', () => {
  const hand = ':root[data-theme-pack="mario"]{--m-bg:#5C94FC}\n.card{box-shadow:none}'
  const parsed = parseDraft({ id: 'mario', name: 'Марио', base: 'dark' }, hand)

  expect(parsed.tokens).toEqual({})
  expect(parsed.css).toBe(hand)
  expect(draftCss(parsed)).toContain(hand)
})

test('акцент разворачивается в производные значения', () => {
  const css = draftCss(draft({ tokens: { '--m-accent': '#5EC64D' } }))

  for (const v of ['--m-accent', '--m-accent-hover', '--m-accent-soft', '--m-accent-fg', '--m-accent-rgb', '--m-grad']) {
    expect(css).toContain(v + ':')
  }
  expect(css.indexOf('--m-accent:')).toBeLessThan(css.indexOf(CUSTOM_MARK))
})

test('пустой токен ничего не пишет в файл', () => {
  const css = draftCss(draft({ tokens: { '--m-bg': '  ' }, css: '.a{color:red}' }))
  expect(css).not.toContain('--m-bg')
})

/// Скопированная тема пишется под селектор оригинала: без переименования
/// копия выглядела бы пустой, а правки уезжали бы в чужую тему.
test('копия перенастраивается на новый идентификатор', () => {
  const css = ':root[data-theme-pack="mario"] .card{border:0}'
  expect(rebaseCss(css, 'mario', 'my-mario')).toBe(
    ':root[data-theme-pack="my-mario"] .card{border:0}',
  )
  expect(rebaseCss(css, 'mario', 'mario')).toBe(css)
})

/// вход → вердикт. Проверки повторяют ядро: расхождение означало бы отказ уже
/// после нажатия «Сохранить», когда объяснять поздно.
test('черновик не сохраняется, пока в нём есть чем сломать тему', () => {
  const cases: [ThemeDraft, string[], boolean][] = [
    [draft({ tokens: { '--m-bg': '#000' } }), [], true],
    [draft({ css: '.a{color:red}' }), [], true],
    [draft({ id: 'Моя' }), [], false],
    [draft({ id: '-lead' }), [], false],
    [draft({ id: 'mario', tokens: { '--m-bg': '#000' } }), ['mario'], false],
    [draft({ name: '   ', tokens: { '--m-bg': '#000' } }), [], false],
    [draft(), [], false],
  ]
  for (const [d, taken, ok] of cases) {
    expect(draftProblem(d, taken) === null).toBe(ok)
  }
})
