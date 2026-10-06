/*
 * Случайные события в пустой сцене Милли (04.10.2026, идея владельца): мимо
 * пролетает что-то из Minecraft, Милли следит глазами, тянется и делает «ух
 * ты!». Здесь — чистые данные и выбор события; отрисовка и тайминг —
 * MilliEvents.tsx, траектории — styles/pixel/milli-events.css.
 */

export type MilliEventKind = 'phantom' | 'bee' | 'elytra' | 'pearl' | 'parrot' | 'star' | 'creeper' | 'chicken' | 'dragon'

export interface MilliEventDef {
  /** Длина события — ровно длина его CSS-траектории. */
  ms: number
  /** Когда Милли говорит «ух ты!» — доля от длины. */
  wow: number
  /** Размер пикселя спрайта, px. */
  px: number
  /** Два кадра (взмах крыльев / вспышка); второй может отсутствовать. */
  frames: readonly (readonly string[])[]
  palette: Readonly<Record<string, string>>
  /** Редкое особое событие. */
  rare?: boolean
}

export const MILLI_EVENTS: Readonly<Record<MilliEventKind, MilliEventDef>> = {
  phantom: {
    ms: 4200,
    wow: 0.3,
    px: 3,
    palette: { B: '#5a6a9a', D: '#36406a', G: '#8cff5a' },
    frames: [
      ['B..............B', 'BB............BB', '.BBB........BBB.', '..BBBBDDDDBBBB..', '...BBDGDDGDBB...', '....DDDDDDDD....', '......DDDD......', '.......DD.......'],
      ['................', '................', '................', '..BBBBDDDDBBBB..', '.BBBBDGDDGDBBBB.', 'BBB.DDDDDDDD.BBB', 'BB....DDDD....BB', 'B......DD......B'],
    ],
  },
  bee: {
    ms: 3600,
    wow: 0.35,
    px: 3,
    palette: { W: '#dff4ff', Y: '#f2c13a', K: '#2a1f14' },
    frames: [
      ['...WW..WW.', '...WWW.WWW', 'YYYKKYYKKY', 'YKYKKYYKKY', 'YYYKKYYKKY', 'YYYKKYYKKY', '.K...K....'],
      ['..........', '...WW..WW.', 'YYYKKYYKKY', 'YKYKKYYKKY', 'YYYKKYYKKY', 'YYYKKYYKKY', '.K...K....'],
    ],
  },
  elytra: {
    ms: 2600,
    wow: 0.28,
    px: 3,
    palette: { E: '#a7a7b8', B: '#3b3db5', C: '#2bb3b8', H: '#4a2e19', S: '#d9a07a', K: '#3a2a6a' },
    frames: [
      ['....EEEEEE......', '..EEEEEEEEEE....', 'BBBBCCCCCCCHHHH.', 'BBBBCCCCCCCSSKS.', '..EEEEEEEEEE....', '....EEEEEE......'],
      ['................', '...EEEEEEEE.....', 'BBBBCCCCCCCHHHH.', 'BBBBCCCCCCCSSKS.', '...EEEEEEEE.....', '................'],
    ],
  },
  pearl: {
    ms: 2200,
    wow: 0.22,
    px: 3,
    palette: { P: '#1f7a6b', Q: '#7fe8d0', D: '#0d3d36', V: '#b45cff' },
    frames: [
      ['......', '..PP..', '.PQPP.', '.PPPD.', '..DD..', '......'],
      ['V....V', '..V...', '.V..V.', 'V..V..', '...V.V', '.V....'],
    ],
  },
  parrot: {
    ms: 3800,
    wow: 0.3,
    px: 3,
    palette: { R: '#e23b2e', B: '#2f6fe0', Y: '#f5c542', K: '#1a1a1a', G: '#3cbf4a' },
    frames: [
      ['..BB....', '..BBB.RR', '...RRRKR', '..RRRRRY', '.RRRR...', 'RRG.....', 'G.......'],
      ['........', '......RR', '...RRRKR', '..RRRRRY', '.RBBB...', 'RRGBB...', 'G.......'],
    ],
  },
  star: {
    ms: 1500,
    wow: 0.2,
    px: 3,
    palette: { c: '#6e8fd8', w: '#bcd4ff', W: '#ffffff', Y: '#fff3a0', y: '#ffe46b' },
    frames: [['......ww..y.', 'cccwwwWWWWYy', '......ww..y.']],
  },
  creeper: {
    ms: 4400,
    wow: 0.18,
    px: 4,
    palette: { G: '#4fb83f', g: '#2f8a2a', K: '#0e1a0e', L: '#d8ffd0', l: '#b5f0aa' },
    frames: [
      ['GGgGGGgG', 'GgGGgGGG', 'GKKGGKKG', 'GKKGGKKG', 'GGGKKGGG', 'GGKKKKGG', 'GGKKKKGG', 'GGKGGKGG', 'gGGGgGGG', 'GGgGGGGg'],
      ['LLlLLLlL', 'LlLLlLLL', 'LKKLLKKL', 'LKKLLKKL', 'LLLKKLLL', 'LLKKKKLL', 'LLKKKKLL', 'LLKLLKLL', 'lLLLlLLL', 'LLlLLLLl'],
    ],
  },
  chicken: {
    ms: 3800,
    wow: 0.25,
    px: 3,
    palette: { W: '#f4f4f0', K: '#1a1a1a', O: '#f0a020', R: '#d6302a' },
    frames: [
      ['..WWW...', '.KWWW...', 'OOWWW...', '.RWWWWW.', '..WWWWWW', '..WWWWW.', '...WWW..', '...O.O..'],
      ['..WWW...', '.KWWW.W.', 'OOWWWWWW', '.RWWWWW.', '..WWWWW.', '..WWWWW.', '...WWW..', '...O.O..'],
    ],
  },
  dragon: {
    ms: 5600,
    wow: 0.25,
    px: 4,
    rare: true,
    palette: { D: '#1c1426', P: '#d26bff' },
    frames: [
      ['D..................D', 'DD.......DD.......DD', '.DDD....DDDD....DDD.', '..DDDDDDDDDDDDDDDD..', '...DDDDDPDDPDDDDD...', '........DDDD........', '.........DD.........'],
      ['....................', '....................', '.........DD.........', '...DDDDDDDDDDDDDD...', '.DDDDDDDPDDPDDDDDDD.', 'DDD.....DDDD.....DDD', 'D........DD........D'],
    ],
  },
}

export const MILLI_EVENT_KINDS = Object.keys(MILLI_EVENTS) as MilliEventKind[]
const COMMON = MILLI_EVENT_KINDS.filter((k) => !MILLI_EVENTS[k].rare)
const RARE = MILLI_EVENT_KINDS.filter((k) => MILLI_EVENTS[k].rare)

/** Шанс редкого события. */
export const MILLI_RARE_CHANCE = 0.07

/**
 * Следующее событие: никогда не повторяет предыдущее; редкое — с шансом
 * `MILLI_RARE_CHANCE`. `r1`, `r2` — случайные 0…1.
 */
export function milliPickEvent(prev: MilliEventKind | null, r1: number, r2: number): MilliEventKind {
  if (r2 < MILLI_RARE_CHANCE) {
    const rare = RARE.filter((k) => k !== prev)
    if (rare.length) return rare[Math.min(rare.length - 1, Math.floor(r1 * rare.length))] as MilliEventKind
  }
  const pool = COMMON.filter((k) => k !== prev)
  return pool[Math.min(pool.length - 1, Math.max(0, Math.floor(r1 * pool.length)))] as MilliEventKind
}

/** Пауза до события: первое — через 2,5–4 с после открытия, дальше — 40–90 с. */
export function milliEventDelay(first: boolean, r: number): number {
  return Math.round(first ? 2500 + r * 1500 : 40_000 + r * 50_000)
}

/** Только что печатали — событие откладывается (столько мс после клавиши). */
export const MILLI_EVENT_TYPING_GAP = 4000
