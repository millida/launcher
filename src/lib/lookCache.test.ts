import { describe, expect, mock, test } from 'bun:test'

const store = new Map<string, { at: number; value: unknown }>()

mock.module('./idbCache', () => ({
  idbGet: async (key: string) => store.get(key) ?? null,
  idbSet: async (key: string, value: unknown) => void store.set(key, { at: Date.now(), value }),
}))
mock.module('./textureSource', () => ({
  textureSource: async (url: string) => (url.startsWith('https://ok/') ? 'data:image/png;base64,' + url.slice(11) : url),
}))

const { keepLookSkin, keptLookSkin } = await import('./lookCache')

describe('lookCache', () => {
  const cases: [string, Parameters<typeof keepLookSkin>[1], Awaited<ReturnType<typeof keptLookSkin>>, string][] = [
    [
      'Steve',
      { skin: 'https://ok/skin', slim: true, cape: 'https://ok/cape' },
      { skin: 'data:image/png;base64,skin', slim: true, cape: 'data:image/png;base64,cape' },
      'a read skin and cape come back offline, so the next start shows the figure before any network answer',
    ],
    [
      'Alex',
      { skin: 'https://down/skin', slim: false, cape: null },
      null,
      'a link that was never read is not kept: the webview cannot load it without the core (no CORS)',
    ],
    [
      'Kai',
      { skin: 'https://ok/skin', slim: false, cape: 'https://down/cape' },
      { skin: 'data:image/png;base64,skin', slim: false, cape: null },
      'an unread cape does not cost the kept skin',
    ],
  ]
  for (const [nick, look, want, why] of cases) {
    test(why, async () => {
      await keepLookSkin(nick, look)
      expect(await keptLookSkin(nick), why).toEqual(want)
    })
  }

  test('one player never gets another player\'s kept skin after switching accounts', async () => {
    await keepLookSkin('Owner', { skin: 'https://ok/owner', slim: false, cape: null })
    expect(await keptLookSkin('Guest'), 'the kept look is per nick').toBeNull()
  })

  test('a month-old look is dropped: the player has long since changed clothes', async () => {
    store.set('lobby-look:v1:Old', { at: Date.now() - 31 * 86_400_000, value: { skin: 'data:image/png;base64,x', slim: false, cape: null } })
    expect(await keptLookSkin('Old')).toBeNull()
  })
})
