import { describe, expect, it, mock } from 'bun:test'
import type { Wait } from './lobbyLook'

let detect: () => Promise<boolean> = () => new Promise(() => {})

mock.module('./characterStage', () => ({ nickSkinUrl: (nick: string) => 'https://skins.test/' + nick }))
mock.module('./gameProfile', () => ({ loadWardrobe: async () => null, textureVersion: 0 }))
mock.module('./lookHint', () => ({ lookHint: () => null }))
mock.module('../state/accounts', () => ({ lookOwner: () => '' }))
mock.module('./skinArms', () => ({ detectSlimFromUrl: () => detect() }))

const { nickLookSkin, SLIM_DETECT_WAIT_MS } = await import('./lobbySkin')

function clock() {
  const timers: { ms: number; fire: () => void }[] = []
  const wait: Wait = (ms) => new Promise((ok) => timers.push({ ms, fire: ok }))
  const pass = async (ms: number) => {
    for (const t of timers.filter((x) => x.ms <= ms)) t.fire()
    await new Promise((ok) => setTimeout(ok, 0))
  }
  return { wait, pass }
}

/**
 * The nick skin stands in for a hung wardrobe on the home figure.
 *
 * case                              verdict                          pinned by
 * texture never loads               Steve arms at the limit          a hung image left the stage with no figure
 * texture answers slim in time      slim arms                        the limit must not throw away a real answer
 */
describe('the nick skin stand-in never hangs the home figure', () => {
  it('a texture that never loads gives classic arms at the limit', async () => {
    detect = () => new Promise(() => {})
    const c = clock()
    const out: { look: Awaited<ReturnType<typeof nickLookSkin>> | null } = { look: null }
    void nickLookSkin('Player', c.wait).then((l) => (out.look = l))
    await c.pass(SLIM_DETECT_WAIT_MS)
    expect(out.look,'a hung skin image must not keep the home figure without a look').toEqual({ skin: 'https://skins.test/Player', slim: false, cape: null })
  })

  it('a slim answer in time is kept', async () => {
    detect = async () => true
    const c = clock()
    const look = await nickLookSkin('Alex', c.wait)
    expect(look.slim, 'a skin read as slim in time must keep its slim arms').toBe(true)
  })
})
