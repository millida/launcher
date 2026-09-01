import { expect, test } from 'bun:test'

class MemStore {
  private map = new Map<string, string>()
  getItem(k: string) {
    return this.map.has(k) ? (this.map.get(k) as string) : null
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v))
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  clear() {
    this.map.clear()
  }
  raw(k: string) {
    return this.map.get(k)
  }
  poison(k: string, v: string) {
    this.map.set(k, v)
  }
}

const store = new MemStore()
Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })

const {
  ICON_BACKGROUNDS,
  ICON_SYMBOLS,
  defaultIconRecipe,
  forgetIconRecipe,
  isComposedIcon,
  randomIconRecipe,
  recallIconRecipe,
  rememberIconRecipe,
} = await import('./iconArt')

// Пин палитры: цвет фона уезжает в canvas как есть, поэтому любой формат, кроме
// #rrggbb, красит иконку в чёрный без единой ошибки в консоли.
test('палитра фонов: только #rrggbb, без повторов', () => {
  expect(ICON_BACKGROUNDS.length).toBeGreaterThanOrEqual(12)
  for (const c of ICON_BACKGROUNDS) {
    expect(c, 'цвет ' + c + ' не в формате #rrggbb — canvas закрасит иконку чёрным').toMatch(/^#[0-9a-f]{6}$/)
  }
  expect(new Set(ICON_BACKGROUNDS).size, 'в палитре есть повторяющийся цвет').toBe(ICON_BACKGROUNDS.length)
})

test('символы берутся из набора блоков и лежат в /block-icons', () => {
  expect(ICON_SYMBOLS.length).toBeGreaterThan(10)
  for (const s of ICON_SYMBOLS) expect(s.startsWith('/block-icons/'), 'символ вне набора: ' + s).toBe(true)
})

test('иконка по умолчанию собрана из палитры и набора символов', () => {
  const d = defaultIconRecipe()
  expect(ICON_BACKGROUNDS).toContain(d.bg)
  expect(ICON_SYMBOLS).toContain(d.symbol)
})

// Кнопка «Случайная» и выдача иконок пачкой обесценятся, если повтор возможен:
// человек нажимает и не видит разницы, а десять сборок получают один значок.
test('случайная иконка не повторяет предыдущую ни фоном, ни символом', () => {
  let prev = defaultIconRecipe()
  for (let i = 0; i < 200; i++) {
    const next = randomIconRecipe(prev)
    expect(ICON_BACKGROUNDS).toContain(next.bg)
    expect(ICON_SYMBOLS).toContain(next.symbol)
    expect(next.bg, 'фон повторился на шаге ' + i).not.toBe(prev.bg)
    expect(next.symbol, 'символ повторился на шаге ' + i).not.toBe(prev.symbol)
    prev = next
  }
})

test('собранная иконка отличается от блока и от ссылки', () => {
  expect(isComposedIcon('data:image/png;base64,AAA')).toBe(true)
  expect(isComposedIcon('/block-icons/Block1Millida.png')).toBe(false)
  expect(isComposedIcon('https://cdn.example/icon.png')).toBe(false)
  expect(isComposedIcon(null)).toBe(false)
  expect(isComposedIcon('')).toBe(false)
})

test('состав иконки помнится по сборке и забывается по требованию', () => {
  store.clear()
  expect(recallIconRecipe('Моя сборка')).toBeNull()
  const r = { bg: ICON_BACKGROUNDS[0], symbol: ICON_SYMBOLS[1] }
  rememberIconRecipe('Моя сборка', r)
  expect(recallIconRecipe('Моя сборка')).toEqual(r)
  forgetIconRecipe('Моя сборка')
  expect(recallIconRecipe('Моя сборка')).toBeNull()
})

// Записать в localStorage мог кто угодно, включая прошлую версию лаунчера:
// мусор обязан выглядеть как «состава нет», а не ронять экран сборок.
test('битая запись читается как отсутствие состава', () => {
  store.clear()
  store.poison('m-icon-art', '{ не json')
  expect(recallIconRecipe('a')).toBeNull()
  store.poison('m-icon-art', JSON.stringify({ a: 5, b: { bg: 1, symbol: [] }, c: null }))
  expect(recallIconRecipe('a')).toBeNull()
  expect(recallIconRecipe('b')).toBeNull()
  expect(recallIconRecipe('c')).toBeNull()
})
