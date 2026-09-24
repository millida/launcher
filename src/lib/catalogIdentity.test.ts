import { expect, test } from 'bun:test'
import { isCatalogItemInstalled, normalizedModTitle } from './modMerge'

const installed = (ids: string[] = [], titles: string[] = []) => ({
  ids: new Set(ids),
  titles: new Set(titles.map(normalizedModTitle)),
})

test('matches a Modrinth canonical project id', () => {
  const have = installed(['AANobbMI'])
  expect(isCatalogItemInstalled({ pid: 'AANobbMI', slug: 'sodium' }, have.ids, have.titles)).toBe(true)
})

test('matches a Modrinth manifest that retained the slug', () => {
  const have = installed(['sodium'])
  expect(isCatalogItemInstalled({ pid: 'AANobbMI', slug: 'sodium' }, have.ids, have.titles)).toBe(true)
})

test('matches a CurseForge project id', () => {
  const have = installed(['cf:394468'])
  expect(isCatalogItemInstalled({ cfid: 394468, title: 'Sodium' }, have.ids, have.titles)).toBe(true)
})

test('matches a cross-source duplicate by normalized title', () => {
  const have = installed(['cf:394468'], ['Sodium (Fabric)'])
  expect(
    isCatalogItemInstalled({ pid: 'AANobbMI', slug: 'sodium', title: 'Sodium' }, have.ids, have.titles),
  ).toBe(true)
})

test('does not conflate an addon with its parent mod', () => {
  const have = installed([], ['Sodium Extra'])
  expect(isCatalogItemInstalled({ title: 'Sodium' }, have.ids, have.titles)).toBe(false)
})

test('does not match an empty normalized title', () => {
  const have = installed([], ['(Fabric)'])
  expect(isCatalogItemInstalled({ title: '(Forge)' }, have.ids, have.titles)).toBe(false)
})