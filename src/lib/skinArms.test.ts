import { describe, expect, mock, test } from 'bun:test'

mock.module('./textureSource', () => ({ textureSource: async (u: string) => u }))

const { slimFromPixels } = await import('./skinArms')

type Px = [number, number, number, number]

const fill = (p: Px) => (a: [number, number, number, number]) => Array.from({ length: a[2] * a[3] }, () => p)
const noisy = (a: [number, number, number, number]) =>
  Array.from({ length: a[2] * a[3] }, (_, i) => [(i * 37) % 256, (i * 91) % 256, (i * 13) % 256, 255] as Px)

const CASES: { name: string; why: string; w: number; h: number; read: (a: [number, number, number, number]) => Px[]; slim: boolean }[] = [
  {
    name: 'transparent unused columns',
    why: 'the lobby showed an Alex skin as Steve with black stripes behind the arms (owner, 25.09.2026)',
    w: 64,
    h: 64,
    read: fill([0, 0, 0, 0]),
    slim: true,
  },
  { name: 'flat black unused columns', why: 'common way editors pad Alex skins', w: 64, h: 64, read: fill([0, 0, 0, 255]), slim: true },
  { name: 'real arm pixels', why: 'Steve skins must keep the wide arms', w: 64, h: 64, read: noisy, slim: false },
  { name: 'legacy 64x32 skin', why: 'old format has no slim variant at all', w: 64, h: 32, read: fill([0, 0, 0, 0]), slim: false },
]

describe('slimFromPixels', () => {
  for (const c of CASES) {
    test(c.name, () => {
      expect(slimFromPixels(c.w, c.h, c.read), c.name + ': ' + c.why).toBe(c.slim)
    })
  }
})
