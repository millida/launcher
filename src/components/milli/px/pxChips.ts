/**
 * Предметы стартовых подсказок (хотбар чата): хоррор, зомби-апокалипсис,
 * Create, выживание с друзьями. Одно семейство с pxChipsB.ts: контур в клетку,
 * свет сверху-слева, головы — сетка 7×7 «текселей» по 2 клетки (нос ровно по
 * центру), как лицо моба 8×8 в Minecraft. Формат — pxTypes.ts.
 */
import type { PxSprite } from './pxTypes'

/** Херобрин: голова Стива с пустыми светящимися глазами. */
const STEVE_GLOW: PxSprite = {
  pal: {
    o: '#120c08', j: '#5e3e24', h: '#43291a', H: '#2e1c11',
    S: '#c08f72', s: '#8f6450', d: '#7a5040', n: '#8d5a43', m: '#5c3626', W: '#ffffff', L: '#e6c2a6',
  },
  rows: [
    '................',
    '....ooooooooooo.',
    '...ojjhjjjjhjjjo',
    '..ojhjjjhjjjhjHo',
    '.ojjjjhjjjjjhHHo',
    'ohHhhhHhhhHhHHHo',
    'ohhhhhhhhhhhHHHo',
    'ohSSSSSSSSShssso',
    'oSSddSSSddSSssso',
    'oLWWLSSSLWWLssso',
    'oLWWLSSSLWWLssso',
    'oSSSSnnnSSSsssso',
    'oSSSmmmmmSSssso.',
    'oSSSSSSSSSssso..',
    'ossssssssssso...',
    '.ooooooooooo....',
  ],
}

/** Голова зомби с окровавленной повязкой через правый глаз. */
const ZOMBIE_BANDAGE: PxSprite = {
  pal: {
    o: '#14220c', g: '#80c95a', G: '#6bb349', D: '#2f5a20', d: '#3d6e2a', m: '#5e9c43', l: '#78b85a',
    E: '#0d120b', k: '#1f4a40', n: '#3b6a2a', N: '#22391a', e: '#355f25', B: '#efe7cf', b: '#c9bf9f', r: '#d01f2a', R: '#7a1016',
  },
  rows: [
    '................',
    '....ooooooooooo.',
    '...ogGgggGgggGgo',
    '..oggGgggggGggeo',
    '.oGgggGggggGgeeo',
    'oBBDDdDDdDDdeeeo',
    'obbBBmdmmdmdeeeo',
    'ommbbBBmmmmdeeeo',
    'omlmmbbBBmmdeeeo',
    'omEEmmmbbrBdeeeo',
    'omEkmmmmmbRBBBBo',
    'ommmmnnnmmrbbbbo',
    'ommmNNNNNmRdeeo.',
    'ommmmmmmmmmdeo..',
    'odddddddddddo...',
    '.ooooooooooo....',
  ],
}

/** Деревянная шестерня Create: восемь квадратных зубцов, толщина обода видна снизу, в центре — андезитовый вал. */
const CREATE_COG: PxSprite = {
  pal: {
    o: '#2b1a0c', h: '#f0cf9a', l: '#d2a56d', m: '#b0824d', d: '#8a6036', D: '#5e3d20', k: '#3a2414',
    A: '#e0e3de', a: '#a9ada7', g: '#7e837c',
  },
  rows: [
    '......ooo.......',
    '..oooohhloooo...',
    '.ohhlohldohhmo..',
    '.ohldohldohmdo..',
    '.ohlmhlllhmddo..',
    '.oDDhllllmdDDo..',
    'ohhhllAAakmhhmo.',
    'ohllllAagkmmmdo.',
    'olddllaggkmdddo.',
    'oDDDhmkkkkdDDDo.',
    '.ohhmdmmmdmhmo..',
    '.ohmdDhmdDhmdo..',
    '.omddohmdomddo..',
    '.oDDDomddoDDDo..',
    '..ooooDDDoooo...',
    '......ooo.......',
  ],
}

/** Стив и Алекс рядом и зелёный значок микрофона (голосовой чат). */
const FRIENDS_HEADS: PxSprite = {
  pal: {
    o: '#140d08', H: '#2f1f10', h: '#45301a', j: '#5a3e22',
    S: '#c4917a', s: '#a8765f', n: '#8f5a44', m: '#6b3e2b', M: '#4e2b1c', W: '#f4f4f4', B: '#4b3c94',
    A: '#f29a44', a: '#d9782a', q: '#a85418', F: '#f6cba5', f: '#e0ab84', G: '#3e8f4a', p: '#d8826e',
    e: '#4fcf5a', E: '#2f9a3a', w: '#ffffff',
  },
  rows: [
    'oooooooooo......',
    'ojhhjhhhjo......',
    'ohhHhhhHho......',
    'ohSSSSSSho......',
    'oSSSSSSSso......',
    'oSWBSSBWso......',
    'oSSSnnoooooooooo',
    'oSSmMMoAAaAAAaAo',
    'oooooooaAaaaaAqo',
    'oeewweEoaaaFFaqo',
    'oeewweEoFFFFFFqo',
    'owewwewoWGFFGWqo',
    'oeweEwEoFFFFFFqo',
    'oeewwEEoFFppFfqo',
    'oewwwwEofFFFFfqo',
    '.ooooooooooooooo',
  ],
}

export const PX_CHIPS = {
  steve_glow: STEVE_GLOW,
  zombie_bandage: ZOMBIE_BANDAGE,
  create_cog: CREATE_COG,
  friends_heads: FRIENDS_HEADS,
} satisfies Record<string, PxSprite>
