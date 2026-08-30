import { expect, test } from 'bun:test'

const css = await Bun.file(new URL('./05-media.css', import.meta.url)).text()
const screen = await Bun.file(new URL('../screens/Overlay.tsx', import.meta.url)).text()

const KINDS = ['msg', 'online', 'play']

const modifierPrefix = (): string => {
  const m = screen.match(/'ov-card (ov-[a-z-]*?)' \+ \(m\.kind \|\| 'msg'\)/)
  expect(m?.[1], 'карточка оверлея больше не клеит класс из вида сообщения — пин смотрит не туда').toBeString()
  return m![1]
}

const soleClassRule = (cls: string): boolean =>
  new RegExp('(^|[},])\\s*\\.' + cls + '\\s*[,{]', 'm').test(css)

/// Жалоба 28.08.2026: «оверлей наслаивается, мб из-за непрозрачности». Вид
/// сообщения попадал в класс как `ov-` + kind, и у обычного сообщения выходил
/// `ov-msg` — класс пузыря чата интерактивной панели. Он объявлен ниже
/// `.ov-card`, специфичность та же, поэтому карточка получала его фон
/// rgba(255,255,255,.08), flex-direction:column и align-self:flex-start:
/// просвечивала насквозь, складывалась в столбик и сжималась в 84px.
test('модификатор вида карточки не совпадает ни с одним самостоятельным классом', () => {
  const prefix = modifierPrefix()
  for (const kind of KINDS) {
    const cls = prefix + kind
    expect(
      soleClassRule(cls),
      `.${cls} объявлен в стилях как самостоятельный класс: он перебьёт .ov-card и разберёт карточку`,
    ).toBe(false)
  }
})

/// Модификаторы красят полоску только в паре с самой карточкой — пин держит
/// эту пару, иначе переименование вида уводит акцент в никуда.
test('акценты видов привязаны к карточке', () => {
  const prefix = modifierPrefix()
  for (const kind of ['online', 'play']) {
    expect(css, `акцент вида ${kind} потерял связку с .ov-card`).toContain(`.ov-card.${prefix}${kind}{`)
  }
})

/// Карточка — горизонтальная плашка на всю ширину стопки. Ровно эти три
/// свойства и перебивал пузырь чата, и по ним поломка видна на скриншоте.
test('карточка оверлея остаётся горизонтальной плашкой', () => {
  const at = css.search(/^\.ov-card\{/m)
  expect(at, 'правило .ov-card пропало — пин смотрит не туда').toBeGreaterThan(-1)
  const body = css.slice(at, css.indexOf('}', at))
  expect(body, 'карточка перестала быть флекс-строкой: голова уедет над текстом').toContain('display:flex')
  expect(body, 'карточка потеряла непрозрачный фон: под ней будет видно чужое окно').toContain(
    'background:rgba(18,18,22,.86)',
  )
  expect(css, 'стопка карточек потеряла фиксированную ширину').toContain('.ov-cards{position:absolute')
})
