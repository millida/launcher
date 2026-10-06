/*
 * Эмоции и взаимодействия Милли (04.10.2026, владелец: «нарисуй прям много
 * анимированных эмоций и взаимодействий»).
 *
 * Здесь — чистые данные и логика: какие есть эмоции, сколько они длятся,
 * какая эмоция подходит ответу чата (`emotionFor`) и тону игрока
 * (`milliToneOf`), пиксельные картинки лиц и предметов. Рисует и двигает —
 * Milli.tsx + styles/pixel/milli-emotions.css (steps(), transform/opacity).
 *
 * Запуск из любого места (не из .tsx — тот экспортирует только компоненты):
 *   milliEmote('proud')                         — разово, потом прежний режим
 *   const stop = milliEmote('fix', { hold: true }) … stop()  — пока идёт работа
 *   milliEmote(emotionFor({ intent: 'crash', outcome: 'fail' }))
 * Эмоцию можно держать и режимом: <Milli mode="search" /> / useMilli mood.
 */

import { milliCell, milliMirror, MILLI_EYES, type MilliBox } from './milliMascot'

/** Эмоции. `disco` — танец на готовую сборку (`dance` занят старым режимом = happy). */
export const MILLI_EMOTIONS = [
  'joy', // радость
  'starry', // восторг — звёзды в глазах
  'laugh', // смех
  'proud', // гордость
  'surprise', // удивление
  'shock', // шок
  'ponder', // задумчивость
  'idea', // «ага!» — лампочка
  'shy', // смущение — румянец
  'sad', // грусть / сочувствие (вылет)
  'worry', // тревога «ой-ой» (конфликт)
  'grumpy', // шутливая злость
  'yawn', // усталость, зевок
  'sleep', // сон
  'love', // сердечки
  'fix', // работаю — молоток, шестерёнка
  'search', // ищу — лупа
  'save', // сохраняю — сундук
  'rewind', // откатываю — часы назад
  'paint', // настраиваю графику — кисточка и солнце
  'disco', // танец (сборка готова)
  'five', // «пять!»
] as const
export type MilliEmotion = (typeof MILLI_EMOTIONS)[number]

/** Взаимодействия — тоже состояния спрайта, но запускает их сам маскот. */
export const MILLI_ACTS = ['purr', 'dizzy', 'drag', 'wobble', 'flip', 'hi', 'look', 'stretch', 'tap'] as const
export type MilliAct = (typeof MILLI_ACTS)[number]

export type MilliEmoteState = MilliEmotion | MilliAct

/** Чужие имена (Pair A/B) → наши. */
export const MILLI_EMOTE_ALIAS: Readonly<Record<string, MilliEmotion>> = {
  scan: 'search',
  work: 'fix',
  sorry: 'sad',
  worried: 'worry',
  oops: 'worry',
  saving: 'save',
  tuning: 'paint',
  dance: 'disco',
  happy: 'joy',
}

export function milliEmotionName(name: string | null | undefined): MilliEmotion | null {
  if (!name) return null
  if ((MILLI_EMOTIONS as readonly string[]).includes(name)) return name as MilliEmotion
  return MILLI_EMOTE_ALIAS[name] ?? null
}

/**
 * Длина одного цикла CSS (мс) и сколько играть разово. `loop` — цикл
 * повторяется (держится, пока стоит режим или hold); иначе одноразовая,
 * последний кадр держится.
 */
export interface MilliEmoteDef {
  cycle: number
  ms: number
  loop: boolean
}
const d = (cycle: number, ms: number, loop = true): MilliEmoteDef => ({ cycle, ms, loop })
export const MILLI_EMOTE: Readonly<Record<MilliEmoteState, MilliEmoteDef>> = {
  joy: d(800, 1600),
  starry: d(600, 1800),
  laugh: d(400, 1600),
  proud: d(1600, 1600, false),
  surprise: d(900, 900, false),
  shock: d(1200, 1200, false),
  ponder: d(2400, 2400),
  idea: d(1400, 1400, false),
  shy: d(1600, 2400),
  sad: d(2000, 3000),
  worry: d(600, 1800),
  grumpy: d(800, 1600),
  yawn: d(2200, 2200, false),
  sleep: d(4000, 4000),
  love: d(1000, 2400),
  fix: d(800, 2400),
  search: d(1600, 3200),
  save: d(1600, 1600, false),
  rewind: d(1600, 3200),
  paint: d(1200, 2400),
  disco: d(1600, 3200),
  five: d(1000, 1000, false),
  purr: d(1200, 1200),
  dizzy: d(1000, 2000),
  drag: d(600, 600),
  wobble: d(900, 900, false),
  flip: d(700, 700, false),
  hi: d(720, 1440),
  look: d(2400, 2400, false),
  stretch: d(1600, 1600, false),
  tap: d(1600, 1600, false),
}

/* ── Шина: milliEmote из .ts доходит до всех Милли на странице ── */

export interface MilliEmoteOpts {
  /** Сколько играть, мс (по умолчанию — `MILLI_EMOTE[name].ms`). */
  ms?: number
  /** Держать до вызова stop() (для «работаю», «ищу», «сохраняю»…). */
  hold?: boolean
  /** Только маскоты внутри элемента. */
  within?: Element | null
}
type Listener = (name: MilliEmoteState, ms: number, within: Element | undefined, token: number) => void
type Releaser = (token: number) => void
const listeners = new Set<{ play: Listener; stop: Releaser }>()
let tokenSeq = 0

/** Подписка маскота (Milli.tsx). */
export function milliEmoteSubscribe(play: Listener, stop: Releaser): () => void {
  const l = { play, stop }
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * Сыграть эмоцию всем видимым Милли от 32 px. Возвращает stop(): отпустить
 * удержание (или прервать раньше). Неизвестное имя / null — ничего.
 */
export function milliEmote(name: MilliEmoteState | string | null | undefined, opts: MilliEmoteOpts = {}): () => void {
  const n = (MILLI_ACTS as readonly string[]).includes(name ?? '') ? (name as MilliAct) : milliEmotionName(name)
  if (!n || opts.within === null) return () => {}
  const token = ++tokenSeq
  const ms = opts.hold ? Infinity : opts.ms ?? MILLI_EMOTE[n].ms
  for (const l of listeners) l.play(n, ms, opts.within ?? undefined, token)
  return () => {
    for (const l of listeners) l.stop(token)
  }
}

/* ── Что чувствовать в ответ ── */

export type MilliIntent =
  | 'build'
  | 'edit'
  | 'doctor'
  | 'crash'
  | 'update'
  | 'port'
  | 'graphics'
  | 'config'
  | 'import'
  | 'diary'
  | 'backup'
  | 'rollback'
  | 'search'
  | 'chat'
export type MilliOutcome = 'pending' | 'ok' | 'fixed' | 'fail' | 'conflict' | 'crash' | 'none'
export type MilliTone = 'neutral' | 'thanks' | 'love' | 'angry' | 'sad' | 'scared' | 'excited' | 'joke' | 'question' | 'greet'

const PENDING: Partial<Record<MilliIntent, MilliEmotion>> = {
  build: 'ponder',
  edit: 'fix',
  doctor: 'search',
  crash: 'search',
  update: 'fix',
  port: 'fix',
  graphics: 'paint',
  config: 'fix',
  import: 'search',
  diary: 'ponder',
  backup: 'save',
  rollback: 'rewind',
  search: 'search',
}
const DONE: Partial<Record<MilliIntent, MilliEmotion>> = {
  build: 'disco',
  edit: 'joy',
  doctor: 'proud',
  crash: 'proud',
  update: 'proud',
  port: 'proud',
  graphics: 'starry',
  config: 'joy',
  import: 'starry',
  diary: 'idea',
  backup: 'save',
  rollback: 'joy',
  search: 'idea',
}
const BY_TONE: Readonly<Record<MilliTone, MilliEmotion | null>> = {
  neutral: null,
  thanks: 'love',
  love: 'shy',
  angry: 'worry',
  sad: 'sad',
  scared: 'worry',
  excited: 'starry',
  joke: 'laugh',
  question: 'ponder',
  greet: 'joy',
}

/**
 * Эмоция на ответ: исход важнее намерения, тон — когда исхода нет.
 * Вылет → сочувствие, починила → гордость, сборка готова → танец,
 * конфликт → «ой-ой», работа идёт → инструмент по намерению.
 */
export function emotionFor(x: { intent?: MilliIntent | string | null; outcome?: MilliOutcome | null; tone?: MilliTone | null }): MilliEmotion | null {
  const intent = (x.intent ?? 'chat') as MilliIntent
  switch (x.outcome) {
    case 'crash':
      return 'sad'
    case 'fail':
      return intent === 'crash' ? 'sad' : 'worry'
    case 'conflict':
      return 'worry'
    case 'fixed':
      return 'proud'
    case 'pending':
      return PENDING[intent] ?? 'ponder'
    case 'ok':
      return DONE[intent] ?? 'joy'
    default:
      if (intent === 'crash') return 'sad'
      return x.tone ? BY_TONE[x.tone] : null
  }
}

/** Тон сообщения игрока — по словам и знакам, без модели. */
const TONES: [MilliTone, RegExp][] = [
  ['angry', /бесит|ненавиж|задолбал|достал[аи]?\b|тупая|тупой|дура|опять не|ничего не работает|wtf|капец|>:\(|😡|🤬/],
  ['scared', /боюсь|страшно|помогите|спасите|пропал[аи]? (мир|сохран)|удалил(ся|ось)? мир|потерял/],
  ['sad', /грустн|печал|плохо|не получается|не запускается|вылет|краш|крашит|сломал|упал[аоиь]?\b|😢|😭|:\(/],
  ['love', /люблю тебя|обожаю|ты (лучшая|милая|супер)|милашка|❤|<3|💚/],
  ['thanks', /спасиб|благодар|пасиб|спс\b|сенкс|thx|thank/],
  ['joke', /а?ха(ха)+|хах|лол\b|ржу|ору\b|😂|🤣|xd\b/],
  ['excited', /круто|вау|офиге|класс|ура+\b|имба|кайф|топчик|🔥|!!/],
  ['greet', /^(привет|здравствуй|хай|ку|йо|хеллоу|добрый (день|вечер)|доброе утро)/],
  ['question', /\?\s*$|^(как|что|почему|зачем|где|когда|можно|а если|сколько)\b/],
]
export function milliToneOf(text: string): MilliTone {
  const t = text.toLowerCase().replace(/ё/g, 'е').trim()
  if (!t) return 'neutral'
  for (const [tone, rx] of TONES) if (rx.test(t)) return tone
  return 'neutral'
}

/** Сообщение игрока ушло: Милли откликается тоном (null — нейтрально). */
export function milliHear(text: string, within?: Element | null): void {
  const e = emotionFor({ tone: milliToneOf(text) })
  if (e) milliEmote(e, { within })
}

/** Скорость печати: символов в секунду по последним нажатиям → 0 / 1 (спокойно) / 2 (быстро). */
export function milliTypingLevel(times: readonly number[], now: number): 0 | 1 | 2 {
  const recent = times.filter((t) => now - t < 2000)
  if (recent.length < 2) return recent.length ? 1 : 0
  const span = Math.max(250, now - (recent[0] as number))
  return (recent.length / span) * 1000 >= 6 ? 2 : 1
}

/** Тыки подряд (окно 650 мс): 1–3 — обычные, 4–5 — «эй!», 6+ — голова кругом. */
export const MILLI_COMBO_GAP = 650
export function milliComboReaction(combo: number): 'poke' | 'grumpy' | 'dizzy' {
  if (combo >= 6) return 'dizzy'
  if (combo >= 4) return 'grumpy'
  return 'poke'
}

/** Перетаскивание: резинка — не дальше `max` px, шагом в 2 px. */
export function milliDragOffset(d: number, max = 28): number {
  const v = Math.sign(d) * Math.min(max, Math.sqrt(Math.abs(d)) * 3.2)
  return Math.round(v / 2) * 2 || 0
}

/** Поглаживание: сколько раз сменилось направление и сколько пройдено. */
export function milliIsStroke(path: number, turns: number, size: number): boolean {
  return turns >= 2 && path >= Math.max(40, size * 0.9)
}

/** Мелочь в покое: что сделать, если игрок давно ничего не трогал. */
export function milliFidget(idleMs: number, r: number): MilliAct | 'yawn' | null {
  if (idleMs < 8000) return null
  if (idleMs > 30_000 && r < 0.35) return 'yawn'
  return (['look', 'stretch', 'tap'] as const)[Math.min(2, Math.floor(r * 3))] ?? 'look'
}

/* ── Пиксельные картинки ──────────────────────────────────────────────────
 * Символ → класс `mm-c-<символ>` (палитра — milli-emotions.css).
 * K ink, W белый, Y жёлтый, y тёмно-жёлтый, A золото, R красный, D тёмно-красный,
 * B голубой, C стекло, b синий, P розовый, S сталь, s тёмная сталь, M дерево,
 * m тёмное дерево, O оранжевый, G зелёный, V фиолетовый.
 */

const [EL, ER] = MILLI_EYES as [MilliBox, MilliBox]
export const MILLI_EYE_L = EL
export const MILLI_EYE_R = ER
/** Клетка глазной картинки: 10 — глаз 100×124 это 10×12 клеток. */
export const MILLI_EYE_CELL = 10

export const EYE_STAR = [
  'KKKKKKKKKK',
  'KKKKKKKKKK',
  'KKKKYYKKKK',
  'KKKKYYKKKK',
  'KKKYWYYKKK',
  'KYYYYYYYYK',
  'KKYYYYYYKK',
  'KKKYYYYKKK',
  'KKKYYyYKKK',
  'KKYYKKyYKK',
  'KKYKKKKyKK',
  'KKKKKKKKKK',
]
export const EYE_HEART = [
  'KKKKKKKKKK',
  'KKKKKKKKKK',
  'KKRRKKRRKK',
  'KRRRRRRRRK',
  'KRWRRRRRRK',
  'KRWRRRRRRK',
  'KRRRRRRRDK',
  'KKRRRRRDKK',
  'KKKRRRDKKK',
  'KKKKRDKKKK',
  'KKKKKKKKKK',
  'KKKKKKKKKK',
]
/** Шок: белые глаза с точкой. */
export const EYE_BLANK = [
  'KKKKKKKKKK',
  'KWWWWWWWWK',
  'KWWWWWWWWK',
  'KWWWWWWWWK',
  'KWWWWWWWWK',
  'KWWWKKWWWK',
  'KWWWKKWWWK',
  'KWWWWWWWWK',
  'KWWWWWWWWK',
  'KWWWWWWWWK',
  'KWWWWWWWWK',
  'KKKKKKKKKK',
]
/** Голова кругом: квадратная спираль 10×10 (крутится на 90° — пиксель не мылится). */
export const EYE_SPIRAL = [
  'KKKKKKKKKK',
  'KWWWWWWWWK',
  'KKKKKKKKWK',
  'KWWWWWWKWK',
  'KWKKKKWKWK',
  'KWKWWKWKWK',
  'KWKWKKWKWK',
  'KWKWWWWKWK',
  'KWKKKKKKWK',
  'KKKKKKKKKK',
]
/** Веки (ink поверх открытого глаза, левый глаз; правый — зеркало). */
export const LID_HALF = ['KKKKKKKKKK', 'KKKKKKKKKK', 'KKKKKKKKKK', 'KKKKKKKKKK', 'KKKKKKKKKK', 'KKKKKKKKKK']
export const LID_SLEEPY = [...LID_HALF, 'KKKKKKKKKK']
export const LID_ANGRY = ['KKKKKKKKKK', 'KKKKKKKKKK', 'KKKKKKKKKK', 'KKKKKKKKKK', '...KKKKKKK', '.....KKKKK', '.......KKK', '.........K']
export const LID_SAD = ['KKKKKKKKKK', 'KKKKKKKKKK', 'KKKKKKKKKK', 'KKKKKKKKKK', 'KKKKKKK...', 'KKKKK.....', 'KKK.......', 'K.........']

export type MilliEyeKind = 'star' | 'heart' | 'blank' | 'spiral' | 'half' | 'sleepy' | 'angry' | 'sad'
const EYE_ROWS: Record<MilliEyeKind, readonly string[]> = {
  star: EYE_STAR,
  heart: EYE_HEART,
  blank: EYE_BLANK,
  spiral: EYE_SPIRAL,
  half: LID_HALF,
  sleepy: LID_SLEEPY,
  angry: LID_ANGRY,
  sad: LID_SAD,
}
/** Картинка глаза и её левый верхний угол (side −1 — левый глаз). */
export function milliEyeRows(kind: MilliEyeKind, side: -1 | 1): { rows: readonly string[]; x: number; y: number } {
  const base = EYE_ROWS[kind]
  const rows = side > 0 ? milliMirror(base) : base
  const eye = side < 0 ? EL : ER
  const h = rows.length * MILLI_EYE_CELL
  // Полноразмерные — по центру глаза; веки — от верха глаза.
  const lid = kind === 'half' || kind === 'sleepy' || kind === 'angry' || kind === 'sad'
  return { rows, x: eye.x, y: lid ? eye.y : eye.y + (eye.h - h) / 2 }
}

/** Новые рты (клетка 7, как у milliMouth): X — ink, T — язык, W — зубы. */
export const MILLI_MOUTHS_EX = {
  frown: ['.XXXX.', 'X....X'],
  wobble: ['.X..X.', 'X.XX.X'],
  laugh: ['XXXXXX', 'XWWWWX', 'XXXXXX', 'XXTTXX', '.XXXX.'],
  cat: ['X.XX.X', '.X..X.'],
  yawn: ['.XXXX.', 'XXXXXX', 'XXXXXX', 'XTTTTX', '.XXXX.'],
  smug: ['.....X', 'X...X.', '.XXX..'],
  teeth: ['XXXXXX', 'XWWWWX', 'XXXXXX'],
  pout: ['.XX.', 'X..X'],
  blep: ['XXXXX.', '...TT.', '...TT.'],
} as const
export type MilliMouthEx = keyof typeof MILLI_MOUTHS_EX
const BELOW = milliCell(2, 3)
export function milliMouthExBox(kind: MilliMouthEx): MilliBox {
  const rows = MILLI_MOUTHS_EX[kind]
  const w = Math.max(...rows.map((r) => r.length)) * 7
  return { x: BELOW.x + (BELOW.w - w) / 2, y: BELOW.y + 4, w, h: rows.length * 7 }
}

/* Предметы и частицы. */
export const ART_BULB = ['..YYY..', '.YWWYY.', 'YWYYYYY', 'YYYYYYY', 'YYYYYYy', '.YYYYy.', '..yyy..', '..SSS..', '..sss..', '...s...']
export const ART_RAY_H = ['YY']
export const ART_RAY_V = ['Y', 'Y']
export const ART_HAMMER = ['SSSSSSS', 'SWSSSSs', 'sssssss', '...M...', '...M...', '...M...', '...m...', '...m...']
export const ART_GEAR = ['S..S..S', '.SSSSS.', '.SsssS.', 'SSsKsSS', '.SsssS.', '.SSSSS.', 'S..S..S']
export const ART_LENS = ['..SSSS..', '.SCCCCS.', 'SCWWCCCS', 'SCWCCCCS', 'SCCCCCCS', 'SCCCCCCS', '.SCCCCs.', '..sSSs..', '...MM...', '...MM...', '...mm...', '...mm...']
export const ART_CHEST = ['MMMMAMMMM', 'MmmmAmmmM', 'MMMMMMMMM', 'MmmmmmmmM', 'mmmmmmmmm']
export const ART_LID_SHUT = ['.MMMMMMM.', 'MmmmmmmmM']
export const ART_LID_OPEN = ['.mmmmmmm.', 'MMMMMMMMM']
export const ART_CHEST_IN = ['.KKKKKKK.', 'MKKKKKKKM']
export const ART_GEM = ['.G.', 'GWG', '.G.']
export const ART_CLOCK = ['..AAAAA..', '.AWWWWWA.', 'AWWWWWWWA', 'AWWWWWWWA', 'AWWWKWWWA', 'AWWWWWWWA', 'AWWWWWWWA', '.AWWWWWA.', '..AAAAA..']
export const ART_ARROW = ['.BBB.', 'B...B', 'B....', 'BB...', 'BBB..']
export const ART_SUN = ['..Y..Y..', '...YY...', '.YYYYYY.', 'YYYYWYYY', 'YYYYYYYY', '.YYYYYY.', '...YY...', '..Y..Y..']
export const ART_BRUSH = ['.PP.', 'PPPP', 'PPPP', '.SS.', '.MM.', '.MM.', '.MM.', '.mm.']
export const ART_VEIN = ['.R.R.', 'RR.RR', '.....', 'RR.RR', '.R.R.']
export const ART_SWEAT = ['..B.', '.BB.', 'BBCB', 'BBBB', '.BB.']
export const ART_TEAR = ['.B.', 'BCB', '.B.']
export const ART_STAR = ['..Y..', '..Y..', 'YYWYY', '..Y..', '..Y..']
export const ART_BURST = ['Y..Y..Y', '.Y.Y.Y.', '..YWY..', 'YYWWWYY', '..YWY..', '.Y.Y.Y.', 'Y..Y..Y']
export const ART_HA = ['O...O..OOO.', '.O.O..O...O', '..O...OOOOO', '.O.O..O...O', 'O...O.O...O']
export const ART_QUESTION = ['.WWW.', 'W...W', '...W.', '..W..', '.....', '..W..']
export const ART_BLUSH = ['..P..P..P', '.P..P..P.', 'P..P..P..']
export const ART_DISCO = ['RR', 'RR']
export const ART_PUFF_W = ['.WW', 'WWW', 'WWW']
