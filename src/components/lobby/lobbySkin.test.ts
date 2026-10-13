import { expect, test } from 'bun:test'

const figure = await Bun.file(new URL('./LobbyCharacter.tsx', import.meta.url)).text()
const visuals = await Bun.file(new URL('../../vendor/mine3d/core/product-visuals.ts', import.meta.url)).text()

const at = (needle: string, why: string): number => {
  const index = figure.indexOf(needle)
  expect(index, needle + ': ' + why).toBeGreaterThan(-1)
  return index
}

test('новая сцена лобби сразу надевает прошлый скин, а не ждёт сеть голой', () => {
  const early = at('engine.setSkin(kept.picture)', 'сцена после возврата в лобби стоит без скина, пока не ответит сеть')
  const network = at('void textureSource(look.skin)', 'пин смотрит не туда: цепочка загрузки скина переехала')
  expect(
    early,
    'запомненный скин кладётся ДО похода за текстурами: зависший ответ держал лобби пустым до минуты',
  ).toBeLessThan(network)

  const rules: [string, string][] = [
    ['lastSkin.nick === nick', 'чужой скин после смены аккаунта показывать нельзя'],
    ['!dressed.has(engine)', 'одетую сцену прошлым скином не перекрашиваем: это лишняя вспышка при смене скина'],
    ['if (kept.key === key) reveal()', 'при другом образе прошлый скин лежит скрытым, показывает его только сторож'],
    ['wearing.then((worn) => ({ src, worn }))', 'новый скин надевается после прошлого, иначе прошлый перекроет новый'],
  ]
  for (const [needle, why] of rules) at(needle, why)
})

test('грань головы не зеркалит световую панель добела', () => {
  for (const name of ['SKIN_ROUGHNESS_INNER', 'SKIN_ROUGHNESS_OUTER']) {
    const found = new RegExp('const ' + name + ' = ([0-9.]+);').exec(visuals)
    expect(found, name + ': константа материала скина переехала — пин смотрит не туда').not.toBeNull()
    expect(
      Number(found![1]),
      name + ': при 0.32 лицо Стива в блике было (246,213,206) при своём цвете (129,73,54) — «скин белый от света»',
    ).toBeGreaterThanOrEqual(0.7)
  }
})
