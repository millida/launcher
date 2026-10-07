import { expect, test } from 'bun:test'
import { frameSource, summarize, type LongFrame } from './jank'

const sourceCases: { entry: Parameters<typeof frameSource>[0]; want: string; why: string }[] = [
  { entry: {}, want: 'render', why: 'a long frame without scripts is style, layout or paint work' },
  {
    entry: {
      scripts: [
        { duration: 20, sourceFunctionName: 'pump', sourceURL: 'http://tauri.localhost/assets/outfitSnapshot-abc.js?v=1' },
        { duration: 90, sourceFunctionName: 'shoot', sourceURL: 'http://tauri.localhost/assets/outfitSnapshot-abc.js#x' },
      ],
    },
    want: 'shoot@outfitSnapshot-abc.js',
    why: 'the heaviest script names the frame, with the bundle file but no host, query or hash',
  },
  { entry: { scripts: [{ duration: 70, invoker: 'IMG.onload' }] }, want: 'IMG.onload', why: 'without a function name the invoker still tells what ran' },
  { entry: { scripts: [{ duration: 70 }] }, want: 'script', why: 'an anonymous script is still distinguishable from rendering' },
]

test.each(sourceCases)('frameSource: $why', ({ entry, want }) => {
  expect(frameSource(entry), 'telemetry would blame the wrong code for the freeze').toBe(want)
})

const frames: LongFrame[] = [
  { start: 900, duration: 300, source: 'before' },
  { start: 1000, duration: 80, source: 'a' },
  { start: 1500, duration: 220, source: 'shoot' },
  { start: 3999, duration: 60, source: 'b' },
  { start: 4000, duration: 500, source: 'after' },
]

const windowCases: { from: number; until: number; want: ReturnType<typeof summarize>; why: string }[] = [
  { from: 1000, until: 4000, want: { n: 3, worstMs: 220, sumMs: 360, src: 'shoot' }, why: 'only frames of this visit count, the window end is exclusive' },
  { from: 5000, until: 8000, want: null, why: 'a smooth visit reports nothing' },
]

test.each(windowCases)('summarize: $why', ({ from, until, want }) => {
  expect(summarize(frames, from, until), 'a freeze of another screen would be attributed to this one').toEqual(want)
})
