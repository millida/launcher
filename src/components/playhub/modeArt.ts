/**
 * Плитки режимов «Во что играем» (правка владельца 23.09.2026, 22:47:
 * «плитки: кровать для BedWars, меч для PvP — и с фоном, как в лобби»).
 *
 * Фон — тот же рецепт, что у одобренного фона лобби (lobby/stageArt.ts,
 * paintScene): гладкий радиальный свет от светлого центра к насыщенному
 * краю, как в лобби Brawl Stars, и едва заметный узор пиксельных значков
 * 8×8. У каждого режима свой цвет.
 *
 * Значок режима — пиксель-арт 16×16, нарисованный кодом: строки — пиксели,
 * буква — цвет из палитры значка, '.' — пусто. Тёмный контур добавляется
 * автоматически по краю силуэта. Картинка маленькая (≤18×18), на экране она
 * растягивается целым шагом без сглаживания (image-rendering: pixelated).
 *
 * Всё рисуется один раз на режим и плотность экрана и кэшируется data-URL.
 */

import { MOTIFS, mix } from '../lobby/stageArt'

interface Glyph {
  rows: string[]
  pal: Record<string, string>
}

/** Контур значка — почти чёрный с тёплым оттенком, как у предметов Minecraft. */
const OUTLINE = '#1b1216'

const WOOD = { w: '#a8743f', W: '#7a5028' }

const GLYPHS: Record<string, Glyph> = {
  // Кровать: изголовье, подушка, красное одеяло, ножки.
  bed: {
    rows: [
      'ww..............',
      'wwBBBB..........',
      'wwbbbbLLLLLLLLLL',
      'wwbbbbrrrrrrrrrr',
      'wwrrrrrrrrrrrrrr',
      'wwddddddddddddww',
      'WWWWWWWWWWWWWWWW',
      'WW............WW',
      'WW............WW',
    ],
    pal: { ...WOOD, B: '#ffffff', b: '#d9dee6', L: '#ff6d6d', r: '#dc2a2f', d: '#8e1519' },
  },
  // Меч по диагонали: клинок, гарда, рукоять, навершие.
  sword: {
    rows: [
      '.............aba',
      '............aba.',
      '...........aba..',
      '..........aba...',
      '.........aba....',
      '........aba.....',
      '..g....aba......',
      '..gg..aba.......',
      '...ggaba........',
      '....gga.........',
      '....hggg........',
      '...hh..gg.......',
      '..hh............',
      '.hh.............',
      'pp..............',
      'pp..............',
    ],
    pal: { a: '#9fb3c7', b: '#f2f8ff', g: '#e0a82e', h: '#7a4f28', p: '#e0a82e' },
  },
  // Алмазная кирка.
  pickaxe: {
    rows: [
      '....aaaaaaaa....',
      '..aabbbbbbbbaa..',
      '.abbaaaaaaaabba.',
      '.ba...ahHa...ab.',
      'ba.....hH.....ab',
      'a......hH......a',
      '.......hH.......',
      '.......hH.......',
      '.......hH.......',
      '.......hH.......',
      '.......hH.......',
      '.......hH.......',
      '.......hH.......',
      '.......hH.......',
    ],
    pal: { a: '#27b3a8', b: '#9af3e8', h: '#a8743f', H: '#6f4722' },
  },
  // TNT: красные полосы, белый пояс с надписью, фитиль.
  tnt: {
    rows: [
      '......ss......',
      '.......s......',
      'LLLLLLLLLLLLLL',
      'rrdrrdrrdrrdrr',
      'rrdrrdrrdrrdrr',
      'rrdrrdrrdrrdrr',
      'wwwwwwwwwwwwww',
      'wkkkwkkkwkkkww',
      'wwkwwkwkwwkwww',
      'wwkwwkwkwwkwww',
      'wwwwwwwwwwwwww',
      'rrdrrdrrdrrdrr',
      'rrdrrdrrdrrdrr',
      'rrdrrdrrdrrdrr',
    ],
    pal: { s: '#ffd23f', L: '#ff6b5e', r: '#e0302a', d: '#9c1a16', w: '#f4f1ea', k: '#2a2226' },
  },
  // Сундук с замком.
  chest: {
    rows: [
      'LLLLLLLLLLLLLL',
      'bbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbb',
      'ddddddssdddddd',
      'bbbbbbssbbbbbb',
      'bbbbbbkkbbbbbb',
      'bbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbb',
      'dddddddddddddd',
    ],
    pal: { L: '#dca45a', b: '#a86c2c', d: '#5e3812', s: '#d3d8df', k: '#3a3f47' },
  },
  // Остров в небе с деревом.
  island: {
    rows: [
      '...LLL........',
      '..LlllL.......',
      '..llllll......',
      '...llll.......',
      '....t.........',
      '....t.........',
      'GGGGGGGGGGGGGG',
      'gggggggggggggg',
      'dddddddddddddd',
      '.dddDddddDddd.',
      '..ddddDdddd...',
      '...ddDddd.....',
      '....ddd.......',
      '.....d........',
    ],
    pal: { L: '#7fdc5a', l: '#3f9f2e', t: '#7a4f28', G: '#7ccf4a', g: '#4f9a2c', d: '#8a5a36', D: '#6a4226' },
  },
  // Кубок.
  trophy: {
    rows: [
      '...YYYYYYYYYY...',
      '.yyYYyyyyyyyOyy.',
      'y..YYyyyyyyyO..y',
      'y..YYyyyyyyyO..y',
      '.y.YYyyyyyyyO.y.',
      '..yyYyyyyyyOOy..',
      '....yyyyyyOO....',
      '.....yyyyOO.....',
      '......yyO.......',
      '......yyO.......',
      '.....yyyyO......',
      '....YYYYYYOO....',
      '....yyyyyyOO....',
    ],
    pal: { Y: '#fff2a6', y: '#f5c22e', O: '#b67c0e' },
  },
  // Сердце.
  heart: {
    rows: [
      '.rrr...rrr.',
      'rrWrr.rrrrr',
      'rWrrrrrrrrr',
      'rrrrrrrrrrr',
      'rrrrrrrrrrd',
      '.rrrrrrrrd.',
      '..rrrrrrd..',
      '...rrrrd...',
      '....rrd....',
      '.....d.....',
    ],
    pal: { r: '#e8304c', W: '#ffd0d8', d: '#95142c' },
  },
  // Щит с крестом.
  shield: {
    rows: [
      'ssssssssssss',
      'sbbbbbbbbbbd',
      'sbbbbwwbbbbd',
      'sbbbbwwbbbbd',
      'sbwwwwwwwwbd',
      'sbwwwwwwwwbd',
      'sbbbbwwbbbbd',
      'sbbbbwwbbbbd',
      '.sbbbwwbbbd.',
      '.sbbbbbbbbd.',
      '..sbbbbbbd..',
      '...sbbbbd...',
      '....sddd....',
    ],
    pal: { s: '#e2e7ec', d: '#7d858f', b: '#2f6fd0', w: '#f2f5f8' },
  },
  // Решётка.
  bars: {
    rows: [
      'dddddddddddddd',
      'Ls..Ls..Ls..Ls',
      'Ls..Ls..Ls..Ls',
      'Ls..Ls..Ls..Ls',
      'Ls..Ls..Ls..Ls',
      'dddddddddddddd',
      'Ls..Ls..Ls..Ls',
      'Ls..Ls..Ls..Ls',
      'Ls..Ls..Ls..Ls',
      'Ls..Ls..Ls..Ls',
      'Ls..Ls..Ls..Ls',
      'dddddddddddddd',
    ],
    pal: { L: '#e6eaef', s: '#9aa3ad', d: '#646d78' },
  },
  // Флаг клана.
  flag: {
    rows: [
      'pp...........',
      'ppBBBBBBBBBB.',
      'ppbbbbbbbbbbB',
      'ppbbbbwwbbbbB',
      'ppbbbwwwwbbbB',
      'ppbbbbwwbbbbB',
      'ppbbbbbbbbbB.',
      'ppbbbbbbbbB..',
      'ppbbbbbbbB...',
      'pp...........',
      'pp...........',
      'pp...........',
      'pp...........',
      'PP...........',
    ],
    pal: { p: '#c9ced6', P: '#7d858f', B: '#1f3fa6', b: '#3a62e0', w: '#ffd23f' },
  },
  // Зелье.
  potion: {
    rows: [
      '....cccc....',
      '....cccc....',
      '.....gg.....',
      '.....gg.....',
      '...gggggg...',
      '..gpppppPg..',
      '.gpWpppppPg.',
      '.gpWpppppPg.',
      '.gppppppPPg.',
      '.gpppppPPPg.',
      '..gpppPPPg..',
      '...gggggg...',
    ],
    pal: { c: '#a8743f', g: '#d6ecf7', p: '#d93fc6', P: '#8f1f86', W: '#ffffff' },
  },
  // Череп.
  skull: {
    rows: [
      '..wwwwwwww..',
      '.wwwwwwwwwS.',
      'wwwwwwwwwwwS',
      'wwwwwwwwwwwS',
      'wwkkkwwkkkwS',
      'wwkkkwwkkkwS',
      'wwwwwkkwwwwS',
      '.wwwwwwwwwS.',
      '..wkwkwkwS..',
      '..wwwwwwwS..',
    ],
    pal: { w: '#efe9d8', S: '#b8b09c', k: '#2a2226' },
  },
  // Четыре цветных блока.
  blocks: {
    rows: [
      'RRRRRR.BBBBBB',
      'Rrrrrr.Bbbbbb',
      'Rrrrrr.Bbbbbb',
      'Rrrrrr.Bbbbbb',
      'Rrrrrr.Bbbbbb',
      'Rrrrrr.Bbbbbb',
      '.............',
      'YYYYYY.GGGGGG',
      'Yyyyyy.Gggggg',
      'Yyyyyy.Gggggg',
      'Yyyyyy.Gggggg',
      'Yyyyyy.Gggggg',
      'Yyyyyy.Gggggg',
    ],
    pal: {
      R: '#ff8a80', r: '#e53935', B: '#8ec5ff', b: '#1e7be0',
      Y: '#fff08a', y: '#f5c400', G: '#9be07a', g: '#3fa92e',
    },
  },
  // Ботинок.
  boot: {
    rows: [
      '..LLLLL.....',
      '..bbbbb.....',
      '..bbbbb.....',
      '..bbbbb.....',
      '..bbbbb.....',
      '..bbbbbb....',
      '..bbbbbbbb..',
      '.bbbbbbbbbbb',
      '.bbbbbbbbbbb',
      '.sssssssssss',
    ],
    pal: { L: '#d19a5c', b: '#9a6232', s: '#3b2a1a' },
  },
  // Лаки-блок со знаком вопроса.
  lucky: {
    rows: [
      'LLLLLLLLLLLL',
      'yyyyyyyyyyyy',
      'yyyykkkkyyyy',
      'yyykkyykkyyy',
      'yyyyyyykkyyy',
      'yyyyyykkyyyy',
      'yyyyykkyyyyy',
      'yyyyykkyyyyy',
      'yyyyyyyyyyyy',
      'yyyyykkyyyyy',
      'yyyyyyyyyyyy',
      'OOOOOOOOOOOO',
    ],
    pal: { L: '#fff2a6', y: '#f5c22e', k: '#7a4a00', O: '#b67c0e' },
  },
  // Блок травы.
  grass: {
    rows: [
      'GGgGGGgGGGgG',
      'gGGgGgGGgGGg',
      'gggGggggGggg',
      'gdgddgdddgdg',
      'dddDddddDddd',
      'dDddddDddddd',
      'ddddDdddddDd',
      'dddddddDdddd',
      'dDddddddddDd',
      'ddddDddDdddd',
      'dddddddddddd',
      'DdddDdddddDd',
    ],
    pal: { G: '#86d352', g: '#56a332', d: '#8f5d38', D: '#6a4226' },
  },
  // Шестерёнка.
  gear: {
    rows: [
      '....gggg....',
      '.gg.gggg.gg.',
      '.gggggggggg.',
      '..gggggggg..',
      'gggggkkggggg',
      'ggggk..kgggg',
      'ggggk..kgggg',
      'gggggkkggggg',
      '..gggggggg..',
      '.gggggggggg.',
      '.gg.gggg.gg.',
      '....gggg....',
    ],
    pal: { g: '#b9c1ca', k: '#6c7580' },
  },
  // Карта с отметкой.
  map: {
    rows: [
      'PPPPPPPPPPPP',
      'PppppppppppP',
      'PpGGpppppppP',
      'PpGGGpppbbpP',
      'PppGppppbbpP',
      'PppprpppppbP',
      'PpppprppppPP',
      'PppppprppppP',
      'PpppprpxpxpP',
      'PppppppxxppP',
      'PpppppxpxppP',
      'PPPPPPPPPPPP',
    ],
    pal: { P: '#b89a5c', p: '#ecdcae', G: '#6fbf45', b: '#4aa3e0', r: '#c0392b', x: '#d62828' },
  },
  // Изумруд.
  emerald: {
    rows: [
      '...EEEE...',
      '..EeeeeE..',
      '.EeWeeeeE.',
      'EeWeeeeeeD',
      'EeeeeeeeeD',
      'EeeeeeeeeD',
      '.EeeeeeeD.',
      '..EeeeeD..',
      '...EDDD...',
    ],
    pal: { E: '#7df0a0', e: '#1fbf5c', W: '#e6fff0', D: '#0d7a36' },
  },
  // Маска.
  mask: {
    rows: [
      '..wwwwwwww..',
      '.wwwwwwwwwS.',
      'wwwwwwwwwwwS',
      'wwkkwwwwkkwS',
      'wwkkwwwwkkwS',
      'wwwwwwwwwwwS',
      'wwkwwwwwwkwS',
      'wwwkkkkkkwwS',
      '.wwwwwwwwwS.',
      '..wwwwwwSS..',
      '....wwSS....',
    ],
    pal: { w: '#ffe3ef', S: '#e0a0bf', k: '#2a2226' },
  },
  // Лук со стрелой.
  bow: {
    rows: [
      's.bb........',
      's..bb.......',
      's...b.......',
      's....b......',
      's....b......',
      'fffaaaaaaaHH',
      'fffaaaaaaaHH',
      's....b......',
      's....b......',
      's...b.......',
      's..bb.......',
      's.bb........',
    ],
    pal: { s: '#f2f5f8', b: '#a8743f', f: '#f2f5f8', a: '#a8743f', H: '#b9c1ca' },
  },
  // Глаз — прятки.
  eye: {
    rows: [
      '....wwwwww....',
      '..wwwwwwwwww..',
      '.wwwwbbbbwwww.',
      'wwwwbbkkWbwwww',
      'wwwwbbkkbbwwww',
      '.wwwwbbbbwwww.',
      '..wwwwwwwwww..',
      '....wwwwww....',
    ],
    pal: { w: '#f4f6f8', b: '#3a8ee0', k: '#1b1216', W: '#ffffff' },
  },
  // Топор.
  axe: {
    rows: [
      '...aaahH',
      '..abbbhH',
      '.abbbbhH',
      'abbbbbhH',
      'abbbbbhH',
      '.abbbbhH',
      '..aaaahH',
      '......hH',
      '......hH',
      '......hH',
      '......hH',
      '......hH',
      '......hH',
      '......hH',
    ],
    pal: { a: '#7d8894', b: '#dde3ea', h: '#a8743f', H: '#6f4722' },
  },
  // Кирпичная кладка — стройка.
  bricks: {
    rows: [
      'LLLLLLLmLLLLLL',
      'bbbbbbbmbbbbbb',
      'bbbbbbbmbbbbbb',
      'mmmmmmmmmmmmmm',
      'bbbmbbbbbbbmbb',
      'bbbmbbbbbbbmbb',
      'mmmmmmmmmmmmmm',
      'bbbbbbbmbbbbbb',
      'bbbbbbbmbbbbbb',
      'mmmmmmmmmmmmmm',
      'bbbmbbbbbbbmbb',
      'dddmdddddddmdd',
    ],
    pal: { L: '#e0785c', b: '#c4513a', d: '#8e3322', m: '#e8dcc8' },
  },
  // Лопата.
  shovel: {
    rows: [
      '.llll.',
      'lbbbbd',
      'lbbbbd',
      'lbbbbd',
      '.bbbd.',
      '..hH..',
      '..hH..',
      '..hH..',
      '..hH..',
      '..hH..',
      '..hH..',
      '..hH..',
      '.hhhH.',
    ],
    pal: { l: '#eef3f7', b: '#c4ccd4', d: '#7d858f', h: '#a8743f', H: '#6f4722' },
  },
  // Яблоко.
  apple: {
    rows: [
      '.....hL.....',
      '......hLL...',
      '..rrr.hrr...',
      '.rWrrrrrrrr.',
      'rWrrrrrrrrrd',
      'rrrrrrrrrrrd',
      'rrrrrrrrrrrd',
      'rrrrrrrrrrdd',
      '.rrrrrrrrdd.',
      '..rrr..rrd..',
    ],
    pal: { h: '#6f4722', L: '#5fbf3a', r: '#e0302a', W: '#ffb3ad', d: '#9c1a16' },
  },
  // Золотое яблоко.
  gapple: {
    rows: [
      '.....hL.....',
      '......hLL...',
      '..rrr.hrr...',
      '.rWrrrrrrrr.',
      'rWrrrrrrrrrd',
      'rrrrrrrrrrrd',
      'rrrrrrrrrrrd',
      'rrrrrrrrrrdd',
      '.rrrrrrrrdd.',
      '..rrr..rrd..',
    ],
    pal: { h: '#6f4722', L: '#5fbf3a', r: '#f5c22e', W: '#fff6c4', d: '#b67c0e' },
  },
  // Дом.
  house: {
    rows: [
      '.....rR.....',
      '....rrRR....',
      '...rrrRRR...',
      '..rrrrRRRR..',
      '.rrrrrRRRRR.',
      'rrrrrrRRRRRR',
      '.wwwwwwwwww.',
      '.wkkwwwwddw.',
      '.wkkwwwwddw.',
      '.wwwwwwwddw.',
      '.wwwwwwwddw.',
    ],
    pal: { r: '#d9443a', R: '#9c2a22', w: '#ecdcae', k: '#4aa3e0', d: '#7a4f28' },
  },
  // Алмаз — запасной значок.
  diamond: {
    rows: [
      '...cccc...',
      '.ccwwcccc.',
      'cwwcccccCC',
      'cwcccccccC',
      '.cccccccC.',
      '..ccccCC..',
      '...cccC...',
      '....cC....',
    ],
    pal: { c: '#3fd8e0', w: '#dffcff', C: '#1a8f9a' },
  },
}

/** Цвет и значок режима. Неизвестный код — запасной вид по порядку. */
const LOOK: Record<string, { color: string; glyph: keyof typeof GLYPHS }> = {
  BEDWARS: { color: '#d8262b', glyph: 'bed' },
  PVP: { color: '#f07a18', glyph: 'sword' },
  SURVIVAL: { color: '#3aa83a', glyph: 'pickaxe' },
  ANARCHY: { color: '#7a3fd0', glyph: 'tnt' },
  GRIEF: { color: '#9a1f2a', glyph: 'chest' },
  SKYBLOCK: { color: '#2aa2e6', glyph: 'island' },
  MINIGAMES: { color: '#eab308', glyph: 'trophy' },
  ROLEPLAY: { color: '#e8479a', glyph: 'mask' },
  SKYWARS: { color: '#16a9b5', glyph: 'bow' },
  ONEBLOCK: { color: '#5fa832', glyph: 'grass' },
  LIFESTEAL: { color: '#c81e4f', glyph: 'heart' },
  BOXPVP: { color: '#2f62d8', glyph: 'shield' },
  PRISON: { color: '#56657a', glyph: 'bars' },
  FACTIONS: { color: '#4b4fd6', glyph: 'flag' },
  MMORPG: { color: '#a53ad0', glyph: 'potion' },
  HARDCORE: { color: '#3d2b5c', glyph: 'skull' },
  CREATIVE: { color: '#13a98a', glyph: 'blocks' },
  PARKOUR: { color: '#72b81c', glyph: 'boot' },
  LUCKY: { color: '#d99a00', glyph: 'lucky' },
  VANILLA: { color: '#2f9a55', glyph: 'grass' },
  TECHNIC: { color: '#3b7ea6', glyph: 'gear' },
  ADVENTURE: { color: '#c0752a', glyph: 'map' },
  ECONOMY: { color: '#0f9e6a', glyph: 'emerald' },
  MODDED: { color: '#6d5acf', glyph: 'gear' },
  RP: { color: '#e8479a', glyph: 'mask' },
  HIDE_SEEK: { color: '#3f8fd8', glyph: 'eye' },
  KITPVP: { color: '#b8471c', glyph: 'axe' },
  BUILD_BATTLE: { color: '#d9632e', glyph: 'bricks' },
  TECHNICAL: { color: '#3b7ea6', glyph: 'gear' },
  SPLEEF: { color: '#5fb3d9', glyph: 'shovel' },
  UHC: { color: '#c28a00', glyph: 'gapple' },
  TNTRUN: { color: '#e24a2a', glyph: 'tnt' },
  HUNGER_GAMES: { color: '#6b8f1f', glyph: 'apple' },
  TOWNY: { color: '#b0673a', glyph: 'house' },
}
const SPARE: string[] = ['#3b7ea6', '#c0752a', '#6d5acf', '#0f9e6a', '#b0417a']

export function modeLook(cat: string, i = 0): { color: string; glyph: string } {
  return LOOK[cat] || { color: SPARE[i % SPARE.length]!, glyph: 'diamond' }
}

function dpr() {
  return Math.min(2, Math.max(1, Math.round(window.devicePixelRatio || 1)))
}

const bgCache = new Map<string, string>()

/** Фон плитки: свет лобби в цвете режима и узор значков. Размер — в css px. */
export function modeBackground(color: string, size = 240): string {
  const d = dpr()
  const key = color + '|' + size + '|' + d
  const hit = bgCache.get(key)
  if (hit) return hit
  const S = size * d
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const g = c.getContext('2d')
  if (!g) return ''
  // Brawl Ball: центр — светлый оттенок цвета (не белый), края — сам цвет
  // и чуть глубже. Свет чуть выше середины — за значком.
  const cx = S / 2
  const cy = S * 0.42
  const rg = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.74)
  // Воронка (правка владельца 24.09.2026, 07:29): самый светлый — центр за
  // предметом, дальше всё темнее к краям, чтобы предмет выделялся.
  rg.addColorStop(0, mix(color, '#ffffff', 0.32))
  rg.addColorStop(0.16, mix(color, '#ffffff', 0.12))
  rg.addColorStop(0.36, color)
  rg.addColorStop(0.62, mix(color, '#000000', 0.45))
  rg.addColorStop(1, mix(color, '#000000', 0.72))
  g.fillStyle = rg
  g.fillRect(0, 0, S, S)

  // Узор значков лобби, мельче: значок 8×8 по 3 px, шаг 58 px.
  const px = 3 * d
  const step = 58 * d
  let k = 0
  for (let row = 0, y = step * 0.3; y < S + step; y += step * 0.75, row++) {
    const shift = row % 2 ? step / 2 : 0
    for (let x = step * 0.25 - shift; x < S + step; x += step) {
      const n = k++
      const m = MOTIFS[n % MOTIFS.length]!
      g.fillStyle = 'rgba(255,255,255,' + (0.06 + ((n * 7) % 3) * 0.02).toFixed(3) + ')'
      const ox = Math.round(x - 4 * px)
      const oy = Math.round(y - 4 * px)
      for (let j = 0; j < 8; j++)
        for (let i = 0; i < 8; i++) if (m[j]![i] === '#') g.fillRect(ox + i * px, oy + j * px, px, px)
    }
  }

  // Низ под подписью темнее — название читается на любом цвете.
  const bot = g.createLinearGradient(0, S * 0.62, 0, S)
  bot.addColorStop(0, 'rgba(0,0,0,0)')
  bot.addColorStop(1, 'rgba(0,0,0,0.42)')
  g.fillStyle = bot
  g.fillRect(0, S * 0.62, S, S * 0.38)

  const url = c.toDataURL('image/jpeg', 0.92)
  bgCache.set(key, url)
  return url
}

const iconCache = new Map<string, { url: string; w: number; h: number }>()

/**
 * Значок режима в родном размере: силуэт с контуром 1 px, пустые края
 * обрезаны. Возвращает data-URL и размер в пикселях значка.
 */
export function modeIcon(glyph: string): { url: string; w: number; h: number } {
  const hit = iconCache.get(glyph)
  if (hit) return hit
  const c = glyphCanvas(glyph)
  const out = { url: c.toDataURL('image/png'), w: c.width, h: c.height }
  iconCache.set(glyph, out)
  return out
}

/** Значок режима холстом в родном размере — для сцен iso/scene.ts. */
export function glyphCanvas(glyph: string): HTMLCanvasElement {
  const gl = GLYPHS[glyph] || GLYPHS.diamond!
  const width = Math.max(...gl.rows.map((r) => r.length))
  const rows = gl.rows.map((r) => r.padEnd(width, '.'))
  let x0 = width
  let x1 = -1
  let y0 = rows.length
  let y1 = -1
  rows.forEach((r, y) => {
    for (let x = 0; x < width; x++)
      if (r[x] !== '.') {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
  })
  const w = x1 - x0 + 3
  const h = y1 - y0 + 3
  const at = (x: number, y: number) => {
    const r = rows[y + y0 - 1]
    const ch = r ? r[x + x0 - 1] : undefined
    return ch && ch !== '.' ? ch : null
  }
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')
  if (!g) return c
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = at(x, y)
      if (ch) {
        g.fillStyle = gl.pal[ch] || OUTLINE
        g.fillRect(x, y, 1, 1)
      } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
        g.fillStyle = OUTLINE
        g.fillRect(x, y, 1, 1)
      }
    }
  return c
}

/** Целый шаг пикселя значка: самая длинная сторона ≈ target css px. */
export function iconScale(w: number, h: number, target = 84): number {
  return Math.max(2, Math.floor(target / Math.max(w, h)))
}
