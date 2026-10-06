import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, CSSProperties, MouseEvent as ReactMouseEvent, Ref } from 'react'
import { cancelMilli } from '../../state/milli'
import { useTicker } from './motion'
import { PxArt } from './px'
import { PxIcon } from '../PxIcon'
import '../../styles/pixel/milli-globe.css'

/*
 * Кнопка «отправить» и экран «Милли думает» в языке Minecraft (04.10.2026).
 *
 * Кнопка — главная кнопка лаунчера (.btn primary) с пиксельной стрелкой.
 * Наведение — стрелка подпрыгивает; отправка — замах, стрелка улетает вверх
 * со следом, снизу въезжает новая. Пока Милли собирает — красная кнопка
 * «стоп» (блок со ступенчатой фаской и бегущим кольцом); отмена разбивает
 * блок на осколки. Имя файла и компонента остались от первой версии
 * (планета), чтобы не менять подключение в панели.
 *
 * Загрузка мира — сетка 13×13 чанков, как экран генерации мира в игре:
 * чанки идут спиралью от центра, каждый проходит стадии (камень → земля →
 * вспышка → рельеф). Время каждого чанка известно заранее из кривой
 * процента, поэтому сетка — чистый CSS с задержками, без таймеров.
 */

/* ════════════════════════ Общие хуки ════════════════════════ */

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Вкладка/окно скрыты — анимации на паузу. */
function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return hidden
}

/* ════════════════════════ Кнопка «отправить / стоп» ════════════════════════ */

/** Стрелка «вверх» 9×10: наконечник ступенями по 45°, древко в 3 пикселя. */
export const SEND_ARROW: readonly string[] = [
  '....#....',
  '...###...',
  '..#####..',
  '.#######.',
  '#########',
  '...###...',
  '...###...',
  '...###...',
  '...###...',
  '...###...',
]
/** Блок «стоп» 12×12: красный блок со ступенчатыми углами, фаской и белым знаком. */
const STOP: readonly string[] = [
  '..oooooooo..',
  '.ohhhhhhhro.',
  'ohhrrrrrrrdo',
  'ohr######rdo',
  'ohr######rdo',
  'ohr######rdo',
  'ohr######rdo',
  'ohr######rdo',
  'ohr######rdo',
  'orrrrrrrrrdo',
  '.oddddddddo.',
  '..oooooooo..',
]
const STOP_PAL: Record<string, string> = { o: '#2a0606', h: '#ff8a7a', r: '#e2392c', d: '#981d14', '#': '#fff3ef' }

function rowsToRects(rows: readonly string[], pal: Record<string, string>) {
  const out: { x: number; y: number; w: number; c: string }[] = []
  rows.forEach((r, y) => {
    let x = 0
    while (x < r.length) {
      const ch = r[x]!
      let e = x + 1
      while (e < r.length && r[e] === ch) e++
      if (pal[ch]) out.push({ x, y, w: e - x, c: pal[ch] })
      x = e
    }
  })
  return out
}
const ARROW_RECTS = rowsToRects(SEND_ARROW, { '#': 'currentColor' })
const STOP_RECTS = rowsToRects(STOP, STOP_PAL)

/** Кольцо «работаю» вокруг стопа: 12 пикселей по кругу, бежит steps(). */
const ORBIT_DOTS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2
  return { x: Math.round(Math.cos(a) * 16), y: Math.round(Math.sin(a) * 16) }
})

function Arrow({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 9 10" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {ARROW_RECTS.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill="currentColor" />
      ))}
    </svg>
  )
}

export interface MilliSendGlobeHandle {
  /** Проиграть отправку: замах, стрелка улетает вверх, снизу въезжает новая. */
  launch(): void
}

export interface MilliSendGlobeProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'children'> {
  /** Милли собирает: кнопка становится красной «стоп» (всегда активной). */
  pending?: boolean
  /** Отмена запроса; по умолчанию — cancelMilli из стора. */
  onStop?: () => void
  /** Каждое новое ненулевое значение проигрывает отправку (альтернатива ref.launch()). */
  launchKey?: number
  /** Устарело (полёт через панель убран), принимается ради совместимости. */
  target?: () => Element | null
  /** Стрелка улетела (~0,2 с после отправки) — момент для реакции Милли. */
  onLanded?: () => void
  ref?: Ref<MilliSendGlobeHandle>
  'data-track'?: string
}

type Phase = 'idle' | 'windup' | 'gone' | 'pop' | 'break'

const SHARDS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
  '--dx': Math.round(Math.cos((i / 8) * Math.PI * 2 + 0.4) * 20) + 'px',
  '--dy': Math.round(Math.sin((i / 8) * Math.PI * 2 + 0.4) * 16) + 'px',
})) as CSSProperties[]

/**
 * Кнопка отправки Милли: главная кнопка лаунчера с пиксельной стрелкой.
 * Пока Милли собирает — красная «стоп» (type="button", отменяет запрос).
 */
export function MilliSendGlobe({
  pending = false,
  onStop = cancelMilli,
  launchKey,
  target: _target,
  onLanded,
  ref,
  className,
  disabled,
  onClick,
  'aria-label': ariaLabel = 'Отправить',
  'data-track': dataTrack = 'milli_send',
  ...rest
}: MilliSendGlobeProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const timers = useRef<number[]>([])
  const broke = useRef(false)
  const landed = useRef(onLanded)
  landed.current = onLanded

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), [])

  const launch = useCallback(() => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current = []
    if (reducedMotion()) {
      setPhase('idle')
      landed.current?.()
      return
    }
    setPhase('windup')
    later(90, () => setPhase('gone'))
    later(90 + 200, () => {
      landed.current?.()
      setPhase('pop')
    })
    later(90 + 200 + 240, () => setPhase('idle'))
  }, [])

  useImperativeHandle(ref, () => ({ launch }), [launch])

  const seen = useRef(launchKey)
  useEffect(() => {
    if (launchKey && launchKey !== seen.current) launch()
    seen.current = launchKey
  }, [launchKey, launch])

  // Ответ пришёл или запрос отменён — стоп уходит, стрелка въезжает обратно.
  const wasPending = useRef(pending)
  useEffect(() => {
    if (wasPending.current && !pending) {
      const b = broke.current
      broke.current = false
      timers.current.forEach((t) => clearTimeout(t))
      timers.current = []
      setPhase(b ? 'break' : 'pop')
      later(b ? 420 : 240, () => setPhase('idle'))
    }
    wasPending.current = pending
  }, [pending])

  const stop = pending
  const cls =
    'btn md mgl ' +
    (stop ? 'stop is-stop' : 'primary') +
    (phase !== 'idle' ? ' is-' + phase : '') +
    (className ? ' ' + className : '')

  return (
    <button
      {...rest}
      type={stop ? 'button' : 'submit'}
      className={cls}
      aria-label={stop ? 'Остановить' : ariaLabel}
      data-track={stop ? 'milli_cancel' : dataTrack}
      disabled={stop ? false : disabled}
      onClick={(e: ReactMouseEvent<HTMLButtonElement>) => {
        if (stop) {
          e.preventDefault()
          broke.current = true
          onStop()
          return
        }
        onClick?.(e)
      }}
    >
      <span className="mgl-send" aria-hidden="true">
        <span className="mgl-trail">
          <i />
          <i />
          <i />
        </span>
        <Arrow className="mgl-arrow" />
      </span>
      <span className="mgl-stop" aria-hidden="true">
        <svg className="mgl-orbit" viewBox="-24 -24 48 48" shapeRendering="crispEdges" focusable="false">
          {ORBIT_DOTS.map((d, i) => (
            <rect key={i} x={d.x - 1} y={d.y - 1} width={3} height={3} className={'mgl-od mgl-od-' + i} />
          ))}
        </svg>
        <svg className="mgl-block" viewBox="0 0 12 12" shapeRendering="crispEdges" focusable="false">
          {STOP_RECTS.map((r, i) => (
            <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />
          ))}
        </svg>
      </span>
      <span className="mgl-shards" aria-hidden="true">
        {SHARDS.map((st, i) => (
          <i key={i} style={st} />
        ))}
      </span>
    </button>
  )
}

/* ════════════════════════ Загрузка мира ════════════════════════ */

/** Шаги сборки в порядке серверного конвейера и обычный момент каждого. */
export const MILLI_THINK_STEPS: readonly (readonly [number, string])[] = [
  [0, 'Читаю, что ты хочешь…'],
  [4_000, 'Ищу моды на Modrinth…'],
  [11_000, 'Выбираю лучшие под твой запрос…'],
  [20_000, 'Проверяю версии и зависимости…'],
  [32_000, 'Сверяю файлы модов, почти готово…'],
]

export function milliThinkStep(elapsedMs: number): string {
  let s = MILLI_THINK_STEPS[0]![1]
  for (const [at, t] of MILLI_THINK_STEPS) if (elapsedMs >= at) s = t
  return s
}

const PCT_CAP = 95
const TAU = 13_000

/** Процент «генерации»: быстро в начале, к 15 с ~2/3, к 40 с ~90, не выше 95. */
export function milliWorldPercent(elapsedMs: number): number {
  const t = Math.max(0, elapsedMs)
  return PCT_CAP * (1 - Math.exp(-t / TAU))
}

/** Карта мира 13×13 сверху: W/w — вода, s — песок, g/G — трава, t — дерево, p — тропа, r — камень. */
export const WORLD_MAP: readonly string[] = [
  'WWWWwwwwWWWWW',
  'WWwwwsswwwWWW',
  'WwwssggssswWW',
  'WwsgggtgGgswW',
  'wwsgttgGggsww',
  'wsggggpptgGsw',
  'wsgGgppgggtsw',
  'wsggpggttgGsw',
  'wwsgpgGtgggsw',
  'WwsrrggGgssww',
  'WwwsrsssgswWW',
  'WWwwswwssswWW',
  'WWWwwwWwwwWWW',
]
const MAP_N = 13

/** Порядок чанков: квадратная спираль от центра, как в игре. */
export const WORLD_SPIRAL: readonly number[] = (() => {
  const out: number[] = []
  let x = (MAP_N - 1) / 2
  let y = x
  out.push(y * MAP_N + x)
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  let len = 1
  let d = 0
  while (out.length < MAP_N * MAP_N) {
    for (let r = 0; r < 2; r++) {
      const [ddx, ddy] = dirs[d++ % 4]!
      for (let i = 0; i < len; i++) {
        x += ddx!
        y += ddy!
        if (x >= 0 && y >= 0 && x < MAP_N && y < MAP_N) out.push(y * MAP_N + x)
      }
    }
    len++
  }
  return out
})()

const CELLS = MAP_N * MAP_N
/** Сколько длится генерация одного чанка (стадии до готового рельефа). */
export const CHUNK_MS = 900

/** Когда чанк №k (по спирали) готов; Infinity — не успеет до потолка процента. */
export function milliChunkAt(k: number): number {
  const p = ((k + 1) / CELLS) * 100
  if (p >= PCT_CAP) return Infinity
  return -TAU * Math.log(1 - p / PCT_CAP)
}

const CHUNK_AT: readonly number[] = (() => {
  const at = new Array<number>(CELLS)
  WORLD_SPIRAL.forEach((cell, k) => (at[cell] = milliChunkAt(k)))
  return at
})()

/**
 * «Милли думает» как загрузка мира: сетка чанков спиралью, процент и
 * XP-полоска, текущий шаг (aria-live). Сетка анимируется только CSS:
 * задержка каждого чанка — его момент на кривой процента. Вкладка скрыта —
 * пауза, вернулись — сетка встаёт на текущее время. Reduced motion — без
 * движения, готовые чанки просто видны.
 */
export function MilliWorldLoading({
  step,
  elapsedMs,
  title = 'Генерация мира',
  percent,
}: {
  step: string
  elapsedMs: number
  title?: string
  /** Настоящий процент из этапов /progress; нет — кривая по времени. */
  percent?: number | null
}) {
  const hidden = usePageHidden()
  const latest = useRef(elapsedMs)
  latest.current = elapsedMs
  const [epoch, setEpoch] = useState(() => ({ key: 0, offset: elapsedMs }))
  const wasHidden = useRef(hidden)
  useEffect(() => {
    if (wasHidden.current && !hidden) setEpoch((e) => ({ key: e.key + 1, offset: latest.current }))
    wasHidden.current = hidden
  }, [hidden])

  const pct = percent ?? milliWorldPercent(elapsedMs)
  const shown = Math.floor(pct)
  const cells = useMemo(
    () =>
      WORLD_MAP.flatMap((row, y) =>
        [...row].map((ch, x) => {
          const at = CHUNK_AT[y * MAP_N + x]!
          return { ch, at, delay: Number.isFinite(at) ? Math.round(at - CHUNK_MS - epoch.offset) : null }
        }),
      ),
    [epoch],
  )
  return (
    <div className={'mwl' + (hidden ? ' is-paused' : '')}>
      <span className="mwl-map" aria-hidden="true" key={epoch.key}>
        {cells.map((c, i) => (
          <i
            key={i}
            className={'mwl-c t-' + c.ch + (c.delay === null ? '' : ' a') + (c.at <= elapsedMs ? ' on' : '')}
            style={c.delay === null ? undefined : ({ '--d': c.delay + 'ms' } as CSSProperties)}
          />
        ))}
      </span>
      <span className="mwl-side">
        <span className="mwl-head" aria-hidden="true">
          <span className="mwl-title">{title}</span>
          <span className="mwl-pct">
            {shown}
            <small>%</small>
          </span>
        </span>
        <span className="mwl-live" aria-live="polite">
          <span key={step} className="mwl-step">
            {step}
          </span>
        </span>
        <span className="mwl-bar" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
          <i style={{ width: pct.toFixed(1) + '%' }} />
        </span>
      </span>
    </div>
  )
}

/* ════════════════════════ Этапы хода (/progress) ════════════════════════ */

export interface MilliStage {
  key: string
  labelRu: string
  done: number
  total: number
  sample?: string[]
  /** seq последнего события этапа: самый свежий этап — тот, что идёт. */
  at?: number
  found?: number
  checked?: number
}

/** Порядок конвейера сервера и подписи этапов, которых ещё не было. */
export const MILLI_STAGE_ORDER: readonly (readonly [string, string])[] = [
  ['plan', 'Понимаю запрос'],
  ['candidates', 'Ищу моды'],
  ['select', 'Подбираю моды'],
  ['resolve', 'Проверяю версии'],
  ['deps', 'Зависимости'],
  ['conflicts', 'Совместимость'],
  ['extras', 'Шейдеры и паки'],
  ['enrich', 'Описания'],
]

export type MilliStageRow = MilliStage & { state: 'done' | 'run' | 'wait' }

const stageRank = (k: string) => {
  const i = MILLI_STAGE_ORDER.findIndex(([key]) => key === k)
  return i < 0 ? MILLI_STAGE_ORDER.length : i
}

/**
 * Пришедшие этапы → строки ленты в порядке конвейера. Идёт (▸) этап с самым
 * свежим событием; всё раньше него — ✓, позже — · (впереди), включая этапы,
 * что уже мелькнули заранее (сервер шлёт «Подбираю» до поиска).
 */
export function milliStageRows(stages: readonly MilliStage[]): MilliStageRow[] {
  if (!stages.length) return []
  let run = stages[stages.length - 1]!
  for (const st of stages) if ((st.at ?? -1) > (run.at ?? -1)) run = st
  const runRank = stageRank(run.key)
  const rows: MilliStageRow[] = stages.map((st) => {
    const r = stageRank(st.key)
    return { ...st, state: st === run ? 'run' : r < runRank || (r === runRank && st !== run) ? 'done' : 'wait' }
  })
  for (const [key, labelRu] of MILLI_STAGE_ORDER) {
    if (rows.some((r) => r.key === key) || stageRank(key) <= runRank) continue
    rows.push({ key, labelRu, done: 0, total: 0, state: 'wait' })
  }
  return rows.sort((x, y) => stageRank(x.key) - stageRank(y.key))
}

/** Процент хода по этапам: доля пройденных + доля внутри текущего, не выше 97. */
export function milliStagePercent(stages: readonly MilliStage[]): number {
  if (!stages.length) return 0
  const rows = milliStageRows(stages)
  const n = rows.length
  const doneN = rows.filter((r) => r.state === 'done').length
  const run = rows.find((r) => r.state === 'run')
  const inner = run && run.total > 0 ? Math.min(1, run.done / run.total) : 0.3
  return Math.min(97, ((doneN + inner) / n) * 100)
}

/** «найдено 412 · проверено 138»: самые свежие счётчики из событий. */
export function milliTally(stages: readonly MilliStage[]): { found: number | null; checked: number | null } {
  let found: number | null = null
  let checked: number | null = null
  for (const st of stages) {
    if (typeof st.found === 'number') found = Math.max(found ?? 0, st.found)
    if (typeof st.checked === 'number') checked = Math.max(checked ?? 0, st.checked)
  }
  return { found, checked }
}

/** Последние названия из событий (до 5, без повторов) — бегущей строкой. */
export function milliTickerNames(stages: readonly MilliStage[], max = 5): string[] {
  const out: string[] = []
  const byFresh = [...stages].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
  for (const st of byFresh) {
    for (const n of [...(st.sample ?? [])].reverse()) {
      const t = n.trim()
      if (t && !out.includes(t)) out.push(t)
      if (out.length >= max) return out
    }
  }
  return out
}

/**
 * Пузырь «думаю» (DESIGN.md §4.4): шапка со «Стоп», этапы ✓ / ▸ / ·, у идущего —
 * «найдено N · проверено M», полоса из клеток и бегущие названия. Всё из /progress.
 */
/** Число без перерисовки: текст «1 234» пишет хук моушна (rAF, ≤20 обновлений/с). */
function Tick({ value }: { value: number }) {
  return <b ref={useTicker(value)} />
}

export function MilliProgress({ stages, title, onStop }: { stages: readonly MilliStage[]; title: string; onStop?: () => void }) {
  const rows = milliStageRows(stages)
  const { found, checked } = milliTally(stages)
  const names = milliTickerNames(stages)
  const p = milliStagePercent(stages) / 100
  // Всё пройдено и последний этап досчитан — вспышка «левел-апа» на полосе.
  const last = rows[rows.length - 1]
  const finished = !!last && last.state === 'run' && last.total > 0 && last.done >= last.total
  return (
    <div className="mlp">
      <div className="mlp-head">
        <b aria-live="polite">{title}</b>
        {onStop ? (
          <button type="button" className="btn sm ghost mlp-stop" data-track="milli_cancel" data-src="progress" onClick={onStop}>
            Стоп
          </button>
        ) : null}
      </div>
      <ol className="mlp-steps" aria-label="Этапы сборки">
        {rows.map((r) => {
          const now = r.state === 'run'
          const n = now
            ? [found !== null ? ['найдено', found] : null, checked !== null ? ['проверено', checked] : null].filter(Boolean) as [string, number][]
            : []
          return (
            <li key={r.key} className={'mlp-step is-' + (now ? 'now' : r.state)}>
              {now ? (
                // Идёт — пиксельная лампа редстоуна мигает (слои стопкой, CSS моушна).
                <i className="mlp-mark mlm-lamp" aria-hidden="true">
                  <PxArt name="redstone_lamp_off" size={12} />
                  <PxArt name="redstone_lamp_on" size={12} />
                </i>
              ) : (
                <i className="mlp-mark" aria-hidden="true" />
              )}
              <span className="mlp-t">{r.labelRu}</span>
              {n.length ? (
                <span className="mlp-n">
                  {n.map(([w, v], i) => (
                    // Правило 11: иконка и число, слово — только в подсказке.
                    <span key={w} title={w}>
                      {i ? ' · ' : ''}
                      <PxIcon name={w === 'найдено' ? 'search' : 'check'} size={9} /> <Tick value={v} />
                    </span>
                  ))}
                </span>
              ) : now && r.total > 0 ? (
                <span className="mlp-n">
                  <Tick value={r.done} /> из {r.total}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
      <div className={'mlp-bar' + (finished ? ' is-done' : '')} role="progressbar" aria-label="Сборка" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
        <i style={{ '--p': p.toFixed(2) } as CSSProperties} />
      </div>
      {names.length ? (
        <div className="mlp-tick">
          <div className="mlp-tick-in" style={{ '--n': names.length } as CSSProperties}>
            {names.map((n) => (
              <span key={n}>{n}</span>
            ))}
            {names.map((n) => (
              <span key={'2' + n} aria-hidden="true">
                {n}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
