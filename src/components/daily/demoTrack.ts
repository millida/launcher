import type { DailyClaim, DailyStatus, DailyTrackDay, GrantedReward, PendingChest } from '../../lib/rubies'
import { CYCLE_DAYS, seasonCell, todayKey, TRACK_DAYS, type ClaimTarget } from './track'
import { CHEST_NAME } from './rewards'

/**
 * ТОЛЬКО DEV: трек наград по схеме 24.09.2026 для демо-входа (?preview=user,
 * src/lib/demo.ts), витрины preview.html и плитки лобби. Числа — таблица
 * сезона из track.ts (seasonCell), та же, что SEASON_TRACK службы
 * (millida-services, ветка feat/daily-no-items).
 *
 * Вещей в бонусе нет (решение владельца 24.09.2026, 13:43): только осколки и
 * сундуки. Поэтому каталог косметики демо больше не нужен.
 */

/** Раньше подменял имена вещей трека живыми из каталога; вещей в треке нет. */
export function liveItems(_catalog?: unknown): undefined {
  return undefined
}

/** Трек сезона на `days` клеток по таблице. */
export function demoTrack(days = TRACK_DAYS): DailyTrackDay[] {
  return Array.from({ length: days }, (_, i) => ({ day: i + 1, ...seasonCell(i + 1) }))
}

/**
 * Демо-сезон: сколько клеток открыто, что уже забрано и какие сундуки ждут в
 * «Моих сундуках». Живёт в модуле до перезагрузки — так демо-вход и витрина
 * отвечают как служба: забранное остаётся забранным, сундук лежит до открытия.
 */
const demo = { open: 0, claimed: new Set<string>(), chests: [] as PendingChest[], seq: 0 }
const key = (day: number, row: 'free' | 'plus') => day + ':' + row

/** Сундук открыт (демо): убрать из «Моих сундуков». */
export function forgetDemoChest(id: string) {
  demo.chests = demo.chests.filter((c) => c.id !== id)
}

export function demoStatus(opts: {
  /** Не используется: вещей в треке нет. Оставлено ради старых вызовов. */
  items?: unknown
  /** Сколько клеток сезона открыто (дней входа). По умолчанию 4: первая забрана, три ждут. */
  day?: number
  plus?: boolean
  /** Всё открытое уже забрано: ждём следующую клетку. */
  claimed?: boolean
  /** Не используется: вещи двух недель больше нет. */
  have?: number
  /** Сколько дней трека «отдаёт служба»: 28 — новая, меньше — клиент достроит прогнозом. */
  days?: number
  /** Сколько сундуков уже ждёт в «Моих сундуках» (для витрины). */
  chests?: number
}): DailyStatus {
  const open = Math.min(TRACK_DAYS, Math.max(1, opts.day || 4))
  if (demo.open !== open) {
    demo.open = open
    demo.claimed = new Set([key(1, 'free'), key(1, 'plus')])
    demo.chests = []
    // Разные источники и время получения: лента «Моих сундуков» идёт по порядку.
    const tiers = ['COMMON', 'RARE', 'EPIC', 'COMMON', 'LEGEND', 'RARE'] as const
    const sources = ['DAILY', 'playtime:hours10', 'DAILY_PLUS', 'creator', 'playtime:hours250', 'PROMO'] as const
    const n = opts.chests || 0
    for (let i = 0; i < n; i++) {
      const tier = tiers[i % tiers.length]!
      const source = sources[i % sources.length]!
      demo.chests.push({
        id: 'demo-chest-' + ++demo.seq,
        tier,
        source,
        title: CHEST_NAME[tier] + ' сундук',
        createdAt: new Date(Date.now() - (n - i) * 5 * 3_600_000).toISOString(),
        ...(source.startsWith('DAILY') ? { day: 4 + 7 * Math.floor(i / 3) } : {}),
      })
    }
  }
  if (opts.claimed) for (let n = 1; n <= open; n++) demo.claimed.add(key(n, 'free')).add(key(n, 'plus'))
  const plus = !!opts.plus
  const state = (n: number, row: 'free' | 'plus') =>
    row === 'plus' && !plus ? 'locked' : demo.claimed.has(key(n, row)) ? 'claimed' : n <= open ? 'ready' : 'future'
  const track = demoTrack(opts.days ?? TRACK_DAYS).map(
    (d) => ({ ...d, freeState: state(d.day, 'free'), plusState: state(d.day, 'plus') }) as DailyTrackDay,
  )
  const today = todayKey(null)
  const now = track[Math.min(open, track.length) - 1] ?? track[0]!
  const next = new Date((today + 1) * 86_400_000).toISOString()
  const anyReady = track.some((d) => d.freeState === 'ready' || d.plusState === 'ready')
  const chestOf = (d: DailyTrackDay) => (d.free.find((r) => r.kind === 'CHEST') as { tier: 'COMMON' } | undefined)?.tier ?? null
  const week = Math.floor((open - 1) / CYCLE_DAYS) * CYCLE_DAYS
  return {
    claimedToday: !anyReady,
    streak: open,
    cycleDay: ((open - 1) % CYCLE_DAYS) + 1,
    todayRubies: 0,
    todayChest: chestOf(now),
    graceLeft: 1,
    plus,
    plusMultiplier: 1,
    // Старое поле: окно старой схемы рисует трек по нему.
    cycle: demoTrack(TRACK_DAYS)
      .slice(week, week + CYCLE_DAYS)
      .map((t, i) => ({ day: i + 1, rubies: 0, chest: chestOf(t) })),
    track,
    weekItem: null,
    chests: demo.chests.slice(),
    nextAt: next,
    season: {
      id: 'demo-2026-09',
      day: open,
      endsAt: new Date((today - open + 1 + TRACK_DAYS) * 86_400_000).toISOString(),
      nextUnlockAt: next,
    },
  }
}

/**
 * Ответ «Забрать» по сезонной схеме: клетка `{ day, row }`, `'all'` — всё
 * открытое, без цели — старая ручка «забрать сегодня» (обе строки дня).
 * Строка PLUS без подписки — отказ, как 403 у службы. Сундук ложится в
 * «Мои сундуки», а не открывается.
 */
export function demoClaim(status: DailyStatus, balance: number, target?: ClaimTarget | null): DailyClaim {
  const track = status.track || []
  const cells: { day: number; row: 'free' | 'plus' }[] = []
  const ready = (d: DailyTrackDay, row: 'free' | 'plus') => (row === 'free' ? d.freeState : d.plusState) === 'ready'
  if (target === 'all') {
    track.forEach((d) => (['free', 'plus'] as const).forEach((row) => ready(d, row) && cells.push({ day: d.day, row })))
  } else if (target) {
    const d = track[target.day - 1]
    if (target.row === 'plus' && !status.plus) throw new Error('403: строка PLUS — только с подпиской')
    if (d && ready(d, target.row)) cells.push(target)
  } else {
    const d = track.find((t) => ready(t, 'free')) || track[status.cycleDay - 1]
    if (d) (['free', 'plus'] as const).forEach((row) => ready(d, row) && cells.push({ day: d.day, row }))
  }
  const granted: GrantedReward[] = []
  for (const c of cells) {
    const d = track[c.day - 1]!
    for (const r of c.row === 'free' ? d.free : d.plus) {
      if (r.kind === 'CHEST') {
        const chest: PendingChest = {
          id: 'demo-chest-' + ++demo.seq,
          tier: r.tier,
          source: c.row === 'plus' ? 'DAILY_PLUS' : 'DAILY',
          title: CHEST_NAME[r.tier] + ' сундук',
          createdAt: new Date().toISOString(),
          day: c.day,
        }
        demo.chests.push(chest)
        granted.push({ ...r, source: c.row, day: c.day, chestId: chest.id })
      } else granted.push({ ...r, source: c.row, day: c.day })
    }
    demo.claimed.add(key(c.day, c.row))
  }
  const gained = granted.reduce((n, r) => n + (r.kind === 'RUBIES' ? r.amount : 0), 0)
  const done = new Set(cells.map((c) => key(c.day, c.row)))
  const nextTrack = track.map((d) => ({
    ...d,
    freeState: done.has(key(d.day, 'free')) ? ('claimed' as const) : d.freeState,
    plusState: done.has(key(d.day, 'plus')) ? ('claimed' as const) : d.plusState,
  }))
  const anyReady = nextTrack.some((d) => d.freeState === 'ready' || d.plusState === 'ready')
  const lastChest = [...granted].reverse().find((g) => g.chestId)
  return {
    ...status,
    track: nextTrack,
    claimedToday: !anyReady,
    chests: demo.chests.slice(),
    gained,
    chestId: lastChest?.chestId ?? null,
    balance: balance + gained,
    granted,
  }
}
