/**
 * Предметы стартовых подсказок, часть Б: RPG, FPS, магия, улучшенная ванилла.
 * Одно семейство с pxChips.ts. Формат — pxTypes.ts.
 */
import type { PxSprite } from './pxTypes'

/** Незеритовый меч с блеском поверх щита. */
const RPG_SWORD_SHIELD: PxSprite = {
  pal: {
    // меч: незерит (контур, светлая кромка, тело, тень), рукоять
    o: '#1a1220', E: '#e4dbea', L: '#9a8ca5', D: '#625570', G: '#a597ae', g: '#5b4f64', h: '#7a5538', H: '#4f3322',
    // щит: железный обод, доски, умбон
    k: '#2a2530', I: '#f0f0ec', i: '#b8b8c0', j: '#7c7c88', U: '#ffffff', P: '#d9a463', p: '#b07a3e', q: '#7a4f26',
  },
  rows: [
    '.............oo.',
    '...kkkkkkkkkoELo',
    '...kIIIIIIIoELDo',
    '...kIPpqPpoELDok',
    '...kIPpqPoELDojk',
    '..okIPpqoELDopjk',
    '.oGoIPpoELDoppjk',
    '.ogGoPoELDoPppjk',
    '..ogGoELDoIippjk',
    '...ogGLDoIUIjpjk',
    '...kogGoPiIijpjk',
    '...ohogGopjjppjk',
    '..ohHoogGoqPppjk',
    '.ohHoIpoopqPpjk.',
    'oGgo.kIjjjjjjk..',
    'ogo...kkkkkkk...',
  ],
  glint: 'ELDGghH',
}

/** Факел из красного камня и молния — «быстрее». */
const FPS_TORCH: PxSprite = {
  pal: {
    o: '#5a3300', W: '#fffbe0', Y: '#ffd83a', y: '#f0a818',
    k: '#3a0705', R: '#a8100a', r: '#e8261a', f: '#ff6a3d', c: '#ffe0c8', s: '#b0844e', S: '#6e4e2a',
  },
  rows: [
    '..........ooooo.',
    '.........oWWWWWo',
    '.r.......oWYYYyo',
    '........oWYYYyo.',
    '.kkkk...oWYYYyo.',
    'krffr..oWYYYyo..',
    'kfccrk.oWYYYyoo.',
    'krcfRkoWYYYYYWWo',
    'kRrRRkoWyyYYYYyo',
    '.ksSk..oooWYYyo.',
    '.ksSk...oWYYyo..',
    '.ksSk...oWYYyo..',
    '.ksSk..oWYYyo...',
    '.ksSk..oWyyo....',
    '.ksSk.oWyoo.....',
    '.kkkk..oo.......',
  ],
}

/** Книга заклинаний (в духе Iron's Spells): кожа, золотые уголки, фиолетовый камень. */
const SPELLBOOK: PxSprite = {
  pal: {
    o: '#1c0f10', S: '#3e1a1d', s: '#5a2629', C: '#7a3530', c: '#62282a', L: '#94473a',
    G: '#ffd866', g: '#d9a033', P: '#f3e9cc', p: '#c9b98f',
    W: '#fbe6ff', V: '#d48cff', v: '#a24ee6', u: '#6a23b0', r: '#b06cd0',
  },
  rows: [
    'ooooooooooooo...',
    'oSsLLLLLLLGGoo..',
    'oSsLCCCrCCCGoPPo',
    'oGgLCCCCCCCCoPpo',
    'oSsLrCCGCCrCoPpo',
    'oSsLCCGWGCCCoPpo',
    'oSsLCGWVvGCcoPpo',
    'oSsLrGVvuGrcoPpo',
    'oSsLCGvuugCcoPpo',
    'oSsLCCgugCCcoPpo',
    'oSsLrCCgCCrcoPpo',
    'oSsLCCCCCCCcoPpo',
    'oGgLCCCrCCccoPpo',
    'oSsCcccccccGoPPo',
    'oSscccccccGGoooo',
    'ooooooooooooo...',
  ],
  glint: 'WVvur',
}

/** Блок травы в изометрии с одуванчиком. */
const GRASS_DANDELION: PxSprite = {
  pal: {
    // верх травы (самая светлая грань), бахрома на боках, земля слева/справа
    o: '#1f3312', b: '#2e1d10', h: '#b6e870', G: '#8fd24e', g: '#74b83e',
    v: '#4e8a2a', V: '#37661f', r: '#9b6a45', R: '#7a5134', s: '#b88a62', e: '#734d2e', E: '#583a22', t: '#8a6240',
    // одуванчик: контур, блик, жёлтый, тень, стебель и листья
    O: '#7a4a06', W: '#fff6a8', Y: '#ffd52e', y: '#e8a313', z: '#2b6119', l: '#3f8a26',
  },
  rows: [
    '......OOOO......',
    '....oOWYYyOo....',
    '..oohOYYyyOGoo..',
    'oohhGGOyyOGGGGoo',
    'ovGGGGGzggGGgGVo',
    'ovvvGlzzzlgGVVVo',
    'bvvvvvGggGVVVVeb',
    'brrvvvvvVVVVeVeb',
    'brsrvrvvVVVeEeeb',
    'bRrrrRrreVeeeteb',
    'brrrrsrrteeeEeeb',
    'brRrrrsreeEeeteb',
    'bbrrRrrreEeeEebb',
    '..bbrsrReetebb..',
    '....bbrReEbb....',
    '......bbbb......',
  ],
}

export const PX_CHIPS_B = {
  rpg_sword_shield: RPG_SWORD_SHIELD,
  fps_torch: FPS_TORCH,
  spellbook: SPELLBOOK,
  grass_dandelion: GRASS_DANDELION,
} satisfies Record<string, PxSprite>
