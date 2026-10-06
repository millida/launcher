import { expect, test } from 'bun:test'
import { agoLabel, compatOf, isForeign, licenseLabel, orderGallery, sideLabel, tidyBody } from './projectView'

test('лицензия словами, а не SPDX-строкой', () => {
  expect(licenseLabel({ id: 'LicenseRef-All-Rights-Reserved', name: '' })).toEqual({ text: 'Все права защищены', open: false })
  expect(licenseLabel({ id: 'MIT' })).toEqual({ text: 'MIT', open: true })
  expect(licenseLabel({ id: 'GPL-3.0-only' })).toEqual({ text: 'GPL 3.0', open: true })
  expect(licenseLabel({ id: 'LGPL-3.0-or-later' })).toEqual({ text: 'LGPL 3.0 и новее', open: true })
  expect(licenseLabel({ id: 'LicenseRef-Create-Mod-License' })?.text).toBe('Create Mod License')
  expect(licenseLabel({ id: 'LicenseRef-Custom', name: 'Custom' })?.text).toBe('Своя лицензия автора')
  expect(licenseLabel({ id: 'LicenseRef-Polyform-Shield-1.0.0', name: 'Polyform Shield' })?.text).toBe('Polyform Shield')
  expect(licenseLabel('')).toBeNull()
  expect(licenseLabel(null)).toBeNull()
})

test('совместимость файла со сборкой', () => {
  const b = { version: '1.21.1', loader: 'fabric' }
  expect(compatOf({ game_versions: ['1.21', '1.21.1'], loaders: ['fabric', 'quilt'] }, b, 'mod')).toBe('ok')
  expect(compatOf({ game_versions: ['1.20.1'], loaders: ['fabric'] }, b, 'mod')).toBe('game')
  expect(compatOf({ game_versions: ['1.21.1'], loaders: ['forge'] }, b, 'mod')).toBe('loader')
  expect(compatOf({ game_versions: ['1.20.1'], loaders: ['forge'] }, b, 'mod')).toBe('both')
  // Quilt запускает моды Fabric.
  expect(compatOf({ game_versions: ['1.21.1'], loaders: ['fabric'] }, { version: '1.21.1', loader: 'quilt' }, 'mod')).toBe('ok')
  // У ресурспака «загрузчик» — minecraft: сверяем только версию игры.
  expect(compatOf({ game_versions: ['1.21.1'], loaders: ['minecraft'] }, b, 'resourcepack')).toBe('ok')
  expect(compatOf({ game_versions: ['1.21.1'], loaders: ['iris'] }, { version: '1.21.1', loader: 'forge' }, 'shader')).toBe('ok')
  expect(compatOf({ game_versions: ['1.21.1'] }, null, 'mod')).toBe('unknown')
})

test('где нужен мод', () => {
  expect(sideLabel('required', 'required')).toBe('Клиент и сервер')
  expect(sideLabel('required', 'unsupported')).toBe('Только клиент')
  expect(sideLabel('unsupported', 'required')).toBe('Только сервер')
  expect(sideLabel('optional', 'optional')).toBe('Клиент или сервер')
  expect(sideLabel(undefined, undefined)).toBe('')
})

test('главная картинка галереи — первой', () => {
  const g = orderGallery([
    { url: 'a', ordering: 2 },
    { url: 'b', ordering: 1 },
    { url: 'c', featured: true, ordering: 5 },
  ])
  expect(g.map((x) => x.url)).toEqual(['c', 'b', 'a'])
})

test('давность — словами', () => {
  const now = Date.parse('2026-10-04T12:00:00Z')
  expect(agoLabel('2026-10-04T08:00:00Z', now)).toBe('сегодня')
  expect(agoLabel('2026-10-02T08:00:00Z', now)).toBe('2 дня назад')
  expect(agoLabel('2026-09-20T08:00:00Z', now)).toBe('2 недели назад')
  expect(agoLabel('2026-03-12T08:00:00Z', now)).toBe('12 марта')
  expect(agoLabel('2024-03-12T08:00:00Z', now)).toBe('12 марта 2024')
  expect(agoLabel(null, now)).toBe('')
})

test('значки README убираются, дыры схлопываются', () => {
  const md =
    '[![Discord](https://img.shields.io/discord/123?label=Discord)](https://discord.gg/x) ![Mod Loader](https://img.shields.io/badge/loader-fabric-blue)\n\n\n\n' +
    '# Lithium\n\n\nLithium is a mod.\n\n\n\n#### Features\n- fast'
  const out = tidyBody(md)
  expect(out).not.toContain('shields.io')
  expect(out).not.toContain('\n\n\n')
  expect(out).toContain('# Lithium\nLithium is a mod.')
  expect(out).toContain('a mod.\n### Features')
  expect(out).toContain('### Features')
  const html = '<p align="center"><a href="https://modrinth.com/mod/x"><img src="https://cdn.jsdelivr.net/npm/@intergrav/devins-badges@3/assets/cozy/available/modrinth_vector.svg"></a></p><br><br><br>Text'
  expect(tidyBody(html)).toBe('<br>Text')
  // Обычные картинки остаются.
  expect(tidyBody('![shot](https://cdn.modrinth.com/data/x/images/a.png)')).toContain('a.png')
})

test('строка из одного <br> не плодит дыру', () => {
  expect(tidyBody('One.\n\n<br>\n\nTwo.\n\n\n<br>\n\n\nThree.')).toBe('One.\n\nTwo.\n\nThree.')
})

test('описание на английском', () => {
  expect(isForeign('Lithium is a free and open-source Minecraft mod which works to optimize many areas of the game')).toBe(true)
  expect(isForeign('Мод добавляет новые биомы и пещеры в мир Minecraft, всё работает из коробки')).toBe(false)
})
