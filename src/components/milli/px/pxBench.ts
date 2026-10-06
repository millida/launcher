/**
 * Значки верстака сборки: вкладка «Настройки» (компаратор), уровни шейдеров
 * (выключенная лампа → тусклый → обычный → яркий светокамень), профили ПК
 * (железо → золото → алмаз), ОЗУ (красная пыль), дальность (подзорная труба).
 * Формат — pxTypes.ts.
 */
import { PX_PACK } from './pxPack'
import type { PxSprite } from './pxTypes'

/** Компаратор: каменная плита, два факела сзади и один спереди, дорожка красной пыли. */
const COMPARATOR: PxSprite = {
  pal: {
    o: '#24242a', k: '#4a0806', Y: '#ffd9b8', r: '#ff3b24', R: '#b5130c', s: '#b08650', S: '#634526',
    P: '#c2c2bb', p: '#9a9a96', q: '#6e6e70', x: '#741010', X: '#ff3a26', f: '#86868a', F: '#5a5a62',
  },
  rows: [
    '................',
    '...kk......kk...',
    '..kYrk....kYrk..',
    '..krRk....krRk..',
    '..osSo....osSo..',
    '..osSo.kk.osSo..',
    'ooosSokYrkosSooo',
    'oPPsSPkrRkPsSPpo',
    'oPPqqPPsSPPqqPpo',
    'oPPPPPPsSPPPPppo',
    'oPxXXxxqqxxXXxpo',
    'oPPPPPPPPPPPPppo',
    'oPpPPPPPPPPpPppo',
    'offffffffffffFFo',
    'oFFFFFFFFFFFFFFo',
    '.oooooooooooooo.',
  ],
}

/** Лампа из красного камня, выключенная: «шейдеров нет». */
const REDSTONE_LAMP_OFF: PxSprite = {
  pal: {
    o: '#1e130a', B: '#7a5536', g: '#a07a52', G: '#b8905e', k: '#3e2817',
    C: '#5e3e28', h: '#7e6044', H: '#94724e', j: '#2e1d11',
    D: '#44291a', i: '#5e4632', I: '#6e543a', q: '#22160c',
  },
  rows: [
    '......oooo......',
    '....ooBBBBoo....',
    '..ooBBkggkBBoo..',
    'ooBBGGGkkgggBBoo',
    'oCBBGkkGGkkgBBDo',
    'oCCCBBGgggBBDDIo',
    'oChHCCBBBBDDIiio',
    'oCHhjHCCDDIqiIqo',
    'oCjjjhhHDiiqqqio',
    'oChHjjHhDIqqIiio',
    'oCHhjHjjDqIqiIIo',
    'oChHjhhhDiiqIiDo',
    'ooCCjHHhDIIqDDoo',
    '..ooCChHDiDDoo..',
    '....ooCCDDoo....',
    '......oooo......',
  ],
}

/** Лампа из красного камня, включённая: тот же рисунок, что у выключенной (слои совпадают клетка в клетку). */
const REDSTONE_LAMP_ON: PxSprite = {
  rows: REDSTONE_LAMP_OFF.rows,
  pal: {
    o: '#2a1204', B: '#b86a28', g: '#ffd27a', G: '#fff4c8', k: '#7a3c12',
    C: '#8a4a18', h: '#f0a040', H: '#ffcc70', j: '#5e2a0a',
    D: '#62320e', i: '#c87424', I: '#e09438', q: '#3e1c06',
  },
}

const GLOW = PX_PACK.glowstone

/** Тусклый светокамень — «Лёгкие» шейдеры (тот же рисунок, приглушённая палитра). */
const GLOWSTONE_DIM: PxSprite = {
  rows: GLOW.rows,
  pal: {
    o: '#2e1a08', C: '#e8c48a', Y: '#d8a85a', g: '#9a6428', c: '#c99a52',
    U: '#b07a34', h: '#6a3c18', e: '#a87232', V: '#87501e', j: '#4a280e',
  },
}

/** Яркий светокамень — «Тяжёлые» шейдеры: палитра светлее, по углам искры. */
const GLOWSTONE_BRIGHT: PxSprite = {
  rows: [
    '.S....oooo......',
    'SSS.ooCCYYoo..S.',
    '.S.oYCCYgYCYoo..',
    'oogYYgCCYgYCCgoo',
    ...GLOW.rows.slice(4, 12),
    'ooUhhUcUjjjjVVoo',
    '..oocUhheVjeoo.S',
    '.S..ooUhVVoo..SS',
    '......oooo.....S',
  ],
  pal: {
    o: '#6a3a0c', C: '#ffffff', Y: '#fff6c0', g: '#ffc04a', c: '#fff0a8',
    U: '#ffd060', h: '#d0802e', e: '#ffc860', V: '#f0a040', j: '#a85a1c', S: '#fff3b0',
  },
}

/** Слиток: верх светлый, длинный бок средний, торец тёмный. Железо и золото — одна форма. */
const INGOT_ROWS = [
  '................',
  '................',
  '................',
  '....oo..........',
  '..oohhoo........',
  '.ohhLLhhoo......',
  'omMMllLLhhoo....',
  'ommmMMllLLhho...',
  'oddmmmMMllLlDo..',
  '.ooddmmmMMrrrDo.',
  '...ooddmmmrrrDDo',
  '.....ooddmrDDoo.',
  '.......oodDoo...',
  '.........oo.....',
  '................',
  '................',
]

/** Железный слиток — профиль «Слабый ПК». */
const IRON_INGOT: PxSprite = {
  rows: INGOT_ROWS,
  pal: {
    o: '#2c2c33', h: '#ffffff', L: '#e2e2e2', l: '#cfcfd2', M: '#b8b8be', m: '#a0a0a8',
    d: '#7c7c86', r: '#8a8a94', D: '#5c5c68',
  },
}

/** Золотой слиток — профиль «Средний». */
const GOLD_INGOT: PxSprite = {
  rows: INGOT_ROWS,
  pal: {
    o: '#4a2a06', h: '#fffbd0', L: '#fff07a', l: '#fbd84a', M: '#f2c12e', m: '#e0a01e',
    d: '#b06a10', r: '#c47a14', D: '#7e4608',
  },
}

/** Алмаз — профиль «Мощный»: площадка сверху, грани сходятся к острию. */
const DIAMOND: PxSprite = {
  pal: {
    o: '#0b3a3c', W: '#f0fffc', l: '#a6f7ec', c: '#4fe0d0', d: '#25aba0', D: '#16736f',
  },
  rows: [
    '................',
    '................',
    '....oooooooo....',
    '...olWWWWllco...',
    '..olWWWWWllcco..',
    '.olWWWWllcccddo.',
    'oWlllllccccdddDo',
    '.olWlcccccdddDo.',
    '..olWlcccddDDo..',
    '...olWlccdDDo...',
    '....olWcddDo....',
    '.....olcdDo.....',
    '......ocDo......',
    '.......oo.......',
    '................',
    '................',
  ],
}

/** Красная пыль — ОЗУ («сколько памяти»). */
const REDSTONE: PxSprite = {
  pal: { o: '#4a0606', H: '#ff8a72', R: '#e8281a', r: '#a8100a', k: '#6a0a08' },
  rows: [
    '................',
    '................',
    '.......oo.......',
    '....oo.oRo.oo...',
    '...oRRoRHRoRRo..',
    '...oRHRRRRRrRo..',
    '..oRRRHRRrRRro..',
    '.oRRHRRRkRrRrro.',
    '.oRRRRRrRRRrkro.',
    '..oRRkRRRrRrro..',
    '..orRRRrRRrrRo..',
    '...orrRrkrrro...',
    '....oorrroooo...',
    '......ooo.......',
    '................',
    '................',
  ],
}

/** Подзорная труба — дальность прорисовки: медный корпус, аметистовое стекло объектива. */
const SPYGLASS: PxSprite = {
  pal: {
    o: '#2a160c', h: '#ffc49a', l: '#e88e5a', m: '#b85f36', d: '#7d3a1e', k: '#3e2112',
    q: '#6a6a72', Q: '#3e3e46', A: '#efe2ff', a: '#b394f0', V: '#6a48b0',
  },
  rows: [
    '............oo..',
    '...........oAAo.',
    '..........ohlaVo',
    '.........ohlmdVo',
    '........oklmddo.',
    '........okkddo..',
    '.......olmkko...',
    '......olmdoo....',
    '.....olmdo......',
    '....olmdo.......',
    '...olmdo........',
    '..olmdo.........',
    '.oqQdo..........',
    '.oQQo...........',
    '..oo............',
    '................',
  ],
}

/** Факел — тени: крупное пламя каплей, угольная головка, палочка в два тона, две искры. */
const TORCH: PxSprite = {
  pal: {
    o: '#2a1608', W: '#fffbe0', Y: '#ffd84a', f: '#ff9a1e', F: '#e05a10', k: '#3a2a20',
    s: '#b0844e', S: '#6e4e2a', g: '#ffe9a0',
  },
  rows: [
    '.......oo.......',
    '...g..oYYo......',
    '.....oYWWYo.....',
    '....oYWWWWYo.g..',
    '....oYWWWYfo....',
    '....ofYYYffo....',
    '.....oFkkFo.....',
    '......osSo......',
    '......osSo......',
    '......osSo......',
    '......osSo......',
    '......osSo......',
    '......osSo......',
    '......osSo......',
    '......osSo......',
    '......oooo......',
  ],
}

/** Звезда фейерверка — частицы: шарик пороха с цветными крупинками и искры вокруг. */
const FIREWORK_STAR: PxSprite = {
  pal: {
    o: '#26262c', H: '#cfcfd4', h: '#a8a8b0', m: '#84848e', d: '#5e5e68', D: '#44444e',
    R: '#ff4d4d', Y: '#ffd84a', B: '#4da3ff', G: '#5fe06a', S: '#ffffff', s: '#f2b632',
  },
  rows: [
    '..s.............',
    '.sSs............',
    '..s..oooooo..S..',
    '....oHHhhhmo....',
    '...oHhhRhhmmo...',
    '..oHhYhhhmGmmo..',
    '..ohhhhmBmmmdo..',
    '..ohRhmmmmYmdo..',
    '..ohhmmGmmmddo..',
    '..ommmmmmRddDo..',
    '...ommBmmddDo...',
    '....odddddDo....',
    '.....oooooo..s..',
    '..S.........sSs.',
    '.............s..',
    '................',
  ],
}

export const PX_BENCH = {
  comparator: COMPARATOR,
  redstone_lamp_off: REDSTONE_LAMP_OFF,
  redstone_lamp_on: REDSTONE_LAMP_ON,
  glowstone_dim: GLOWSTONE_DIM,
  glowstone_bright: GLOWSTONE_BRIGHT,
  iron_ingot: IRON_INGOT,
  gold_ingot: GOLD_INGOT,
  diamond: DIAMOND,
  redstone: REDSTONE,
  spyglass: SPYGLASS,
  torch: TORCH,
  firework_star: FIREWORK_STAR,
} satisfies Record<string, PxSprite>
