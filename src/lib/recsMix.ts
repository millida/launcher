/**
 * Смеситель ленты «Рекомендуем» — одна и та же логика на millida.net/katalog и
 * в библиотеке Millida Launcher (оригинал — `src/lib/recs-mix.ts` сайта, правки
 * держать одинаковыми). Разбор приёмов — analysis/2026-09-30_recs-tiktok.md
 * в папке проекта.
 *
 * Что делает, по приёмам ленты «Для тебя»:
 * - эксплуатация — разделы, куда человек ходит, лайкает и что ставит, весят
 *   больше; личная подборка (запросы по истории) идёт первой очередью;
 * - исследование — доля мест (≈30 %) отдана случайным качественным материалам
 *   из разделов, которые человек видит реже всего;
 * - свежесть — зерно случайности «пользователь + день»: у каждого своя лента,
 *   и каждый день она новая; показанное за последние дни и нажатое за две
 *   недели не повторяется, пока есть из чего выбирать;
 * - разнообразие — не больше двух карточек одного раздела подряд и не больше
 *   доли `maxShare` на ленту;
 * - порог качества — у карточки есть обложка или значок и заметное число
 *   скачиваний (проверяет вызывающий, поле `ok`).
 *
 * Здесь только чистые функции: одинаковый вход даёт одинаковый выход.
 */

export interface FeedItem<T> {
  /** `раздел/слаг` — ключ для повторов и журнала показов. */
  key: string
  section: string
  /** Прошла порог качества. */
  ok: boolean
  data: T
}

export type FeedWhy = 'personal' | 'popular' | 'explore'

export interface FeedPick<T> {
  item: FeedItem<T>
  why: FeedWhy
}

export interface MixWeights {
  /** Доля мест под исследование. */
  explore: number
  /** Вероятность взять личное, когда оно есть. */
  personal: number
  /** Спад веса по месту в популярном: больше — ближе к верху списка. */
  decay: number
  /** Степень веса раздела по интересу: 0 — все разделы поровну. */
  affinityPower: number
  /** Доля одного раздела в ленте, не больше. */
  maxShare: number
}

export interface MixInput<T> {
  /** Популярное по разделам, от самого популярного. */
  sections: Record<string, FeedItem<T>[]>
  personal: FeedItem<T>[]
  n: number
  seed: string
  weights: MixWeights
  /** Интерес к разделу, 1 — нейтрально. */
  affinity?: Record<string, number>
  /** Сколько карточек раздела человек видел за последние дни. */
  exposure?: Record<string, number>
  /** Показанное и нажатое недавно — не повторять, пока хватает другого. */
  recent?: Set<string>
  /** Уже стоит на странице (голова ленты). */
  taken?: Set<string>
}

/** Больше двух карточек одного раздела подряд не ставим. */
export const MAX_RUN = 2

/* ---------- детерминированная случайность ---------- */

/** FNV-1a, 32 бита. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: быстрый ГПСЧ с зерном, [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function weighted<T>(list: T[], weight: (x: T) => number, r: number): T | null {
  let sum = 0
  for (const x of list) sum += Math.max(0, weight(x))
  if (sum <= 0) return list[0] ?? null
  let t = r * sum
  for (const x of list) {
    t -= Math.max(0, weight(x))
    if (t < 0) return x
  }
  return list[list.length - 1] ?? null
}

/* ---------- смеситель ---------- */

export function mixFeed<T>(inp: MixInput<T>): FeedPick<T>[] {
  const { weights: w, n } = inp
  const rand = rng(hashStr(inp.seed))
  const recent = inp.recent ?? new Set<string>()
  const used = new Set<string>(inp.taken ?? [])
  const aff = (s: string) => Math.max(0.05, inp.affinity?.[s] ?? 1)

  // Свежее впереди, недавно показанное — в хвосте раздела: оно вернётся, только
  // когда свежего не осталось (лента не пустеет у того, кто листает каждый день).
  const pools: Record<string, FeedItem<T>[]> = {}
  for (const [s, list] of Object.entries(inp.sections)) {
    const ok = list.filter((x) => x.ok)
    pools[s] = [...ok.filter((x) => !recent.has(x.key)), ...ok.filter((x) => recent.has(x.key))]
  }
  const personal = inp.personal.filter((x) => x.ok && !recent.has(x.key))
  const alive = (x: FeedItem<T>) => !used.has(x.key)
  const secs = Object.keys(pools).filter((s) => pools[s]!.length)

  // Недосмотренные разделы: меньше всего интереса и показов — там и исследуем.
  const seen = inp.exposure ?? {}
  const totalSeen = Object.values(seen).reduce((a, b) => a + b, 0) || 1
  const underSeen = [...secs]
    .sort((a, b) => aff(a) + (seen[a] ?? 0) / totalSeen - (aff(b) + (seen[b] ?? 0) / totalSeen) || a.localeCompare(b))
    .slice(0, Math.max(1, Math.ceil(secs.length / 2)))

  const cap = Math.max(MAX_RUN, Math.ceil(n * w.maxShare))
  const count: Record<string, number> = {}
  const out: FeedPick<T>[] = []

  const allowed = (s: string) => {
    if ((count[s] ?? 0) >= cap) return false
    const k = out.length
    return !(k >= MAX_RUN && out.slice(k - MAX_RUN).every((p) => p.item.section === s))
  }
  const fresh = (s: string) => pools[s]!.filter(alive)

  const pickExplore = (): FeedItem<T> | null => {
    const cand = underSeen.filter((s) => allowed(s) && fresh(s).length)
    if (!cand.length) return null
    const list = fresh(cand[Math.floor(rand() * cand.length)]!)
    // Исследуем среди свежего раздела на равных, без веса популярности.
    const unseen = list.filter((x) => !recent.has(x.key))
    const from = unseen.length ? unseen : list
    return from[Math.floor(rand() * from.length)] ?? null
  }
  const pickPersonal = (): FeedItem<T> | null => {
    const cand = personal.filter((x) => alive(x) && allowed(x.section)).slice(0, 3)
    if (!cand.length) return null
    // Три верхних личных на выбор: тот же вход не даёт каждый день одно и то же.
    return cand[Math.floor(rand() * cand.length)] ?? null
  }
  const pickPopular = (): FeedItem<T> | null => {
    const cand = secs.filter((s) => allowed(s) && fresh(s).length)
    if (!cand.length) return null
    const s = weighted(cand, (x) => aff(x) ** w.affinityPower, rand())
    if (!s) return null
    const all = fresh(s)
    const unseen = all.filter((x) => !recent.has(x.key))
    const list = unseen.length ? unseen : all
    return weighted(list, (x) => Math.exp(-w.decay * list.indexOf(x)), rand())
  }

  while (out.length < n) {
    const r = rand()
    const order: [FeedWhy, () => FeedItem<T> | null][] =
      r < w.explore
        ? [['explore', pickExplore], ['popular', pickPopular], ['personal', pickPersonal]]
        : rand() < w.personal
          ? [['personal', pickPersonal], ['popular', pickPopular], ['explore', pickExplore]]
          : [['popular', pickPopular], ['personal', pickPersonal], ['explore', pickExplore]]
    let got: FeedPick<T> | null = null
    for (const [why, pick] of order) {
      const item = pick()
      if (item) {
        got = { item, why }
        break
      }
    }
    if (!got) break
    used.add(got.item.key)
    count[got.item.section] = (count[got.item.section] ?? 0) + 1
    out.push(got)
  }
  return out
}

/* ---------- A/B ---------- */

export type RecsVariant = 'a' | 'b'

/** Эксперимент смешивания: смена имени — новое распределение по группам. */
export const RECS_EXPERIMENT = 'recs_v1'

/**
 * Две группы весов. A — исследование 30 %, как в ТЗ владельца; B — лента
 * «сытнее»: вдвое меньше исследования, личного и любимых разделов больше.
 * Сравниваем по CTR ленты и доле кликов из исследования (analysis/…recs-tiktok.md).
 */
export const RECS_WEIGHTS: Record<RecsVariant, MixWeights> = {
  a: { explore: 0.3, personal: 0.5, decay: 0.12, affinityPower: 1, maxShare: 0.4 },
  b: { explore: 0.15, personal: 0.7, decay: 0.2, affinityPower: 1.6, maxShare: 0.4 },
}

/** Группа стабильна для пары «пользователь + эксперимент». */
export function variantOf(uid: string, exp = RECS_EXPERIMENT): RecsVariant {
  return hashStr(`${exp}:${uid}`) % 2 === 0 ? 'a' : 'b'
}

/** Номер местных суток: лента меняется в полночь по часам человека. */
export function dayIndex(now: Date = new Date()): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000)
}

export const feedSeed = (uid: string, day: number, variant: RecsVariant) => `${uid}:${day}:${variant}`

/* ---------- журнал показов и нажатий ---------- */

export interface RecsLog {
  v: 1
  /** `раздел/слаг` → номер суток последнего показа. */
  seen: Record<string, number>
  /** `раздел/слаг` → номер суток последнего нажатия. */
  clicks: Record<string, number>
}

export const RECS_LOG_KEY = 'mk-recs-log'
export const RECS_UID_KEY = 'mk-recs-uid'
/** Показанное не повторяем три дня, нажатое — две недели. */
export const SEEN_DAYS = 3
export const CLICK_DAYS = 14
const LOG_MAX = 400

export const emptyLog = (): RecsLog => ({ v: 1, seen: {}, clicks: {} })

export function parseLog(raw: string | null | undefined): RecsLog {
  if (!raw) return emptyLog()
  try {
    const d = JSON.parse(raw) as Partial<RecsLog>
    if (d?.v !== 1) return emptyLog()
    const nums = (o: unknown): Record<string, number> => {
      const r: Record<string, number> = {}
      if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (typeof v === 'number' && k.length < 200) r[k] = v
      return r
    }
    return { v: 1, seen: nums(d.seen), clicks: nums(d.clicks) }
  } catch {
    return emptyLog()
  }
}

function prune(o: Record<string, number>, today: number, days: number): Record<string, number> {
  const kept = Object.entries(o)
    .filter(([, d]) => today - d < days)
    .sort((a, b) => b[1] - a[1])
    .slice(0, LOG_MAX)
  return Object.fromEntries(kept)
}

export function logSeen(log: RecsLog, keys: string[], today: number): RecsLog {
  const seen = { ...log.seen }
  for (const k of keys) seen[k] = today
  return { v: 1, seen: prune(seen, today, SEEN_DAYS + 7), clicks: prune(log.clicks, today, CLICK_DAYS) }
}

export function logClick(log: RecsLog, key: string, today: number): RecsLog {
  return { v: 1, seen: log.seen, clicks: prune({ ...log.clicks, [key]: today }, today, CLICK_DAYS) }
}

/** Что не повторять сегодня: показанное за SEEN_DAYS и нажатое за CLICK_DAYS суток. */
export function recentKeys(log: RecsLog, today: number): Set<string> {
  const out = new Set<string>()
  for (const [k, d] of Object.entries(log.seen)) if (today - d < SEEN_DAYS && today !== d) out.add(k)
  for (const [k, d] of Object.entries(log.clicks)) if (today - d < CLICK_DAYS) out.add(k)
  return out
}

/** Показы по разделам за неделю — для выбора недосмотренных. */
export function exposureOf(log: RecsLog, today: number): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, d] of Object.entries(log.seen)) {
    if (today - d >= 7) continue
    const s = k.split('/')[0]!
    out[s] = (out[s] ?? 0) + 1
  }
  return out
}

/**
 * Интерес к разделам: заходы, лайки и установки. Установка — самый сильный
 * сигнал (человек взял материал), лайк — сильнее захода. Нейтрально — 1,
 * любимый раздел — до 5.
 */
export function affinityOf(signals: { visits?: Record<string, number>; likes?: string[]; installs?: Record<string, number> }): Record<string, number> {
  const score: Record<string, number> = {}
  const add = (s: string, v: number) => (score[s] = (score[s] ?? 0) + v)
  for (const [s, v] of Object.entries(signals.visits ?? {})) add(s, v)
  for (const s of signals.likes ?? []) add(s, 3)
  for (const [s, v] of Object.entries(signals.installs ?? {})) add(s, v * 4)
  const total = Object.values(score).reduce((a, b) => a + b, 0)
  if (!total) return {}
  const out: Record<string, number> = {}
  for (const [s, v] of Object.entries(score)) out[s] = 1 + 4 * (v / total)
  return out
}
