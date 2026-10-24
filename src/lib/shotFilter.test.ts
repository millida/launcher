import { describe, expect, test } from 'bun:test'
import { filterShots, shotAlbums } from './shotFilter'
import { toImageRect } from '../components/ShotCrop'

const shots = [
  { name: '2026-10-01_12.00.00.png', caption: 'Закат над базой', album: 'База', profile: 'Выживание' },
  { name: '2026-10-02_12.00.00.png', caption: '', album: '', profile: 'Выживание' },
  { name: '2026-10-03_12.00.00.png', caption: 'Ёлка на спавне', album: 'Праздники', profile: 'Сервер' },
]

describe('screenshot search', () => {
  const cases: Array<[string, string, string, number]> = [
    ['an empty query shows everything', '', '', 3],
    ['words from the caption', 'закат базой', '', 1],
    ['ё and е are the same letter', 'елка', '', 1],
    ['the build name counts', 'сервер', '', 1],
    ['an album narrows the list', '', 'База', 1],
    ['album and words together', 'закат', 'Праздники', 0],
  ]
  for (const [why, q, album, n] of cases) test(why, () => expect(filterShots(shots, q, album)).toHaveLength(n))

  test('albums are listed once, sorted', () => expect(shotAlbums(shots)).toEqual(['База', 'Праздники']))
})

describe('crop rectangle', () => {
  test('a drag on a half-size preview maps to full-size pixels', () => {
    expect(toImageRect({ x: 10, y: 20, w: 100, h: 50 }, 960, 540, 1920, 1080)).toEqual({ x: 20, y: 40, width: 200, height: 100 })
  })
  test('a drag up and to the left gives the same rectangle', () => {
    expect(toImageRect({ x: 110, y: 70, w: -100, h: -50 }, 960, 540, 1920, 1080)).toEqual({ x: 20, y: 40, width: 200, height: 100 })
  })
})
