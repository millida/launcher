import { expect, test } from 'bun:test'
import { isInstalledInBuild, type CatalogIdentity } from './catalogInstalled'

// item, ids recorded in the build -> «Установлено»? The first three are the
// reported case: the catalogue offered «Добавить» for a mod already in the build.
const CASES: [CatalogIdentity, string[], boolean, string][] = [
  [{ pid: 'AANobbMI', slug: 'sodium' }, ['AANobbMI'], true, 'Modrinth project id recorded by the install'],
  [{ pid: 'AANobbMI', slug: 'sodium' }, ['sodium'], true, 'an older install recorded the slug instead of the id'],
  [{ pid: 'AANobbMI', slug: 'sodium', cfid: 394468 }, ['cf:394468'], true, 'merged card, the mod came from CurseForge'],
  [{ pid: 'cf:394468', slug: 'sodium', cfid: 394468 }, ['cf:394468'], true, 'CurseForge card'],
  [{ pid: 'millida:arcania', slug: 'arcania' }, ['millida:arcania'], true, 'Millida catalogue item'],
  [{ pid: 'cf:111', slug: 'sodium', cfid: 111 }, ['sodium'], false, 'a CurseForge slug is not a Modrinth slug'],
  [{ pid: 'millida:create', slug: 'create' }, ['create'], false, 'a Millida slug must not match a Modrinth mod of the same name'],
  [{ pid: 'AANobbMI', slug: 'sodium' }, ['PtjYWJkn', 'sodium-extra'], false, 'an addon is not its host mod'],
  [{ slug: 'sodium' }, [], false, 'empty build'],
  [{}, ['sodium'], false, 'item without ids is never installed'],
]

test('catalogue item is installed only when the build records one of its ids', () => {
  for (const [item, ids, want, why] of CASES) {
    expect(isInstalledInBuild(item, new Set(ids)), why).toBe(want)
  }
})
