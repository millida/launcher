import { describe, expect, test } from 'bun:test'
import { changesFromCommits, changesFromSubjects, publicCommitBody, releaseNotes, sourceCommitOf } from './release-notes.mjs'

describe('changesFromSubjects', () => {
  const cases = [
    ['feat(hub): pin our servers', ['Pin our servers'], 'scope prefix is stripped, first letter capitalised'],
    ['fix: sign-in no longer loses the session', ['Sign-in no longer loses the session'], 'plain fix is a user-visible change'],
    ['perf(lobby)!: faster lobby', ['Faster lobby'], 'breaking marker does not hide the change'],
    ['chore(ci): runner cache', [], 'internal chores never reach players'],
    ['Merge pull request #160 from millida/main', [], 'merge commits are noise'],
    ['open source: sync', [], 'subjects without a conventional type are skipped'],
  ]
  for (const [subject, expected, why] of cases) {
    test(`${subject} -> ${expected.length} (${why})`, () => {
      expect(changesFromSubjects([subject]), why).toEqual(expected)
    })
  }

  test('duplicates collapse into one line', () => {
    expect(changesFromSubjects(['fix: same thing', 'fix(ui): same thing'])).toEqual(['Same thing'])
  })
})

describe('changesFromCommits', () => {
  test('a Russian subject is never published', () => {
    expect(changesFromCommits(['fix: вход не терял сессию', 'feat: faster lobby'])).toEqual(['Faster lobby'])
  })

  test('the Changelog trailer gives the English wording of a Russian subject', () => {
    const commits = [{ subject: 'feat(hub): закреплены наши серверы', body: 'Подробности.\n\nChangelog: pin our servers\n' }]
    expect(changesFromCommits(commits)).toEqual(['Pin our servers'])
  })

  test('a Russian Changelog trailer is dropped too', () => {
    expect(changesFromCommits([{ subject: 'fix: sign-in', body: 'Changelog: вход' }])).toEqual([])
  })

  test('internal commits stay out even with a trailer', () => {
    expect(changesFromCommits([{ subject: 'chore: cache', body: 'Changelog: faster builds' }])).toEqual([])
  })
})

describe('sourceCommitOf', () => {
  const cases = [
    ['Release 2.0.176\n\nСобрано из 95e8ce0.', '95e8ce0', 'sync commit body names its source'],
    ['Release 2.0.203\n\n- Build fixes\n\nSource-Commit: 1a2b3c4', '1a2b3c4', 'new body keeps the source as a trailer'],
    [publicCommitBody({ changes: [], source: 'abcdef1' }), 'abcdef1', 'body without changes still round-trips'],
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
      expect(body, `${os} image must not change after the release`).toContain(`/v2.0.1/.github/readme/download-${os}-en.png`)
    }
  })

  test('changes section appears only when there are changes', () => {
    expect(releaseNotes({ version: '2.0.1' })).not.toContain("What's new")
    expect(releaseNotes({ version: '2.0.1', changes: ['Faster lobby'] })).toContain('- Faster lobby')
  })

  test('long change lists are capped', () => {
    const changes = Array.from({ length: 25 }, (_, i) => `Change ${i}`)
    const body = releaseNotes({ version: '2.0.1', changes })
    expect(body, 'the 21st change must be folded into the counter').not.toContain('Change 20')
    expect(body).toContain('- and 5 more')
  })

  test('versioned files list skips updater-only macOS archives', () => {
    const body = releaseNotes({ version: '2.0.1', platforms })
    expect(body).toContain('[Millida-Launcher_2.0.1_x64-setup.exe](https://cdn.test/2.0.1/w/Millida-Launcher_2.0.1_x64-setup.exe)')
    expect(body).toContain('Millida-Launcher_2.0.1_amd64.AppImage')
    expect(body, 'app.tar.gz is an updater payload, not something a player can install').not.toContain('app.tar.gz')
  })
})
