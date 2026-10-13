import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const HOST = '<ChestOpenHost />'

describe('chest opening window', () => {
  it('the host is mounted once for the whole app, outside any screen', () => {
    const app = source('../../App.tsx')
    const at = app.indexOf(HOST)
    expect(
      at,
      'without the app-wide host «Открыть сундук» in the lobby claims the chest and shows nothing: the only other hosts live inside the pass, which is mounted on the shop screen',
    ).toBeGreaterThan(-1)
    expect(at, 'mounted inside </main> it would again depend on the current screen').toBeGreaterThan(app.indexOf('</main>'))
  })

  it('the lobby button opens the claimed chest through the shared queue', () => {
    const lobby = source('../lobby/PlayChest.tsx')
    const store = source('../../state/playChests.ts')
    expect(lobby, 'the lobby button must claim through the shared store').toContain('usePlayChests.getState().claim()')
    expect(store, 'a claimed chest must be handed to the opening queue, otherwise it silently lands in «Мои сундуки»').toContain('openChestFlow(')
  })

  it('only the last mounted host draws, so the pass and the app never show two windows', () => {
    const host = source('./ChestOpen.tsx')
    expect(host, 'two hosts drawing the same queue would stack two opening windows in the shop').toContain(
      'const chest = last === me ? queue[0] : undefined',
    )
  })
})
