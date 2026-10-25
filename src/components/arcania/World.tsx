import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { ART } from './content'
import { WORLD_POINTS, WORLD_REGIONS, type WorldKind, type WorldPoint } from './world-map'
import './world.css'

/**
 * «Мир, построенный вручную» — как на arcania.fun: большой кадр постройки с наездом камеры,
 * рядом карта мира со значками всех мест, под ними ленты миниатюр. Кадры сменяются сами,
 * наведение на место или миниатюру ставит его в кадр.
 *
 * Чтобы не грузить лаунчер: большие кадры (800 px) держатся в DOM только текущий и соседние,
 * в лентах — уменьшенные копии (thumbs, 240 px), карта пережата до 1040 px; пока секции
 * не видно, облёт и ленты стоят.
 */

const STEP_MS = 3800
const WORLD = ART + 'world/'

const KIND_ORDER = ['boss', 'dungeon', 'village', 'loot', 'story', 'poi'] as const

// Значки мест — предметы в духе Minecraft, пиксель-арт 12×12: череп (босс),
// железный меч (подземелье), домик (деревня), сундук (сокровищница), книга
// (сюжет), око Эндера (особое место). Свет сверху-слева, тень снизу-справа,
// тёмная обводка — часть рисунка, поэтому плашка-подложка не нужна.
// Буква — цвет из палитры спрайта, «.» — прозрачно.
type Sprite = { px: readonly string[]; pal: Record<string, string> }

const SPRITES: Record<WorldKind, Sprite> = {
  boss: {
    pal: { k: '#17140f', w: '#ece7da', g: '#b3ac9e', r: '#ff3b30' },
    px: [
      '..kkkkkkkk..',
      '.kwwwwwwwwk.',
      'kwwwwwwwwwgk',
      'kwwwwwwwwwgk',
      'kwkkkwwkkkgk',
      'kwkrkwwkrkgk',
      'kwkkkwwkkkgk',
      'kwwwwkkwwwgk',
      '.kgwwwwwwgk.',
      '..kwkwkwkk..',
      '..kgkgkgkk..',
      '...kkkkkk...',
    ],
  },
  dungeon: {
    pal: { k: '#15171a', s: '#eef3f8', d: '#93a0ad', y: '#e2b64a', h: '#6e4a2a' },
    px: [
      '.........kkk',
      '........kssk',
      '.......kssdk',
      '......kssdk.',
      '.....kssdk..',
      '.kk.kssdk...',
      '.kykksdk....',
      '..kyydk.....',
      '..khkyk.....',
      '.khkkyyk....',
      'khk..kkk....',
      'kk..........',
    ],
  },
  // Дом: скат крыши в два тона, каменная труба, свес-карниз, окно с бликом,
  // дверь с тёмной створкой, тень по правой стене.
  village: {
    pal: {
      k: '#1a120c', r: '#cf5b3e', R: '#8e3624', s: '#9aa0a8',
      w: '#e8cb93', W: '#b48f5a', b: '#a8e2ff', B: '#4f9fd0', h: '#7a4c26', H: '#4c2e14',
    },
    px: [
      '........kkk.',
      '.....kk.ksk.',
      '....krRkksk.',
      '...krrRRRkk.',
      '..krrrRRRRk.',
      '.krrrrRRRRRk',
      'kkkkkkkkkkkk',
      '.kwwwwwwwWk.',
      '.kwbBwwhHWk.',
      '.kwBBwwhHWk.',
      '.kwwwwwhHWk.',
      '.kkkkkkkkkk.',
    ],
  },
  // Сундук как в игре: светлая кромка крышки, тёмный шов, выступающая
  // золотая защёлка, тень по низу и правому краю.
  loot: {
    pal: { k: '#1f1309', l: '#e3a85f', o: '#c98a44', O: '#93602a', d: '#5e3a14', g: '#ffd84a', G: '#b8862a' },
    px: [
      '............',
      '.kkkkkkkkkk.',
      'kllllllllllk',
      'kooooooooOOk',
      'kooooooooOOk',
      'kdddkggkdddk',
      'koookgGkooOk',
      'koookGGkooOk',
      'kooookkoooOk',
      'kooooooooOOk',
      'kOOOOOOOOOOk',
      '.kkkkkkkkkk.',
    ],
  },
  story: {
    pal: { k: '#160c0a', c: '#a8392a', C: '#6c2117', y: '#f0c75a', p: '#f4eedc', P: '#cfc6ad' },
    px: [
      '............',
      '.kkkkkkkkk..',
      'kCccccccccpk',
      'kCcyyyyyycpk',
      'kCccccccccpk',
      'kCccyyyyccpk',
      'kCccccccccpk',
      'kCccccccccPk',
      'kCccccccccPk',
      'kCCCCCCCCCPk',
      '.kkkkkkkkkk.',
      '............',
    ],
  },
  poi: {
    pal: { k: '#0b1513', E: '#5fe0c0', e: '#1f7a64', w: '#ffffff' },
    px: [
      '............',
      '...kkkkkk...',
      '..kEEEEEEk..',
      '.kEEeeeeEEk.',
      'kEEeekkeeEEk',
      'kEeekwkkeeEk',
      'kEeekkkkeeEk',
      'kEEeekkeeEEk',
      '.kEEeeeeEEk.',
      '..kEEEEEEk..',
      '...kkkkkk...',
      '............',
    ],
  },
}

// Один path на цвет (а не rect на пиксель): на карте 81 значок, так узлов в
// десятки раз меньше.
const SPRITE_PATHS = Object.fromEntries(
  Object.entries(SPRITES).map(([kind, { px, pal }]) => {
    const byColor: Record<string, string> = {}
    px.forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c !== '.') byColor[c] = (byColor[c] ?? '') + `M${x} ${y}h1v1h-1z`
      })
    )
    return [kind, Object.entries(byColor).map(([c, d]) => ({ fill: pal[c], d }))]
  })
) as Record<WorldKind, { fill: string; d: string }[]>



function Glyph({ kind }: { kind: WorldKind }) {
  return (
    <svg viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      {SPRITE_PATHS[kind].map((p) => (
        <path key={p.fill} fill={p.fill} d={p.d} />
      ))}
    </svg>
  )
}

const SINGLE: Record<WorldKind, string> = {
  boss: 'Логово босса',
  dungeon: 'Подземелье',
  village: 'Деревня',
  loot: 'Сокровищница',
  story: 'Сюжет',
  poi: 'Место',
}

const REGION: Record<WorldPoint['r'], string> = {
  plains: 'Равнина',
  desert: 'Пустыня',
  savanna: 'Саванна',
  swamp: 'Болото',
  forest: 'Лес',
  sakura: 'Сакура',
  west: 'Западные земли',
  winter: 'Зима',
  volcano: 'Вулкан',
  sea: 'Море',
}

// [одно, два–четыре, пять и больше]
const KIND_WORDS: Record<WorldKind, [string, string, string]> = {
  boss: ['логово босса', 'логова боссов', 'логов боссов'],
  dungeon: ['подземелье', 'подземелья', 'подземелий'],
  village: ['деревня', 'деревни', 'деревень'],
  loot: ['сокровищница', 'сокровищницы', 'сокровищниц'],
  story: ['сюжетное место', 'сюжетных места', 'сюжетных мест'],
  poi: ['особое место', 'особых места', 'особых мест'],
}

function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10
  const m100 = n % 100
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many
}

// Порядок показа: по кругу через земли, чтобы два кадра подряд не были из
// одной земли, и сначала самые эффектные — боссы и подземелья.
function tourOrder(points: WorldPoint[]) {
  const rank = { boss: 0, dungeon: 1, village: 2, story: 3, loot: 4, poi: 5 } as const
  const byRegion = WORLD_REGIONS.map((r) => points.filter((p) => p.r === r.id).sort((a, b) => rank[a.k] - rank[b.k]))
  const out: WorldPoint[] = []
  for (let i = 0; out.length < points.length; i++) for (const list of byRegion) if (list[i]) out.push(list[i])
  return out
}

const TOUR = tourOrder(WORLD_POINTS.filter((p) => p.p))

const COUNTS = (() => {
  const c: Partial<Record<WorldKind, number>> = {}
  for (const p of WORLD_POINTS) c[p.k] = (c[p.k] ?? 0) + 1
  // Сюжетных мест в игре больше, чем отмечено на карте команды — число владельца, как на сайте.
  c.story = 11
  return c
})()
const TOTAL = Object.values(COUNTS).reduce((a, b) => a + b, 0)

// Лента — один ряд: с двумя-тремя секция не помещалась в окно лаунчера.
const LANES = [TOUR]

export function World() {
  const [index, setIndex] = useState(0)
  const [auto, setAuto] = useState(true)
  const [visible, setVisible] = useState(false)
  const [seen, setSeen] = useState(false)
  const rootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([e]) => {
        setVisible(!!e?.isIntersecting)
        if (e?.isIntersecting) setSeen(true)
      },
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!auto || !visible || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setTimeout(() => setIndex((i) => (i + 1) % TOUR.length), STEP_MS)
    return () => clearTimeout(id)
  }, [auto, visible, index])

  const cur = TOUR[index]!
  const pick = (i: number) => {
    if (i < 0) return
    setAuto(false)
    setIndex(i)
  }
  const hoverPick = (e: PointerEvent, i: number) => {
    if (e.pointerType === 'mouse') pick(i)
  }
  const resume = () => setAuto(true)
  const near = useMemo(() => new Set([index, (index + 1) % TOUR.length, (index - 1 + TOUR.length) % TOUR.length]), [index])

  return (
    <section ref={rootRef} className="arc-world" data-idle={!visible || undefined}>
      <header className="arc-world-head">
        <span className="arc-eyebrow">Мир</span>
        <h2>Мир, построенный вручную</h2>
        <p>
          Не случайная генерация, а своя карта: каждая деревня, подземелье и логово босса поставлены руками. Сюжет ведёт по
          ним от первой главы.
        </p>
      </header>

      <div className="arc-world-stats">
        <div className="arc-world-total">
          <b>{TOTAL}</b>
          <span>
            <strong>{plural(TOTAL, ['проработанное место', 'проработанных места', 'проработанных мест'])}</strong>
            <small>в каждом есть что пройти и что найти</small>
          </span>
        </div>
        <ul className="arc-world-legend">
          {KIND_ORDER.filter((k) => COUNTS[k]).map((k) => (
            <li key={k}>
              <span className="arc-world-tile">
                <Glyph kind={k} />
              </span>
              <b>{COUNTS[k]}</b> {plural(COUNTS[k]!, KIND_WORDS[k])}
            </li>
          ))}
        </ul>
      </div>

      <div className="arc-world-duo">
        <div className="arc-world-stage">
          {/* Кадры лежат стопкой и проявляются по очереди; в DOM только текущий и соседи. */}
          {TOUR.map((p, i) =>
            near.has(i) ? (
              <div key={p.p} className="arc-world-shot" data-on={i === index} aria-hidden={i !== index}>
                <img src={WORLD + 'places/' + p.p} alt={p.t} decoding="async" draggable={false} />
              </div>
            ) : null,
          )}
          <div className="arc-world-shade" aria-hidden />
          <div key={cur.p} className="arc-world-caption">
            <p className="arc-world-kind" data-boss={cur.k === 'boss'}>
              {SINGLE[cur.k]} · {REGION[cur.r]}
            </p>
            <p className="arc-world-name">{cur.t}</p>
          </div>
          {auto && visible && <span key={index} className="arc-world-progress" style={{ animationDuration: `${STEP_MS}ms` }} aria-hidden />}
        </div>

        <div className="arc-world-map" aria-label="Где на карте" onPointerLeave={resume}>
          {seen && <img src={WORLD + 'map.webp'} alt="" decoding="async" draggable={false} />}
          {WORLD_POINTS.map((p) => {
            const i = TOUR.findIndex((q) => q.t === p.t)
            return (
              <button
                key={p.t}
                type="button"
                className="arc-world-dot arc-world-tile"
                data-on={p.t === cur.t}
                title={p.t}
                aria-label={p.t}
                onPointerEnter={(e) => hoverPick(e, i)}
                onClick={() => pick(i)}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <Glyph kind={p.k} />
              </button>
            )
          })}
          <span className="arc-world-marker" data-kind={cur.k} style={{ left: `${cur.x}%`, top: `${cur.y}%` }}>
            <span className="arc-world-wave" />
            <span className="arc-world-wave" />
            <span key={cur.t} className="arc-world-tile">
              <Glyph kind={cur.k} />
            </span>
          </span>
        </div>
      </div>

      <div className="arc-world-strip" onPointerLeave={resume}>
        {LANES.map((row, ri) => (
          <div key={ri} className="arc-world-lane" data-dir={ri} style={{ '--n': row.length } as CSSProperties}>
            <div className="arc-world-track">
              {[0, 1].map((copy) =>
                row.map((p) => {
                  const i = TOUR.indexOf(p)
                  return (
                    <button
                      key={`${copy}-${p.p}`}
                      type="button"
                      className="arc-world-thumb"
                      data-on={i === index}
                      onClick={() => pick(i)}
                      onPointerEnter={(e) => hoverPick(e, i)}
                      aria-label={p.t}
                      tabIndex={copy ? -1 : 0}
                    >
                      {seen && <img src={WORLD + 'thumbs/' + p.p} alt="" loading="lazy" decoding="async" draggable={false} />}
                    </button>
                  )
                }),
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
