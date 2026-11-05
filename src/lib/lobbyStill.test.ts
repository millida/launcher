import { describe, expect, mock, test } from 'bun:test'

mock.module('../state/accounts', () => ({ getAccount: () => null, lookOwner: () => '' }))
const deleted: string[] = []
mock.module('./idbCache', () => ({ idbGet: async () => null, idbSet: async () => {}, idbDel: async (key: string) => void deleted.push(key) }))

const { readLobbyStill, stillPlacement } = await import('./lobbyStill')
const { lobbyFigureBox } = await import('./lobbyFrame')

/** Окно без рамки по умолчанию: сцена на всю высоту лобби. */
const base = { w: 1200, h: 760, top: 0, scene: 760 }

describe('stillPlacement', () => {
  test('the same stage takes the still as it is', () => {
    expect(stillPlacement(base, base)).toEqual({ left: 0, top: 0, width: 1200, height: 760 })
  })

  test('a wider window only centres the still: the figure does not depend on width', () => {
    const p = stillPlacement(base, { ...base, w: 1600 })!
    expect(p.width).toBe(1200)
    expect(p.left).toBe(200)
    expect(p.top).toBe(0)
  })

  test('a taller window puts the feet and height where the 3D figure will stand', () => {
    const now = { w: 1600, h: 1000, top: 0, scene: 1000 }
    const p = stillPlacement(base, now)!
    const a = lobbyFigureBox(base.h, base.top, base.scene)
    const b = lobbyFigureBox(now.h, now.top, now.scene)
    const scale = p.width / base.w
    expect(p.top + a.feet * scale).toBeCloseTo(b.feet)
    expect(a.tall * scale).toBeCloseTo(b.tall)
    expect(p.left + (base.w / 2) * scale).toBeCloseTo(now.w / 2)
  })

  test('a stage the still would have to blow up past sharpness gets none', () => {
    expect(stillPlacement(base, { w: 3000, h: 2000, top: 0, scene: 2000 })).toBeNull()
    expect(stillPlacement(base, { w: 300, h: 300, top: 0, scene: 300 })).toBeNull()
  })
})

describe('readLobbyStill', () => {
  test('the pre-v2 still of the account is deleted once, not on every read', async () => {
    expect(await readLobbyStill()).toBeNull()
    await readLobbyStill()
    expect(deleted).toEqual(['lobby-still:v1:guest'])
  })
})
