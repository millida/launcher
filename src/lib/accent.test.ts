import { expect, test } from 'bun:test'
import { accentFromHex, computeAccent, readableOnUi } from './accent'

const WINDOW = '#161718'
const INK = '#06200e'

const channel = (v: number) => {
  const x = v / 255
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const luminance = (hex: string) => {
  const [r, g, b] = rgbOf(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const STOCK: [string, string][] = [
  ['#5EC64D', 'зелёный по умолчанию'],
  ['#3A6FE0', 'лазурный — самый тёмный из готовых'],
  ['#6C6BFF', 'индиго'],
  ['#E8457A', 'малиновый'],
  ['#BFC7CF', 'серебряный'],
  ['#F5BD2C', 'золото PLUS'],
  ['#4FB8FF', 'алмаз Diamond'],
]

test('готовые цвета палитры остаются как были', () => {
  for (const [hex, why] of STOCK) {
    const a = computeAccent(accentFromHex(hex))
    expect(a.textC, why + ': цвет кнопок из палитры не должен сдвинуться ни на тон').toBe(a.c)
    expect(a.rgb, why + ': свечение и обводки берут тот же цвет').toBe(rgbOf(a.c).join(','))
  }
})

const DARK: [string, string, (rgb: [number, number, number]) => boolean, string][] = [
  ['#000000', 'чёрный', ([r, g, b]) => r === g && g === b, 'чёрный даёт нейтральный серый, без чужого оттенка'],
  ['#101a40', 'тёмно-синий', ([r, g, b]) => b > r && b > g, 'синий остаётся синим'],
  ['#400000', 'тёмно-красный', ([r, g, b]) => r > g && r > b, 'красный остаётся красным'],
  ['#0b2a12', 'тёмно-зелёный', ([r, g, b]) => g > r && g > b, 'зелёный остаётся зелёным'],
  ['#1e1f20', 'цвет самой подложки', ([r, g, b]) => Math.abs(r - b) < 12 && Math.abs(r - g) < 12, 'серый остаётся серым'],
]

test('тёмный цвет игрока: сцена его, кнопки и текст — читаемый оттенок', () => {
  for (const [hex, name, keepsHue, hueWhy] of DARK) {
    const a = computeAccent(accentFromHex(hex))
    const ui = a.textC as string
    expect(a.c, name + ': выбранный цвет остаётся цветом сцены лобби').toBe(hex)
    expect(
      contrast(ui, WINDOW),
      name + ': кнопки, ссылки и отметки рисуются одним цветом, на тёмном окне он обязан читаться',
    ).toBeGreaterThanOrEqual(5.5)
    expect(
      contrast(INK, ui),
      name + ': кит печатает на кнопке тёмную надпись, на поднятом цвете она должна читаться',
    ).toBeGreaterThanOrEqual(4.5)
    expect(keepsHue(rgbOf(ui)), name + ': ' + hueWhy + ' (получилось ' + ui + ')').toBe(true)
    expect(a.rgb, name + ': обводки и свечение не должны остаться чёрными на чёрном').toBe(rgbOf(ui).join(','))
    expect(a.s, name + ': мягкая заливка выбранной вкладки строится от читаемого цвета').toBe(
      'rgba(' + rgbOf(ui).join(',') + ',.14)',
    )
    expect(contrast(a.fg as string, ui), name + ': светлая надпись на заливке читается').toBeGreaterThanOrEqual(3)
  }
})

test('подъём до уровня палитры, не выше: тёмный цвет не превращается в белый', () => {
  for (const [hex, name] of DARK) {
    const ui = readableOnUi(hex)
    expect(contrast(ui, WINDOW), name + ': поднятый цвет встаёт рядом с обычными цветами палитры').toBeLessThan(5.9)
  }
})

test('светлый цвет не трогается, надпись на кнопке становится тёмной', () => {
  const a = computeAccent(accentFromHex('#ffffff'))
  expect(a.textC).toBe('#ffffff')
  expect(a.fg, 'белая надпись на белой кнопке не видна').toBe('#141414')
})
