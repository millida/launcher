/**
 * Значки карточки сборки: моды (верстак), ресурс-паки (картина), шейдеры
 * (светокамень), скачивания (воронка). Формат — pxTypes.ts.
 */
import type { PxSprite } from './pxTypes'

// Верстак (моды): изометрический блок, сверху сетка, спереди пила и молоток
const craftingTable: PxSprite = {
  pal: {
    o: '#3b2412',
    B: '#e2b878',
    W: '#f2d49a',
    G: '#7a4e28',
    K: '#5e3a1c',
    H: '#c08c52',
    P: '#a87745',
    p: '#8c5f34',
    h: '#4a2c14',
    S: '#c8c8c6',
    s: '#86868e',
    M: '#a2a2aa',
    k: '#4a2e16',
    Q: '#7e552d',
    q: '#664425',
  },
  rows: [
    '......oooo......',
    '....ooWBBBoo....',
    '..ooGGWBBBGGoo..',
    'ooWBBBGGGGWBBBoo',
    'oKBBBBGGGGBBBBko',
    'oHKKGGWBBBGGkkQo',
    'oPHHKKBBBBkkQQQo',
    'oPhhHHKKkkQQQQqo',
    'oPSSPMHHQQqQqqQo',
    'oPSSPMMMQQqqQqQo',
    'oPSsPPsMqqQQQqqo',
    'opSsPPhPQQQQqqQo',
    'ooppPPhPQQqqQQoo',
    '..oopphPqqQQoo..',
    '....ooppQqoo....',
    '......oooo......',
  ],
}

// Светокамень (шейдеры): изометрический блок из тёплых светящихся ячеек
const glowstone: PxSprite = {
  pal: {
    o: '#4a2a0c',
    C: '#fff6d0',
    Y: '#ffe28a',
    g: '#d8963c',
    c: '#ffd878',
    U: '#eeb048',
    h: '#9a5a22',
    e: '#e0a448',
    V: '#c47a2a',
    j: '#6e3c14',
  },
  rows: [
    '......oooo......',
    '....ooCCYYoo....',
    '..ooYCCYgYCYoo..',
    'oogYYgCCYgYCCgoo',
    'ocYCgYCYYgYYgYjo',
    'ocUUgYYgCCgYeVeo',
    'ohUhhcYCYgjeVVjo',
    'oUhUhUUUVVjjVjVo',
    'oUcccUcUeVVejjeo',
    'ohcUUhhhjjeVVeVo',
    'ochhhUhUVeVjeVjo',
    'oUUhUccceVjVVjjo',
    'ooUhhUcUjjjjVVoo',
    '..oocUhheVjeoo..',
    '....ooUhVVoo....',
    '......oooo......',
  ],
}

// Картина (ресурс-паки): деревянная рама, внутри небо, солнце, холмы и дерево
const painting: PxSprite = {
  pal: {
    o: '#3a2210',
    W: '#d49e5e',
    A: '#a8743c',
    F: '#7a4c24',
    k: '#5e3a1c',
    d: '#5a361a',
    s: '#5e9ad8',
    S: '#8cc4f0',
    w: '#f4f8ff',
    Y: '#ffe066',
    y: '#f2b230',
    G: '#6cb84a',
    g: '#3f8a32',
    T: '#2f6e2a',
    t: '#58a03a',
    D: '#1f4e22',
    n: '#5a3a1c',
  },
  rows: [
    'oooooooooooooooo',
    'oWWWWAWWWWWAWWAo',
    'oWddddddddddddFo',
    'oWdsssssssyYYAFo',
    'oWdsswwsssYYyAFo',
    'oWdswwwwSSSSSAFo',
    'oAdSSSSSSStTSAFo',
    'oWdSSSSSStTTTAFo',
    'oWdGGGSSSTTTDAFo',
    'oWdgGGGGSSnSSAFo',
    'oAdggGGGGGnGGAFo',
    'oWdgggggGGGGgAFo',
    'oWdggggggggggAFo',
    'oWAAAAAAAAAAAAFo',
    'oAFFFFFkFFFFFFFo',
    'oooooooooooooooo',
  ],
}

// Воронка (скачивания): широкая железная чаша, сужение и носик вниз
const hopper: PxSprite = {
  pal: {
    o: '#26262b',
    W: '#a8a296',
    L: '#8a8a8c',
    M: '#6e6e72',
    m: '#55555b',
    D: '#3a3a3e',
    k: '#1c1c20',
    K: '#2e2e33',
  },
  rows: [
    'oooooooooooooooo',
    'oWWWWWWWWWWWWWLo',
    'oWkkkkkkkkkkkkMo',
    'oWkKKKKKKKKKKkMo',
    'oWkKKKkkkkKKKkMo',
    'oLLLLLLLLLLLLLMo',
    'oLMMMMMMMMMMMMDo',
    'oLMmmmmmmmmmmmDo',
    'oooLMMMMMMMMDooo',
    '..oLMmmmmmmmDo..',
    '...oLmmmmmmDo...',
    '....oLmmmmDo....',
    '.....oLmmDo.....',
    '.....oLmmDo.....',
    '.....ooDDoo.....',
    '......oooo......',
  ],
}

export const PX_PACK = {
  crafting_table: craftingTable,
  painting,
  glowstone,
  hopper,
} satisfies Record<string, PxSprite>
