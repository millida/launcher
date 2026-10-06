import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { PxArt } from '../px'
import type { MilliOp, MilliPack, MilliProfile, MilliRpStyle } from '../../../lib/milli'
import { benchOp } from '../../../state/milliBench'
import { openPicker } from '../../../state/milliPicker'
import { BenchTabFrame, LookPic, lookOf, resNum, shortName, useHead, useLooks, useModder, usePcTier, type Fit } from './BenchShaders'
import { isRpStyle, requiredTitles, rpTiles, type RpTile } from './benchTabs'
import '../../../styles/pixel/milli-bench-tabs.css'
import '../../../styles/pixel/milli-looks.css'

/** Стили-картинки: 1 слово на плитке. Основные пять всегда, остальные — если уже применены. */
/** Свои пиксельные значки стилей вместо случайных обложек чужих паков. */
const STYLE_PX: Record<string, string> = {
  faithful: 'grass_dandelion',
  fantasy: 'spellbook',
  realistic: 'glowstone_bright',
  cartoon: 'firework_star',
  pvp: 'rpg_sword_shield',
  medieval: 'crafting_table',
  dark: 'steve_glow',
}

const STYLES: readonly { id: MilliRpStyle; ru: string; main: boolean }[] = [
  { id: 'faithful', ru: 'Ванилла+', main: true },
  { id: 'fantasy', ru: 'Фэнтези', main: true },
  { id: 'realistic', ru: 'Реализм', main: true },
  { id: 'cartoon', ru: 'Мульт', main: true },
  { id: 'pvp', ru: 'PvP', main: true },
  { id: 'medieval', ru: 'Рыцари', main: false },
  { id: 'dark', ru: 'Мрак', main: false },
]

/** Разрешение на значке: 16x / 32x / 64x+ (точное — моддеру). */
const resLabel = (n: number) => (n <= 16 ? '16x' : n <= 32 ? '32x' : '64x+')

/** Насколько тянет ПК: слабому — до 16x, среднему — до 32x (64x — пойдёт), мощному — всё до 256x. */
export function resFit(n: number, tier: MilliProfile): Fit {
  if (n <= 16) return 'good'
  if (tier === 'low') return n <= 32 ? 'mid' : 'bad'
  if (tier === 'balanced') return n <= 32 ? 'good' : n <= 64 ? 'mid' : 'bad'
  return n <= 256 ? 'good' : 'mid'
}
const RES_TIP: Record<Fit, string> = {
  good: 'Твой ПК потянет',
  mid: 'Может подтормаживать',
  bad: 'Тяжело для твоего ПК',
}

/** Порядок паков: первый перекрывает остальные. */
const orderOp = (refs: string[]): MilliOp => ({ op: 'order', tab: 'resourcepacks', refs })
const ORDER_READY = true

export function BenchPacks() {
  const head = useHead()
  if (!head) return null
  return (
    <BenchTabFrame tab="resourcepacks">
      <Packs pack={head} />
    </BenchTabFrame>
  )
}

function Packs({ pack }: { pack: MilliPack }) {
  const modder = useModder()
  const tier = usePcTier(pack)
  const [mode, setMode] = useState<'add' | 'replace'>('add')
  const applied = new Set((pack.rpStyles ?? []).map((s) => s.id).filter(isRpStyle))
  // Выбранный стиль: последний нажатый; иначе применённые сервером (если это не просто список всех).
  const [picked, setPicked] = useState<MilliRpStyle | null>(null)
  const isOn = (id: MilliRpStyle) => (picked ? picked === id : applied.size < 4 && applied.has(id))
  const styles = STYLES.filter((s) => s.main)
  const tiles = rpTiles(pack)
  const live = tiles.filter((t) => !t.removed)
  const gone = tiles.filter((t) => t.removed)
  useLooks(tiles.map((t) => ({ slug: t.item.slug ?? '', projectId: t.item.projectId, preview: t.item.preview, res: t.item.res })))

  // Стиль — варианты на выбор прямо в ленте (3–4 пака), сборка меняется только после выбора.
  const style = (id: MilliRpStyle) => {
    setPicked(id)
    openPicker('rp', id, STYLES.find((x) => x.id === id)?.ru ?? id)
  }
  const refOf = (t: RpTile) => t.item.slug || t.item.projectId
  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= live.length) return
    const refs = live.map(refOf)
    const [x] = refs.splice(from, 1)
    refs.splice(to, 0, x)
    void benchOp(orderOp(refs))
  }
  const none = () => void benchOp(live.map((t) => ({ op: 'remove', tab: 'resourcepacks', ref: refOf(t) }) as MilliOp))

  return (
    <div className="lk lk-packs">

      {modder && live.length ? (
        <div className="segs bt-mode lk-mode" role="radiogroup" aria-label="Как применить стиль">
          {(['add', 'replace'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={'seg' + (mode === m ? ' on' : '')} onClick={() => setMode(m)}>
              {m === 'add' ? 'Добавить' : 'Заменить'}
            </button>
          ))}
        </div>
      ) : null}

      {live.length ? (
        <>
          {modder ? (<div className="lk-cap">
            <span>Порядок</span>
            <span className="lk-cap-tip" title="Верхний пак главнее: его текстуры поверх остальных">
              <i aria-hidden="true">▲</i> главнее
            </span>
          </div>) : null}
          <PackList live={live} pack={pack} tier={tier} modder={modder} onMove={move} canMove={ORDER_READY} />
        </>
      ) : (
        <div className="lk-none">
          <PxArt name="painting" size={32} />
          <b className="lk-none-t">Выбери стиль</b>
        </div>
      )}

      {live.length ? <div className="lk-cap lk-cap-alt"><span>Другой стиль</span></div> : null}
      <div className="lk-styles" role="group" aria-label="Стиль">
        {styles.map((s, i) => {
          const on = isOn(s.id)
          return (
            <button
              key={s.id}
              className={'lk-style mlm-press mlm-pop' + (on ? ' on' : '')}
              style={{ '--i': i } as CSSProperties}
              aria-pressed={on}
              title={on ? 'Ещё один в этом стиле' : 'Добавить ' + s.ru}
              onClick={() => style(s.id)}
            >
              <span className="lk-style-art" data-style={s.id} aria-hidden="true">
                <PxArt name={STYLE_PX[s.id] ?? 'painting'} size={30} />
              </span>
              <span className="lk-style-t">{s.ru}</span>
            </button>
          )
        })}
      </div>

      {gone.length ? (
        <div className="lk-gone">
          {gone.map((t) => (
            <Ghost key={t.item.projectId} t={t} />
          ))}
        </div>
      ) : null}

      {live.length ? (
        <button className="btn sm ghost lk-off mlm-press" onClick={none}>
          <PxArt name="barrier" size={16} />
          Без ресурс-паков
        </button>
      ) : null}
    </div>
  )
}

const STEP = 60

/** Список с порядком: стрелки ▲▼ и перетаскивание за картинку. */
function PackList({
  live,
  pack,
  tier,
  modder,
  onMove,
  canMove,
}: {
  live: RpTile[]
  pack: MilliPack
  tier: MilliProfile
  modder: boolean
  onMove: (from: number, to: number) => void
  canMove: boolean
}) {
  const [drag, setDrag] = useState<{ i: number; dy: number } | null>(null)
  const start = useRef<{ y: number; i: number } | null>(null)
  const target = drag ? Math.max(0, Math.min(live.length - 1, drag.i + Math.round(drag.dy / STEP))) : -1

  const down = (i: number) => (e: ReactPointerEvent) => {
    if (!canMove || live.length < 2 || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { y: e.clientY, i }
    setDrag({ i, dy: 0 })
  }
  const moveP = (e: ReactPointerEvent) => {
    const s = start.current
    if (!s) return
    const lim = STEP / 2
    const dy = Math.max(-s.i * STEP - lim, Math.min((live.length - 1 - s.i) * STEP + lim, e.clientY - s.y))
    setDrag({ i: s.i, dy })
  }
  const up = () => {
    const s = start.current
    start.current = null
    if (s && drag) onMove(s.i, target)
    setDrag(null)
  }

  return (
    <ol className={'lk-list' + (drag ? ' is-drag' : '')}>
      {live.map((t, i) => {
        let shift = 0
        if (drag && i !== drag.i) {
          if (drag.i < i && i <= target) shift = -STEP
          else if (target <= i && i < drag.i) shift = STEP
        }
        const style: CSSProperties | undefined = drag
          ? { transform: `translateY(${i === drag.i ? drag.dy : shift}px)`, zIndex: i === drag.i ? 2 : undefined }
          : undefined
        return (
          <PackRow
            key={t.item.projectId}
            t={t}
            n={i + 1}
            pack={pack}
            tier={tier}
            modder={modder}
            style={style}
            held={drag?.i === i}
            first={i === 0}
            last={i === live.length - 1}
            canMove={canMove}
            onUp={() => onMove(i, i - 1)}
            onDown={() => onMove(i, i + 1)}
            grip={{ onPointerDown: down(i), onPointerMove: moveP, onPointerUp: up, onPointerCancel: up }}
          />
        )
      })}
    </ol>
  )
}

function PackRow({
  t,
  n,
  pack,
  tier,
  modder,
  style,
  held,
  first,
  last,
  canMove,
  onUp,
  onDown,
  grip,
}: {
  t: RpTile
  n: number
  pack: MilliPack
  tier: MilliProfile
  modder: boolean
  style?: CSSProperties
  held: boolean
  first: boolean
  last: boolean
  canMove: boolean
  onUp: () => void
  onDown: () => void
  grip: Record<string, (e: ReactPointerEvent) => void>
}) {
  const { item } = t
  const look = lookOf({ slug: item.slug ?? '', projectId: item.projectId, preview: item.preview, res: item.res })
  const res = resNum(look.res)
  const fit = res ? resFit(res, tier) : 'good'
  const ref = item.slug || item.projectId
  const needs = modder ? requiredTitles(item, pack) : []
  return (
    <li className={'lk-row' + (held ? ' is-held' : '') + (first ? ' is-top' : '')} style={style}>
      <span className={'lk-grip' + (canMove ? ' can' : '')} {...(canMove ? grip : {})} title={canMove ? 'Потяни, чтобы поменять порядок' : undefined}>
        <b className="lk-n">{n}</b>
        <LookPic src={look.img} alt={look.alt} icon={item.icon} px="painting" className="lk-row-pic" />
      </span>
      <span className="lk-row-txt">
        <span className="lk-row-t" title={item.title}>
          {shortName(item.title)}
        </span>
        <span className="lk-row-b">
          {res ? (
            <span className={'lk-res fit-' + fit} title={RES_TIP[fit]}>
              {fit === 'bad' ? <i className="lk-res-warn" aria-hidden="true">!</i> : null}
              {modder ? look.res : resLabel(res)}
            </span>
          ) : null}
          {needs.map((x) => (
            <span key={x} className="bt-badge need">
              +{x}
            </span>
          ))}
          {modder && item.slug ? <span className="bt-badge mono">{item.slug + (item.version ? ' · ' + item.version : '')}</span> : null}
        </span>
      </span>
      {canMove ? (
        <span className="lk-arrows">
          <button className="lk-arrow mlm-press" disabled={first} aria-label="Выше" onClick={onUp}>
            ▲
          </button>
          <button className="lk-arrow mlm-press" disabled={last} aria-label="Ниже" onClick={onDown}>
            ▼
          </button>
        </span>
      ) : null}
      <button className="lk-x mlm-press" aria-label={'Убрать ' + item.title} title="Убрать" onClick={() => void benchOp({ op: 'remove', tab: 'resourcepacks', ref })}>
        <i aria-hidden="true" />
      </button>
    </li>
  )
}

function Ghost({ t }: { t: RpTile }) {
  const ref = t.item.slug || t.item.projectId
  return (
    <div className="lk-ghost">
      <span className="lk-ghost-t">{shortName(t.item.title)}</span>
      <button className="btn sm secondary mlm-press" onClick={() => void benchOp({ op: 'restore', tab: 'resourcepacks', ref })}>
        Вернуть
      </button>
    </div>
  )
}
