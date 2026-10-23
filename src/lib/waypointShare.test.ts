import { describe, expect, test } from 'bun:test'
import { MARK_PREFIX, markCoords, markDimension, markPreview, parseMark } from './waypointShare'

const P = MARK_PREFIX
const OK = ' «База» 120 64 -340 · nether · mc.example.net'

// Mirrors WaypointShareTest in millida-mod: the launcher must show a card for
// exactly the lines the game would save, and plain text for everything else.
const CASES: Array<[string | null, boolean, string]> = [
  [P + OK, true, 'the reference line reads, so every refusal below is about its own change'],
  ['смотри ' + P + OK, false, 'the marker counts only at the start, as the invite marker does'],
  [P, false, 'a marker without a mark'],
  [P + OK + ' и ещё', false, 'trailing words are not a mark'],
  [P + OK + '\n', false, 'a trailing line break is not a mark either'],
  [P + ' «База» 30000001 64 -340 · nether · mc.example.net', false, 'beyond the world border'],
  [P + ' «База» 30000000 64 -30000000 · nether · mc.example.net', true, 'the world border itself is inside'],
  [P + ' «База» 120 5000 -340 · nether · mc.example.net', false, 'beyond the build height a mark keeps'],
  [P + ' «База» 120 -4096 -340 · nether · mc.example.net', true, 'the lowest height a mark keeps'],
  [P + ' «База» 1e5 64 -340 · nether · mc.example.net', false, 'only plain integers'],
  [P + ' «База» +120 64 -340 · nether · mc.example.net', false, 'only plain integers'],
  [P + ' «База» 1.5 64 -340 · nether · mc.example.net', false, 'only block coordinates'],
  [P + ' «База» 999999999 64 0 · nether · mc.example.net', false, 'too many digits'],
  [P + ' «» 120 64 -340 · nether · mc.example.net', false, 'a mark has a name'],
  [P + ' «§cКрасный» 1 2 3 · nether · mc.example.net', false, 'a colour code would recolour the game chat and the labels'],
  [P + ' «a\u0007b» 1 2 3 · nether · mc.example.net', false, 'control characters are refused'],
  [P + ' «a​b» 1 2 3 · nether · mc.example.net', false, 'invisible characters are refused'],
  [P + ' «a  b» 1 2 3 · nether · mc.example.net', false, 'the game collapses double spaces, so the name would not match'],
  [P + ' « База» 1 2 3 · nether · mc.example.net', false, 'the game trims the name, so a padded one would not match'],
  [P + ' «Точка 1» 1 2 3 · nether · mc.example.net', true, 'a single inner space is part of a name'],
  [P + ' «12345678901234567890123456789012» 1 2 3 · nether · mc.example.net', true, 'exactly the longest name'],
  [P + ' «123456789012345678901234567890123» 1 2 3 · nether · mc.example.net', false, 'longer than a mark name may be'],
  [P + ' «База» 1 2 3 · Nether · mc.example.net', false, 'dimension ids are lower case'],
  [P + ' «База» 1 2 3 · evil · mc.example.net', false, 'a bare word must be one of the three vanilla ones'],
  [P + ' «Портал» 5 70 5 · twilightforest:twilight_forest · mc.example.net', true, 'a modded dimension keeps its full id'],
  [P + ' «База» 1 2 3 · nether · bad<host>', false, 'the address goes through the same rules as a list key'],
  [P + ' «База» 1 2 3 · nether · mc.example.net:99999', false, 'no such port'],
  [P + ' «База» 1 2 3 · nether · mc.example.net:0', false, 'no such port'],
  [P + ' «База» 1 2 3 · nether · a..b', false, 'an empty label is not a host'],
  [P + ' «База» 1 2 3 · nether · [::1]:25565', false, 'a second colon is not a port'],
  [P + ' «База» 1 2 3 · nether', false, 'no address, no list to save into'],
  [P + ' «' + 'a'.repeat(5000) + '» 1 2 3 · nether · mc.example.net', false, 'a huge name is refused by the bounded pattern'],
  [null, false, 'a message without text'],
]

describe('parseMark', () => {
  for (const [input, ok, why] of CASES) {
    test(why, () => {
      expect(parseMark(input as string) !== null, why).toBe(ok)
    })
  }

  test('the card shows what the game would save', () => {
    expect(parseMark(P + ' «База» 120 64 -341 · nether · mc.example.net')).toEqual({
      name: 'База',
      x: 120,
      y: 64,
      z: -341,
      dimension: 'minecraft:the_nether',
      address: 'mc.example.net',
    })
  })

  test('another port travels, the default one is left out as the player types it', () => {
    expect(parseMark(P + ' «Шахта» 0 -59 0 · overworld · play.example.net:25566')?.address).toBe('play.example.net:25566')
    expect(parseMark(P + ' «Шахта» 0 -59 0 · overworld · play.example.net:25565')?.address).toBe('play.example.net')
  })

  test('the address is shown the way the game keys it: lower case, punycode', () => {
    expect(parseMark(P + ' «Дом» 1 2 3 · end · MC.Example.NET')?.address).toBe('mc.example.net')
    expect(parseMark(P + ' «Дом» 1 2 3 · end · пример.рф')?.address).toBe('xn--e1afmkfd.xn--p1ai')
  })

  test('coordinates copy as the game command expects them', () => {
    const m = parseMark(P + ' «База» 120 -0 -341 · nether · mc.example.net')
    expect(m && markCoords(m), 'a negative zero must not reach the clipboard as "-0"').toBe('120 0 -341')
  })

  test('vanilla dimensions read as words, modded ones as their id', () => {
    expect(markDimension('minecraft:the_nether')).toBe('Незер')
    expect(markDimension('twilightforest:twilight_forest')).toBe('twilightforest:twilight_forest')
  })

  test('the chat list names the mark instead of the raw line', () => {
    const m = parseMark(P + OK)
    expect(m && markPreview(m)).toBe('Метка «База»')
  })
})
