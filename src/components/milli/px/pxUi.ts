/**
 * Значки интерфейса чата: отправить (бумажный самолётик), убрать/стоп
 * (барьер), история (часы), открыть (компас). Формат — pxTypes.ts.
 * Круглые предметы стоят на одной и той же окружности (контур 16 клеток в
 * поперечнике), чтобы в меню они были одного размера.
 */
import type { PxSprite } from './pxTypes'

/** Бумажный самолётик: светлое верхнее крыло, холодная тень нижнего, тёмный киль. */
const PAPER_PLANE: PxSprite = {
  pal: { o: '#2d3142', W: '#fbfaf2', w: '#dcdccc', s: '#b7bccb', S: '#7d8399' },
  rows: [
    '.............ooo',
    '...........ooWWo',
    '.........ooWWWso',
    '.......ooWWWWsso',
    '.....ooWWWWWWsso',
    '...ooWWWWWWWsso.',
    '.ooWWWWWWWWssso.',
    'oWWWWWWWWWssso..',
    '.ooWWWWWWwsSso..',
    '...ooWWWwSsso...',
    '.....oowSSsso...',
    '......oSSsso....',
    '......oSSso.....',
    '.......oSso.....',
    '.......oso......',
    '........o.......',
  ],
}

/** Барьер: красное кольцо с косой чертой, как у невидимого блока-барьера. */
const BARRIER: PxSprite = {
  pal: { o: '#4f080d', h: '#ff7a5c', l: '#f2392e', r: '#c8161f', d: '#8c0e17' },
  rows: [
    '.....oooooo.....',
    '...oohhhllloo...',
    '..ohhhhllllllo..',
    '.odrloooooolrro.',
    '.ohdrlo....orro.',
    'ohhodrlo....orro',
    'ohhoodrlo...orro',
    'ohlo.odrlo..ordo',
    'ollo..odrlo.oddo',
    'ollo...odrlooddo',
    'ollo....odrloddo',
    '.ollo....odrldo.',
    '.olrroooooodrlo.',
    '..orrrrrdddddo..',
    '...oorrddddoo...',
    '.....oooooo.....',
  ],
}

/** Часы: золотой обод, сверху день с солнцем, снизу ночь с луной и звёздами, метка полудня. */
const CLOCK: PxSprite = {
  pal: {
    o: '#3d2606', G: '#fff0a0', g: '#f0bd3c', n: '#b0721a', k: '#2b2b33',
    b: '#62b0ff', B: '#3f7fd6', y: '#ffbf2e', Y: '#fff6c4',
    v: '#26306e', V: '#171d4a', w: '#cfd8ff', m: '#f4f1e2', M: '#b9bccc',
  },
  rows: [
    '.....oooooo.....',
    '...ooGGGGGGoo...',
    '..oGGGGkkgggno..',
    '.oGGgBBBBBBgnno.',
    '.oGgBbbyybbbnno.',
    'oGgBbbyYYybbbnno',
    'oGgBbbyYYybbbnno',
    'oGgBbbbyybbbbnno',
    'oGgVvwvvvvvvvnno',
    'oGgVvvvmmvvvwnno',
    'oggVvvvmMvvvvnno',
    '.oggVvvvvvwvnno.',
    '.oggnvvvvvvnnno.',
    '..ognnnnnnnnno..',
    '...oonnnnnnoo...',
    '.....oooooo.....',
  ],
}

/** Компас: железный обод, тёмный циферблат, красная стрелка на северо-восток, золотая ось. */
const COMPASS: PxSprite = {
  pal: {
    o: '#24242c', G: '#f2f2f2', g: '#b8b8c0', n: '#74747f',
    C: '#3c3c48', c: '#55555f', x: '#8a8a96',
    R: '#ff3b30', r: '#b81d1d', W: '#f4f4f4', w: '#a9a9b5', P: '#ffd75a', p: '#c9962a',
  },
  rows: [
    '.....oooooo.....',
    '...ooGGGGGGoo...',
    '..oGGGGgggggno..',
    '.oGGgCCxxCCgnno.',
    '.oGgCccccccRnno.',
    'oGgCccccccRrcnno',
    'oGgCcccccRrccnno',
    'oGgxcccPRrcccnno',
    'oGgcccwWpcccxnno',
    'oGgccwWccccccnno',
    'oGgcwWcccccccnno',
    '.oggWcccccccnno.',
    '.oggnccxxccnnno.',
    '..ognnnnnnnnno..',
    '...oonnnnnnoo...',
    '.....oooooo.....',
  ],
}

/** Звезда Незера: четыре длинных луча до краёв, короткие диагональные, бледное ядро, лавандовые тени, блеск. */
const NETHER_STAR: PxSprite = {
  pal: { o: '#3d2f6e', W: '#ffffff', Y: '#fff3c4', l: '#e4dcff', v: '#b9aee6', V: '#8478c0' },
  rows: [
    '.......oo.......',
    '......oWlo......',
    '......oWlo......',
    '..oo..oWlo..oo..',
    '..oWo.oWlo.olo..',
    '...oWYYWllvlo...',
    '....oYYWWllo....',
    'oWWWYYWWWlllvvvo',
    'olllYYWWlvvvVVVo',
    '....oYWllvvo....',
    '...olYlvvvVVo...',
    '..olo.olvo.oVo..',
    '..oo..olvo..oo..',
    '......ovVo......',
    '......ovVo......',
    '.......oo.......',
  ],
  glint: '*',
}

export const PX_UI = {
  paper_plane: PAPER_PLANE,
  barrier: BARRIER,
  clock: CLOCK,
  compass: COMPASS,
  nether_star: NETHER_STAR,
} satisfies Record<string, PxSprite>
