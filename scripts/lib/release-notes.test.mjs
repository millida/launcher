import { describe, expect, test } from 'bun:test'
import { changesFromSubjects, releaseNotes, sourceCommitOf } from './release-notes.mjs'

describe('changesFromSubjects', () => {
  const cases = [
    ['feat(hub): закреплены наши серверы', ['Закреплены наши серверы'], 'scope prefix is stripped, first letter capitalised'],
    ['fix: вход не терял сессию', ['Вход не терял сессию'], 'plain fix is a user-visible change'],
    ['perf(lobby)!: быстрее лобби', ['Быстрее лобби'], 'breaking marker does not hide the change'],
    ['chore(ci): кэш раннера', [], 'internal chores never reach players'],
    ['Merge pull request #160 from millida/main', [], 'merge commits are noise'],
    ['открытый код: синхронизация', [], 'subjects without a conventional type are skipped'],
  ]
  for (const [subject, expected, why] of cases) {
    test(`${subject} -> ${expected.length} (${why})`, () => {
      expect(changesFromSubjects([subject]), why).toEqual(expected)
    })
  }

  test('duplicates collapse into one line', () => {
    expect(changesFromSubjects(['fix: одно и то же', 'fix(ui): одно и то же'])).toEqual(['Одно и то же'])
  })
})

describe('sourceCommitOf', () => {
  const cases = [
    ['Release 2.0.176\n\nСобрано из 95e8ce0.', '95e8ce0', 'sync commit body names its source'],
    ['Initial commit', null, 'foreign commits have no source'],
    [undefined, null, 'missing message is tolerated'],
  ]
  for (const [message, expected, why] of cases) {
    test(`${JSON.stringify(message)} -> ${expected} (${why})`, () => {
      expect(sourceCommitOf(message), why).toBe(expected)
    })
  }
})

describe('releaseNotes', () => {
  const platforms = {
    'windows-x86_64': { url: 'https://cdn.test/2.0.1/w/Millida-Launcher_2.0.1_x64-setup.exe' },
    'darwin-aarch64': { url: 'https://cdn.test/2.0.1/m/Millida-Launcher.app.tar.gz' },
    'linux-x86_64': { url: 'https://cdn.test/2.0.1/l/Millida-Launcher_2.0.1_amd64.AppImage' },
  }

  test('download buttons point at the site and at images pinned to the tag', () => {
    const body = releaseNotes({ version: '2.0.1' })
    for (const os of ['windows', 'macos', 'linux']) {
      expect(body, `${os} button must lead to the always-fresh installer`).toContain(`https://millida.net/launcher/dl/${os}`)
      expect(body, `${os} image must not change after the release`).toContain(`/v2.0.1/.github/readme/dl-${os}.png`)
    }
  })

  test('changes section appears only when there are changes', () => {
    expect(releaseNotes({ version: '2.0.1' })).not.toContain('Что нового')
    expect(releaseNotes({ version: '2.0.1', changes: ['Быстрее лобби'] })).toContain('- Быстрее лобби')
  })

  test('long change lists are capped', () => {
    const changes = Array.from({ length: 25 }, (_, i) => `Правка ${i}`)
    const body = releaseNotes({ version: '2.0.1', changes })
    expect(body, 'the 21st change must be folded into the counter').not.toContain('Правка 20')
    expect(body).toContain('- и ещё 5')
  })

  test('versioned files list skips updater-only macOS archives', () => {
    const body = releaseNotes({ version: '2.0.1', platforms })
    expect(body).toContain('[Millida-Launcher_2.0.1_x64-setup.exe](https://cdn.test/2.0.1/w/Millida-Launcher_2.0.1_x64-setup.exe)')
    expect(body).toContain('Millida-Launcher_2.0.1_amd64.AppImage')
    expect(body, 'app.tar.gz is an updater payload, not something a player can install').not.toContain('app.tar.gz')
  })
})
