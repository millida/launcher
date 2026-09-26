import { expect, test } from 'bun:test'
import { batchSummary, candidateMeta, confirmText, contentText, launchersText, rowVerdict, sizeText } from './moves'
import type { RowResult } from './moves'
import type { MoveCandidate, MoveOutcome } from '../ipc/commands'

const GB = 1024 * 1024 * 1024

const cand = (over: Partial<MoveCandidate> = {}): MoveCandidate => ({
  path: 'C:\\prism\\Sky',
  name: 'Sky',
  version: '1.20.1',
  loader: 'forge',
  launcher: 'Prism Launcher',
  bytes: 2 * GB,
  files: 100,
  worlds: 2,
  mods: 45,
  same_drive: true,
  ...over,
})

const outcome = (over: Partial<MoveOutcome> = {}): MoveOutcome => ({
  profile: { name: 'Sky', version: '1.20.1', fabric: false, loader: 'forge' },
  instant: true,
  source_removed: true,
  note: null,
  ...over,
})

test('sizes read the way a player expects', () => {
  const cases: [number, string, string][] = [
    [0, '0 МБ', 'empty folder does not read as NaN'],
    [300 * 1024, '1 МБ', 'a tiny build never shows as 0'],
    [850 * 1024 * 1024, '850 МБ', 'under a gigabyte in megabytes'],
    [1.25 * GB, '1,3 ГБ', 'Russian decimal comma'],
    [12 * GB, '12 ГБ', 'big builds without a fraction'],
  ]
  for (const [bytes, want, why] of cases) expect(sizeText(bytes), why).toBe(want)
})

test('row shows weight, worlds and mods with Russian plurals', () => {
  expect(contentText(cand())).toBe('2,0 ГБ · 2 мира · 45 модов')
  expect(contentText(cand({ worlds: 1, mods: 0 })), 'no mods — nothing about mods').toBe('2,0 ГБ · 1 мир')
  expect(candidateMeta(cand())).toBe('Prism Launcher · Forge 1.20.1')
})

test('launchers are named once each', () => {
  expect(launchersText([cand(), cand()])).toBe('Prism Launcher')
  expect(launchersText([cand(), cand({ launcher: 'Modrinth App' })])).toBe('Prism Launcher и Modrinth App')
  expect(launchersText([cand(), cand({ launcher: 'MultiMC' }), cand({ launcher: 'Modrinth App' })])).toBe(
    'Prism Launcher, MultiMC и Modrinth App',
  )
})

/// The question is the player's consent to delete the source: it must say the
/// source goes only after the check and that the launcher app itself stays.
test('confirmation says what happens to the source', () => {
  const move = confirmText([cand()], true)
  expect(move, 'move must say the copy is checked first').toContain('сверим')
  expect(move, 'move must say the other launcher is not uninstalled').toContain('не удаляется')
  expect(move, 'move must ask to close the other launcher').toContain('Закрой Prism Launcher')
  const copy = confirmText([cand()], false)
  expect(copy, 'a copy must promise the source stays').toContain('останется как есть')
  expect(copy, 'a copy must not talk about removing').not.toContain('уберём')
})

test('row verdict tells a move from a copy and from a leftover', () => {
  const cases: [RowResult, string, string][] = [
    [{ kind: 'ok', outcome: outcome() }, 'Перенесли', 'moved and source gone'],
    [{ kind: 'ok', outcome: outcome({ source_removed: false }) }, 'Скопировали', 'player kept the source'],
    [{ kind: 'ok', outcome: outcome({ source_removed: false, note: 'удали вручную' }) }, 'В Millida, старая папка осталась', 'copy is in, source removal failed'],
    [{ kind: 'error', text: 'Закрой Prism' }, 'Не перенесли', 'failed move'],
  ]
  for (const [r, want, why] of cases) expect(rowVerdict(r), why).toBe(want)
})

/// Success is shown only on success: a batch where nothing moved must not toast «Перенесли».
test('batch summary never reports success that did not happen', () => {
  const ok: RowResult = { kind: 'ok', outcome: outcome() }
  const bad: RowResult = { kind: 'error', text: 'x' }
  expect(batchSummary([bad, bad]).kind).toBe('error')
  expect(batchSummary([bad, bad]).text).not.toContain('Перенесли')
  expect(batchSummary([ok, ok])).toEqual({ text: 'Перенесли 2 сборки — играй в «Моих сборках»', kind: 'ok' })
  expect(batchSummary([ok, bad]).kind, 'a partial batch must not look fully done').toBe('error')
})
