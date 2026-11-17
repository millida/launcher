import { expect, test } from 'bun:test'
import { planIsEmpty, planIsSilent, planMods, serverMod, serverModsAnswer, type ServerModsAnswer } from './serverModsPlan'

const sha = (n: number) => String(n).padStart(128, '0')
const raw = (n: number, over: Record<string, unknown> = {}) => ({
  file: `mod-${n}.jar`,
  size: 1000,
  sha1: 'a'.repeat(40),
  sha512: sha(n),
  source: 'modrinth',
  projectId: 'AANobbMI',
  versionId: 'v' + n,
  name: 'Mod ' + n,
  iconUrl: 'https://cdn.modrinth.com/i.png',
  required: true,
  scan: null,
  ticket: '1763380000.' + 'A'.repeat(43),
  ...over,
})

const answer = (mods: unknown[], over: Record<string, unknown> = {}): ServerModsAnswer =>
  serverModsAnswer({ serverId: 'srv1', game: { core: 'fabric', version: '1.21.1', loader: 'fabric' }, status: 'ready', mods, customHidden: 0, revision: 'r', ...over })!

test('a mod line from the API is accepted only when every field is sane', () => {
  const cases: Array<[string, Record<string, unknown>, boolean]> = [
    ['an ordinary Modrinth mod', {}, true],
    ['a path in the file name would leave mods/', { file: '../options.txt' }, false],
    ['a nested file name', { file: 'sub/x.jar' }, false],
    ['not a jar', { file: 'readme.txt' }, false],
    ['a short digest is no proof of the file', { sha512: 'ab' }, false],
    ['an unknown source', { source: 'url' }, false],
    ['a Modrinth id with a slash would change the API route', { projectId: 'a/b' }, false],
    ['CurseForge ids are numbers', { source: 'curseforge', projectId: 'abc', versionId: '1' }, false],
    ['a numeric CurseForge pair', { source: 'curseforge', projectId: '238222', versionId: '5000000' }, true],
    ['an empty file', { size: 0 }, false],
    ['a custom file needs no ids', { source: 'custom', projectId: null, versionId: null }, true],
  ]
  for (const [why, over, ok] of cases) expect({ why, ok: serverMod(raw(1, over)) !== null }).toEqual({ why, ok })
})

test('a custom file without a well-formed pass is dropped: the core could not fetch it anyway', () => {
  expect(serverMod(raw(1, { source: 'custom', projectId: null, versionId: null, ticket: 'x&y=1' }))).toBeNull()
  expect(serverMod(raw(1, { source: 'custom', projectId: null, versionId: null }))!.ticket).toMatch(/^\d+\./)
  expect(serverMod(raw(1))!.ticket).toBeNull()
})

test('custom files never carry ids or an icon, so nothing points the core elsewhere', () => {
  const m = serverMod(raw(1, { source: 'custom', projectId: 'x', versionId: 'y', iconUrl: 'https://evil/x.png', scan: 'clean' }))!
  expect([m.projectId, m.versionId, m.iconUrl, m.scan]).toEqual([null, null, null, 'clean'])
})

test('an icon must be https, a plain http link is dropped', () => {
  expect(serverMod(raw(1, { iconUrl: 'http://x/i.png' }))!.iconUrl).toBeNull()
})

test('duplicates by digest or by name are dropped, the first one wins', () => {
  const a = answer([raw(1), raw(1, { file: 'other.jar' }), raw(2, { file: 'MOD-1.jar' }), raw(3)])
  expect(a.mods.map((m) => m.file)).toEqual(['mod-1.jar', 'mod-3.jar'])
})

test('an answer with an unknown status or a bad server id is refused', () => {
  expect(serverModsAnswer({ serverId: 'srv1', status: 'weird', game: {}, mods: [] })).toBeNull()
  expect(serverModsAnswer({ serverId: '../x', status: 'ready', game: {}, mods: [] })).toBeNull()
})

test('an unknown loader leaves the server without a plan: a vanilla build would not load the mods', () => {
  const a = answer([raw(1)], { game: { core: 'paper', version: '1.21.1', loader: 'bukkit' } })
  expect(planMods({ answer: a, server: 'S', icon: null, binding: null, present: new Set() })).toBeNull()
})

test('first join: every mod is to install, public and custom apart', () => {
  const a = answer([raw(1), raw(2, { source: 'custom', projectId: null, versionId: null })])
  const p = planMods({ answer: a, server: 'S', icon: null, binding: null, present: new Set() })!
  expect([p.add.length, p.custom.length, p.have, p.profile]).toEqual([1, 1, 0, null])
})

test('a mod counts as installed only while its file is still in the build', () => {
  const a = answer([raw(1), raw(2)])
  const binding = { profile: 'S', files: { [sha(1)]: 'mod-1.jar', [sha(2)]: 'mod-2.jar' } }
  const p = planMods({ answer: a, server: 'S', icon: null, binding, present: new Set(['mod-1.jar']) })!
  expect(p.add.map((m) => m.file)).toEqual(['mod-2.jar'])
  expect(p.have).toBe(1)
})

test('a mod the server dropped is removed, a file the player added by hand is not', () => {
  const a = answer([raw(1)])
  const binding = { profile: 'S', files: { [sha(1)]: 'mod-1.jar', [sha(9)]: 'old.jar' } }
  const p = planMods({ answer: a, server: 'S', icon: null, binding, present: new Set(['mod-1.jar', 'old.jar', 'mine.jar']) })!
  expect(p.remove).toEqual(['old.jar'])
  expect(planIsEmpty(p)).toBe(false)
})

test('a build that matches the server needs nothing', () => {
  const a = answer([raw(1)])
  const p = planMods({ answer: a, server: 'S', icon: null, binding: { profile: 'S', files: { [sha(1)]: 'mod-1.jar' } }, present: new Set(['mod-1.jar']) })!
  expect(planIsEmpty(p)).toBe(true)
})

test('only public required mods on a known build update without a question; the owner files always ask', () => {
  const binding = { profile: 'S', files: {} }
  const plan = (mods: unknown[], b: typeof binding | null) => planMods({ answer: answer(mods), server: 'S', icon: null, binding: b, present: new Set() })!
  expect(planIsSilent(plan([raw(1)], binding))).toBe(true)
  expect(planIsSilent(plan([raw(1)], null))).toBe(false)
  expect(planIsSilent(plan([raw(1, { source: 'custom', projectId: null, versionId: null })], binding))).toBe(false)
  expect(planIsSilent(plan([raw(1, { required: false })], binding))).toBe(false)
})
