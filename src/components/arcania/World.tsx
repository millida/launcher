import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useT } from '../../i18n'
import { plural } from '../../lib/format'
import { art } from './content'
import { useArcaniaArt } from './useArcaniaArt'
import { KIND_WORDS, REGION, SINGLE, WORLD_POINTS, WORLD_REGIONS, type WorldKind, type WorldPoint } from './world-map'
import './world.css'

/**
 * To keep the launcher light: only the current and neighbouring 800 px frames stay in the DOM,
 * strips use 240 px thumbs, and the tour and strips stop while the section is off screen.
 */

const STEP_MS = 3800
const WORLD = 'world/'

const KIND_ORDER = ['boss', 'dungeon', 'village', 'loot', 'story', 'poi'] as const

// 12x12 pixel sprites: a letter is a palette colour, "." is transparent. The dark outline is part
// of the drawing, so the icons need no backing plate on the map.
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

// One path per colour rather than a rect per pixel: with 81 icons on the map that is far fewer nodes.
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



function placeAt(p: { x: number; y: number }): CSSProperties {
  return { left: `${p.x}%`, top: `${p.y}%` }
}

function Glyph({ kind }: { kind: WorldKind }) {
  return (
    <svg viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden>
      {SPRITE_PATHS[kind].map((p) => (
        <path key={p.fill} fill={p.fill} d={p.d} />
      ))}
    </svg>
  )
}

// Round-robin over regions so two frames in a row never come from one region; bosses and dungeons first.
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
  // The game has more story places than the map marks; the count matches the pack's own site.
  c.story = 11
  return c
})()
const TOTAL = Object.values(COUNTS).reduce((a, b) => a + b, 0)

// One strip: with two or three the section did not fit the launcher window.
const LANES = [TOUR]

export function World() {
  useArcaniaArt()
  const t = useT()
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
        <span className="arc-eyebrow">{t('Мир')}</span>
        <h2>{t('Мир, построенный вручную')}</h2>
        <p>
          {t(
            'Не случайная генерация, а своя карта: каждая деревня, подземелье и логово босса поставлены руками. Сюжет ведёт по ним от первой главы.',
          )}
        </p>
      </header>

      <div className="arc-world-stats">
        <div className="arc-world-total">
          <b>{TOTAL}</b>
          <span>
            <strong>{plural(TOTAL, t('проработанное место'), t('проработанных места'), t('проработанных мест'))}</strong>
            <small>{t('в каждом есть что пройти и что найти')}</small>
          </span>
        </div>
        <ul className="arc-world-legend">
          {KIND_ORDER.filter((k) => COUNTS[k]).map((k) => (
            <li key={k}>
              <span className="arc-world-tile">
                <Glyph kind={k} />
              </span>
              <b>{COUNTS[k]}</b> {plural(COUNTS[k]!, t(KIND_WORDS[k][0]), t(KIND_WORDS[k][1]), t(KIND_WORDS[k][2]))}
            </li>
          ))}
        </ul>
      </div>

      <div className="arc-world-duo">
        <div className="arc-world-stage">
          {TOUR.map((p, i) =>
            near.has(i) ? (
              <div key={p.p} className="arc-world-shot" data-on={i === index} aria-hidden={i !== index}>
                <img src={art(WORLD + 'places/' + p.p)} alt={t(p.t)} decoding="async" draggable={false} />
              </div>
            ) : null,
          )}
          <div className="arc-world-shade" aria-hidden />
          <div key={cur.p} className="arc-world-caption">
            <p className="arc-world-kind" data-boss={cur.k === 'boss'}>
              {t(SINGLE[cur.k])} · {t(REGION[cur.r])}
            </p>
            <p className="arc-world-name">{t(cur.t)}</p>
          </div>
          {auto && visible && <span key={index} className="arc-world-progress" style={{ animationDuration: `${STEP_MS}ms` }} aria-hidden />}
        </div>

        <div className="arc-world-map" aria-label={t('Где на карте')} onPointerLeave={resume}>
          {seen && <img src={art(WORLD + 'map.webp')} alt="" decoding="async" draggable={false} />}
          {WORLD_POINTS.map((p) => {
            const i = TOUR.findIndex((q) => q.t === p.t)
            return (
              <button
                key={p.t}
                type="button"
                className="arc-world-dot arc-world-tile"
                data-on={p.t === cur.t}
                title={t(p.t)}
                aria-label={t(p.t)}
                onPointerEnter={(e) => hoverPick(e, i)}
                onClick={() => pick(i)}
                style={placeAt(p)}
              >
                <Glyph kind={p.k} />
              </button>
            )
          })}
          <span className="arc-world-marker" data-kind={cur.k} style={placeAt(cur)}>
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
                      aria-label={t(p.t)}
                      tabIndex={copy ? -1 : 0}
                    >
                      {seen && <img src={art(WORLD + 'thumbs/' + p.p)} alt="" loading="lazy" decoding="async" draggable={false} />}
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
