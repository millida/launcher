import { describe, expect, test } from 'bun:test'
import { clipTime, parseBbModel, sampleTrack, type BbClip, type BbKeyframe } from './bbModel'

const CHESTS = ['copper', 'diamond', 'obsidian', 'netherite']
const read = (name: string) => Bun.file(new URL('./chests/' + name + '.bbmodel', import.meta.url)).text()

const key = (time: number, x: number, interpolation: BbKeyframe['interpolation'] = 'linear'): BbKeyframe => ({ time, value: [x, 0, 0], interpolation })

describe('designer chest models', () => {
  for (const name of CHESTS) {
    test(name + ' parses with a looping idle clip, a held open clip and a chest_up lid bone', async () => {
      const m = parseBbModel(await read(name))
      const loops = m.clips.map((c) => c.loop).sort()
      expect(loops, name + ': the shop needs exactly one idle (loop) and one open (hold) clip').toEqual(['hold', 'loop'])
      const names: string[] = []
      const walk = (ns: typeof m.roots) => ns.forEach((n) => 'children' in n && (names.push(n.name), walk(n.children)))
      walk(m.roots)
      expect(names, name + ': the open timing is read from the chest_up bone').toContain('chest_up')
      const open = m.clips.find((c) => c.loop === 'hold')!
      expect(open.tracks.length, name + ': an open clip without tracks leaves the lid shut').toBeGreaterThan(0)
    })
  }
})

describe('sampleTrack', () => {
  const linear = [key(0, 0), key(1, 10)]
  const curve = [key(0, 0, 'catmullrom'), key(0.5, 120, 'catmullrom'), key(1, 90, 'catmullrom')]
  const cases: [string, BbKeyframe[], number, number, string][] = [
    ['before first key', linear, -1, 0, 'holds the first value instead of extrapolating'],
    ['after last key', linear, 5, 10, 'holds the last value: the lid must stay open'],
    ['linear middle', linear, 0.5, 5, 'plain lerp between neighbours'],
    ['catmullrom on a key', curve, 0.5, 120, 'the curve passes through the designer key'],
    ['catmullrom end', curve, 1, 90, 'the open pose ends exactly on the last key'],
    ['step', [key(0, 3, 'step'), key(1, 7)], 0.9, 3, 'step keeps the value until the next key'],
    ['empty', [], 0.3, 0, 'a track without keys contributes nothing'],
  ]
  for (const [name, keys, t, want, why] of cases)
    test(name, () => {
      expect(sampleTrack(keys, t)[0], why).toBeCloseTo(want, 5)
    })
})

describe('clipTime', () => {
  const clip = (loop: BbClip['loop']): BbClip => ({ name: '', loop, length: 2, tracks: [] })
  const cases: [string, BbClip, number, number, string][] = [
    ['loop wraps', clip('loop'), 5, 1, 'idle repeats forever'],
    ['loop negative', clip('loop'), -0.5, 1.5, 'never yields a negative time'],
    ['hold clamps', clip('hold'), 9, 2, 'open stays on its last frame'],
    ['hold infinity', clip('hold'), Infinity, 2, 'reduced motion jumps straight to the end'],
  ]
  for (const [name, c, t, want, why] of cases)
    test(name, () => {
      expect(clipTime(c, t), why).toBeCloseTo(want, 5)
    })
})

describe('parseBbModel rejects untrusted input', () => {
  const base = () => ({
    textures: [{ source: 'data:image/png;base64,AAAA', uv_width: 16, uv_height: 16 }],
    elements: [{ uuid: 'c', from: [0, 0, 0], to: [1, 1, 1], faces: { north: { uv: [0, 0, 1, 1], texture: 0 } } }],
    outliner: ['c'],
  })
  const cases: [string, (j: ReturnType<typeof base>) => unknown, string][] = [
    ['remote texture', (j) => ((j.textures[0]!.source = 'https://example.com/x.png'), j), 'textures must be embedded, never fetched'],
    ['texture index', (j) => ((j.elements[0]!.faces.north.texture = 5), j), 'a face cannot point past the texture list'],
    ['nan vector', (j) => ((j.elements[0]!.from = [0, 'x' as unknown as number, 0]), j), 'geometry values must be numbers'],
    ['not a model', () => ({ hello: 1 }), 'random JSON is not a model'],
  ]
  test('valid base parses', () => {
    expect(parseBbModel(JSON.stringify(base())).roots.length).toBe(1)
  })
  for (const [name, mutate, why] of cases)
    test(name, () => {
      expect(() => parseBbModel(JSON.stringify(mutate(base()))), why).toThrow()
    })
})
