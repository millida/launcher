import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PxIcon } from '../../PxIcon'
import { mirrorAsset } from '../../../lib/api'
import { copyText } from '../../../lib/clipboard'
import { LOADER_LABEL, isLockedItem } from '../../../lib/milli'
import type { MilliCat, MilliExcluded, MilliItem } from '../../../lib/milli'
import { benchHas, benchOp, changeMarks, knownItem, useBench } from '../../../state/milliBench'
import type { BenchFilter } from '../../../state/milliBench'
import { useMilli } from '../../../state/milli'
import { openMilliItem } from '../../../state/project'
import { showToast } from '../../../state/ui'
import { McItem } from '../McItem'
import { Art, MilliModTip, useModTip } from '../MilliModTip'
import type { TipRel, TipTarget } from '../MilliModTip'
import { excludedWhy, isLib, needsOf, packTree } from '../milliPackTree'
import { PxArt } from '../px'
import { benchRows, buildIndex, groupKeyOf, groupPx, rowIndexOf } from './benchRows'
import type { BenchRow, BenchRowKind } from './benchRows'
import { VirtualList } from './VirtualList'
import { useFlashWindow } from '../motion'
import type { VirtualHandle } from './VirtualList'
import '../../../styles/pixel/milli-pack.css'
import '../../../styles/pixel/milli-mods.css'

/*
 * Вкладка «Моды» в карточке сборки (маленький чат, ~408px; игрок 12–14 лет —
 * почти без текста). Строка: иконка, название (до 2 строк, не режется
 * посреди слова), одна короткая строка по-русски, бейдж RU, тумблер. Всё
 * техническое — версия, slug, сторона, автор, оригинал описания, библиотеки
 * веткой под своим модом, «Не вошли», массовый выбор — только с «Для
 * моддеров». Фильтры — иконки со счётчиком. В конце списка — «Можно
 * добавить» (3 чипа + «ещё»). Виртуальный список: высоты считаем заранее
 * (название мерим canvas-ом по ширине списка), анимации раскладки — в
 * VirtualList (`animKey`). Все правки — `benchOp` (стор верстака).
 */

const FILTERS: { id: BenchFilter; ru: string; icon: string }[] = [
  { id: 'all', ru: 'Все', icon: 'grid' },
  { id: 'changed', ru: 'Изменённые', icon: 'sparkle' },
  { id: 'off', ru: 'Выключенные', icon: 'power' },
  { id: 'warn', ru: 'С проблемами', icon: 'alert' },
]
const SIDE_RU: Record<string, string> = { client: 'клиент', server: 'сервер', both: 'клиент + сервер', single: 'одиночная' }
/** Пиксельная картинка категории в заголовке группы. */
const CAT_PX: Record<MilliCat, string> = {
  perf: 'fps_torch',
  ui: 'spyglass',
  world: 'grass_dandelion',
  mobs: 'zombie_bandage',
  tech: 'create_cog',
  magic: 'spellbook',
  adventure: 'rpg_sword_shield',
  build: 'crafting_table',
  look: 'painting',
  misc: 'chest',
  lib: 'book_quill',
}

const few = (a: string[], k = 2) => (a.length > k ? a.slice(0, k).join(', ') + ' +' + (a.length - k) : a.join(', '))

const markPerf = (name: string) => {
  try {
    performance.mark(name)
  } catch {}
}
const measurePerf = (name: string, from: string, to: string) => {
  try {
    performance.measure(name, from, to)
  } catch {}
}

/** Уже загруженные иконки: при повторном показе строки — сразу, без задержки. */
const iconsLoaded = new Set<string>()

/**
 * Иконка строки. Запрос уходит, только если строка простояла на экране 120 мс:
 * быстрая прокрутка 300 модов не ставит сотни запросов в очередь (браузер
 * держит 6 соединений — иначе иконки внизу списка ждут секундами).
 */
function Icon({ m, size = 28 }: { m: MilliItem; size?: number }) {
  const src = m.icon ? mirrorAsset(m.icon) : undefined
  const [bad, setBad] = useState(false)
  const [go, setGo] = useState(() => !!src && iconsLoaded.has(src))
  useEffect(() => {
    if (!src || go) return
    const t = window.setTimeout(() => setGo(true), 120)
    return () => window.clearTimeout(t)
  }, [src, go])
  if (src && !bad) {
    return go ? <img src={src} alt="" decoding="async" width={size} height={size} onLoad={() => iconsLoaded.add(src)} onError={() => setBad(true)} /> : null
  }
  return (
    <Art px="crafting_table" size={16}>
      <McItem name="book" size={16} />
    </Art>
  )
}

// ─── Сколько строк займёт название ────────────────────────────────────────────

/** Место под текст строки мода: ширина списка минус слот, тумблер, отступы (milli-mods.css). */
const TEXT_SIDE = 108
const BADGE_RU = 24
const BADGE_MARK = 20

let ctx: CanvasRenderingContext2D | null | undefined
function textW(s: string, font: string): number {
  if (ctx === undefined) ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
  if (!ctx) return s.length * 7.2
  ctx.font = font
  return ctx.measureText(s).width
}

/** Название в 1 или 2 строки при этой ширине: canvas (без чтения DOM), с кэшем; шрифт догрузился — пересчёт. */
function useLines(width: number) {
  const [fontSeq, setFontSeq] = useState(0)
  useEffect(() => {
    let live = true
    document.fonts?.ready.then(() => live && setFontSeq((n) => n + 1)).catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return useMemo(() => {
    const fam = (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--m-font').trim()) || 'system-ui, sans-serif'
    const font = '650 13px ' + fam
    const avail = Math.max(120, width - TEXT_SIDE)
    const cache = new Map<string, 1 | 2>()
    void fontSeq
    return (m: MilliItem, kind: BenchRowKind): 1 | 2 => {
      if (kind === 'lib') return 1
      const extra = (m.ruInGame ? BADGE_RU : 0) + BADGE_MARK
      const k = m.title + '|' + extra
      let v = cache.get(k)
      if (!v) {
        // Запас 4%: canvas и вёрстка расходятся на доли пикселя, а лишняя строка лучше обрезанной.
        v = textW(m.title, font) + extra > avail * 0.96 ? 2 : 1
        cache.set(k, v)
      }
      return v
    }
  }, [width, fontSeq])
}

/** Подгонка подписи (11.5px) под ширину текста строки, с кэшем. */
function fitter(width: number): (t: string) => string {
  const fam = (typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--m-font').trim()) || 'system-ui, sans-serif'
  const font = '500 11.5px ' + fam
  const avail = Math.max(100, width - TEXT_SIDE) - 4
  const cache = new Map<string, string>()
  return (t) => {
    let v = cache.get(t)
    if (v === undefined) cache.set(t, (v = fitWords(t, avail, font)))
    return v
  }
}

// ─── Строка ───────────────────────────────────────────────────────────────────

/** Короткая строка целиком или до границы слова с «…» (не посреди слова). */
function fitWords(text: string, avail: number, font: string): string {
  if (!text || textW(text, font) <= avail) return text
  const words = text.split(/\s+/)
  let out = ''
  for (const w of words) {
    const next = out ? out + ' ' + w : w
    if (textW(next + '…', font) > avail) break
    out = next
  }
  return (out || words[0] || '').replace(/[,.;:—–-]+$/, '') + '…'
}

/** Версия без загрузчика и версии игры: «neoforge-mc1.21-1.9.0» → «1.9.0». */
export function shortVer(v: string, mc?: string): string {
  const parts = v.match(/\d+(?:\.\d+)+/g)?.filter((x) => x !== mc && !(mc && mc.startsWith(x + '.')) && !/^1\.(1\d|2\d)(\.\d+)?$/.test(x))
  return parts && parts.length ? parts[parts.length - 1]! : v
}

interface RowFns {
  /** Подогнать короткую строку под ширину (по словам). */
  fit(text: string): string
  ver(v: string): string
  toggle(m: MilliItem, ghost: boolean): void
  open(m: MilliItem): void
  select(id: string, shift: boolean): void
  tipShow(t: TipTarget, now?: boolean): void
  tipHide(): void
  copy(slug: string): void
  en(id: string): void
  group(key: string): void
  groupSelect(ids: string[]): void
  dropOrphans(list: MilliItem[]): void
  hideOrphans(): void
}

interface RowProps {
  row: BenchRow
  modder: boolean
  selected: boolean
  selecting: boolean
  /** Для заголовка: сколько строк группы выбрано. */
  picked: number
  en: boolean
  flash: boolean
  /** Строка вернулась после «Отменить» (моушн рисует иначе). */
  back: boolean
  fns: RowFns
}

const sameItem = (a: MilliItem | undefined, b: MilliItem | undefined) =>
  a === b ||
  (!!a &&
    !!b &&
    a.projectId === b.projectId &&
    a.title === b.title &&
    a.icon === b.icon &&
    a.slug === b.slug &&
    a.descriptionRu === b.descriptionRu &&
    a.description === b.description &&
    a.why === b.why &&
    a.version === b.version &&
    a.side === b.side &&
    a.author === b.author &&
    a.pinned === b.pinned &&
    a.ruInGame === b.ruInGame)

const sameList = (a: readonly { projectId?: string }[] | string[] | undefined, b: typeof a) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((x, i) => x === b[i] || (typeof x === 'object' && (x as MilliItem).projectId === (b[i] as MilliItem).projectId)))

/** Строки одинаковы по смыслу: новая ревизия даёт новые объекты, но неизменённые строки не перерисовываются. */
function sameRow(a: BenchRow, b: BenchRow): boolean {
  return (
    a === b ||
    (a.key === b.key &&
      a.kind === b.kind &&
      a.h === b.h &&
      a.mark === b.mark &&
      a.warn === b.warn &&
      a.branch === b.branch &&
      a.label === b.label &&
      a.n === b.n &&
      a.collapsed === b.collapsed &&
      sameItem(a.item, b.item) &&
      sameList(a.needFor, b.needFor) &&
      sameList(a.ids, b.ids) &&
      sameList(a.orphans, b.orphans))
  )
}

const sameRowProps = (a: RowProps, b: RowProps) =>
  a.modder === b.modder &&
  a.selected === b.selected &&
  a.selecting === b.selecting &&
  a.picked === b.picked &&
  a.en === b.en &&
  a.flash === b.flash &&
  a.back === b.back &&
  a.fns === b.fns &&
  sameRow(a.row, b.row)

const libWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'лишняя библиотека' : 'лишние библиотеки')

/** Строка списка. memo по смыслу строки: при прокрутке, кликах и новой ревизии перерисовываются только изменившиеся. */
const Row = memo(function Row({ row, modder, selected, selecting, picked, en, flash, back, fns }: RowProps) {
  if (row.kind === 'group') {
    const n = row.ids?.length ?? 0
    const cat = (row.group ?? '') as MilliCat
    return (
      <div className={'mbl-group' + (row.collapsed ? ' shut' : '')}>
        {modder && selecting && n ? (
          <span
            className={'chk mbl-gsel' + (picked === n ? ' on' : picked ? ' part' : '')}
            role="checkbox"
            aria-checked={picked === n ? true : picked ? 'mixed' : false}
            aria-label="Выбрать группу"
            onClick={(e) => (e.stopPropagation(), fns.groupSelect(row.ids!))}
          />
        ) : null}
        <button type="button" className="mbl-gbtn" aria-expanded={!row.collapsed} tabIndex={-1} onClick={() => fns.group(row.group!)}>
          {groupPx(row.group ?? '') ?? CAT_PX[cat] ? <PxArt name={groupPx(row.group ?? '') ?? CAT_PX[cat]} size={16} className="mbl-gic" glint={false} /> : null}
          <b>{row.label}</b>
          <i>{row.n}</i>
          <PxIcon name="chev-d" size={10} className="px-icon mbl-chev" />
        </button>
      </div>
    )
  }

  if (row.kind === 'orphans') {
    const list = row.orphans ?? []
    return (
      <div className="mbl-orphans" role="status" title={list.map((m) => m.title).join(', ')}>
        <PxArt name="hopper" size={16} glint={false} />
        <span>
          <b>{list.length}</b> {libWord(list.length)}
          {modder ? <i>{few(list.map((m) => m.title))}</i> : null}
        </span>
        <button type="button" className="btn sm secondary" data-track="milli_orphans_drop" tabIndex={-1} onClick={() => fns.dropOrphans(list)}>
          Убрать
        </button>
        <button type="button" className="mpc-x" aria-label="Оставить" tabIndex={-1} onClick={fns.hideOrphans}>
          <PxIcon name="x" size={10} />
        </button>
      </div>
    )
  }

  const m = row.item!
  const ghost = row.kind === 'ghost'
  const lib = row.kind === 'lib'
  const locked = isLockedItem(m)
  const on = !ghost
  const target = (el: HTMLElement): TipTarget => ({ m, el, kind: 'mod', on, locked, canToggle: !locked })
  // Одна короткая строка по-русски. Английский — только моддеру по кнопке EN.
  const sub: ReactNode = row.warn ? (
    <span className="mbl-why warn">
      <PxIcon name="alert" size={10} />
      {row.warn}
    </span>
  ) : lib && row.needFor?.length ? (
    <span className="mbl-why">для {few(row.needFor)}</span>
  ) : modder && en && m.description ? (
    <span className="mbl-why" lang="en">
      {m.description}
    </span>
  ) : (
    <span className="mbl-why">{fns.fit(m.descriptionRu || m.why)}</span>
  )

  const markTag =
    row.mark === '+' ? (
      <i className={'mbl-mk ' + (back ? 'back' : 'add')} title={back ? 'Вернулся' : 'Новый'} aria-label={back ? 'Вернулся' : 'Новый'}>
        <PxIcon name={back ? 'reply' : 'plus'} size={8} />
      </i>
    ) : row.mark === '~' ? (
      <i className="mbl-mk chg" title="Обновлён" aria-label="Обновлён">
        <PxIcon name="arrow-up" size={8} />
      </i>
    ) : null

  return (
    <div
      className={
        'mbl-row k-' +
        row.kind +
        (row.branch ? ' branch' : '') +
        (row.mark === '+' ? (back ? ' m-back' : ' m-add') : row.mark === '~' ? ' m-chg' : '') +
        (selected ? ' sel' : '') +
        (flash ? ' flash' : '')
      }
      data-id={m.slug}
      data-mlm-diff={back && row.mark ? 'back' : undefined}
      onMouseEnter={(e) => fns.tipShow(target(e.currentTarget))}
      onMouseLeave={fns.tipHide}
      onClick={(e) => (modder && (e.shiftKey || selecting) ? fns.select(m.projectId, e.shiftKey) : fns.open(m))}
    >
      {row.branch ? <i className="mbl-branch" aria-hidden="true" /> : null}
      <span className="mpc-slot mbl-ic">
        <Icon m={m} size={lib ? 18 : 28} />
        {modder && !ghost ? (
          <span
            className={'chk mbl-sel' + (selected ? ' on' : '')}
            role="checkbox"
            aria-checked={selected}
            aria-label="Выбрать"
            onClick={(e) => (e.stopPropagation(), fns.select(m.projectId, e.shiftKey))}
          />
        ) : null}
        {m.pinned && !locked ? (
          <span className="mpc-lock" title="Закреплён">
            <PxIcon name="lock" size={8} />
          </span>
        ) : null}
      </span>
      <span className="mbl-txt">
        <span className="mbl-name">
          <span className="mbl-t">{m.title}</span>
          {m.ruInGame ? (
            <i className="mbl-ru" title="Есть русский в игре" aria-label="Есть русский в игре">
              RU
            </i>
          ) : null}
          {markTag}
        </span>
        <span className="mbl-sub">{sub}</span>
        {modder && !lib ? (
          <span className="mbl-meta">
            {m.version ? (
              <span className="mbl-ver" title={m.version}>
                {fns.ver(m.version)}
              </span>
            ) : null}
            <button type="button" className="mbl-slug" tabIndex={-1} title="Скопировать slug" onClick={(e) => (e.stopPropagation(), fns.copy(m.slug))}>
              {m.slug}
            </button>
            {m.side ? <span className="mbl-side">{SIDE_RU[m.side] || m.side}</span> : null}
            {m.author ? <span className="mbl-by">{m.author}</span> : null}
            {m.description && !ghost ? (
              <button
                type="button"
                className={'mbl-en' + (en ? ' on' : '')}
                tabIndex={-1}
                aria-pressed={en}
                title="Оригинал описания"
                onClick={(e) => (e.stopPropagation(), fns.en(m.projectId))}
              >
                EN
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
      {locked ? (
        <span className="mbl-locked" title="Нужен всегда" aria-label="Нужен всегда">
          <PxIcon name="lock" size={12} />
        </span>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={on ? 'Выключить' : 'Включить'}
          className={'mbl-sw ' + (on ? 'mbl-box' : 'mbl-back')}
          data-track={on ? 'milli_mod_toggle' : 'milli_mod_restore'}
          data-id={m.slug}
          tabIndex={-1}
          onClick={(e) => (e.stopPropagation(), fns.toggle(m, ghost))}
        >
          <span className={'tgl' + (on ? ' on' : '')} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}, sameRowProps)

// ─── Хвост списка: «Можно добавить», «Не вошли» ───────────────────────────────

const SUG_SHOW = 3

const Suggest = memo(function Suggest({ items }: { items: MilliItem[] }) {
  const [all, setAll] = useState(false)
  if (!items.length) return null
  const shown = all ? items.slice(0, 18) : items.slice(0, SUG_SHOW)
  const more = items.length - SUG_SHOW
  return (
    <section className="mbl-add" aria-label="Можно добавить">
      <h4 className="mbl-tail-h">
        <PxIcon name="plus" size={10} />
        Можно добавить
      </h4>
      <div className="mbl-chips">
        {shown.map((m, i) => (
          <button
            key={m.projectId}
            type="button"
            className="mbl-chip"
            style={{ '--i': i } as React.CSSProperties}
            title={m.descriptionRu || m.why || m.title}
            data-track="milli_optional_add"
            data-id={m.slug}
            onClick={() => void benchOp({ op: 'add', tab: 'mods', ref: m.projectId })}
          >
            <span className="mbl-chip-ic">
              <Icon m={m} size={16} />
            </span>
            <span className="mbl-chip-t">{m.title}</span>
            <PxIcon name="plus" size={10} className="px-icon mbl-chip-plus" />
          </button>
        ))}
        {more > 0 ? (
          <button type="button" className="mbl-chip more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? 'Скрыть' : 'ещё ' + more}
          </button>
        ) : null}
      </div>
    </section>
  )
})

const Excluded = memo(function Excluded({ list }: { list: MilliExcluded[] }) {
  if (!list.length) return null
  return (
    <details className="mbl-excl">
      <summary>
        <PxIcon name="chev-r" size={10} className="px-icon mbl-chev" />
        Не вошли в сборку
        <i>{list.length}</i>
      </summary>
      <ul>
        {list.slice(0, 24).map((e, i) => {
          const w = excludedWhy(e)
          return (
            <li key={e.slug + i} data-id={e.slug} title={w.cause || undefined}>
              <McItem name="barrier" size={14} />
              <b>{e.title}</b>
              <span>{w.cause || w.why}</span>
            </li>
          )
        })}
      </ul>
    </details>
  )
})

// ─── Вкладка ──────────────────────────────────────────────────────────────────

/** Убранные из вкладки «Моды»: userRemoved + дифф головы, предметами (из ревизий сессии или из ссылки дифа). */
function removedItems(userRemoved: readonly string[] | undefined, refs: { projectId: string; title: string; tab: string }[], present: Set<string>): MilliItem[] {
  const out: MilliItem[] = []
  const seen = new Set<string>()
  const add = (id: string, title?: string) => {
    if (!id || present.has(id) || seen.has(id)) return
    seen.add(id)
    const k = knownItem(id)
    out.push(k ?? { projectId: id, slug: id, title: title || id, icon: null, why: '', base: false, source: 'modrinth' })
  }
  for (const r of refs) if (r.tab === 'mods') add(r.projectId, r.title)
  // userRemoved общий на все вкладки: берём только моды.
  for (const id of userRemoved ?? []) if ((benchHas(id)?.tab ?? 'mods') === 'mods') add(id)
  return out
}

/** Высота списка в карточке ленты: дальше — своя прокрутка. */
export const MODS_MAX_H = 300

/** Последний обработанный «Показать» (seq): переживает сворачивание вкладки. */
let revealDone = 0

const EMPTY_SET: ReadonlySet<string> = new Set()

export function BenchMods() {
  const t0 = useRef(false)
  if (!t0.current) {
    t0.current = true
    markPerf('milli:mods:render:start')
  } else markPerf('milli:mods:update:start')

  const head = useBench((s) => s.head)
  const filter = useBench((s) => s.ui.filter)
  const query = useBench((s) => s.ui.query)
  const modder = useBench((s) => s.ui.modder)
  // Одна булева подписка вместо ui.open + ui.tab: смена вкладки не перерисовывает список.
  const shownInCard = useBench((s) => s.ui.open && s.ui.tab === 'mods')
  const restoreSeq = useBench((s) => s.restoreSeq)
  const reveal = useBench((s) => s.reveal)
  const setUi = useBench((s) => s.setUi)
  const panelOpen = useMilli((s) => s.open)
  // Группировка во вкладке одна — по темам (моддеру библиотеки веткой под модом).
  const group = 'cat' as const

  const [toggled, setToggled] = useState<ReadonlySet<string>>(EMPTY_SET)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [enOn, setEnOn] = useState<Set<string>>(() => new Set())
  const [orphansHidden, setOrphansHidden] = useState(false)
  const [flash, setFlash] = useState<{ id: string; seq: number }>({ id: '', seq: 0 })
  const [width, setWidth] = useState(392)
  const lastPick = useRef(-1)
  const list = useRef<VirtualHandle>(null)
  const search = useRef<HTMLInputElement>(null)
  const tip = useModTip()
  const lines = useLines(width)

  const mods = head?.mods ?? []
  const changes = head?.changes ?? null
  const marks = useMemo(() => changeMarks(changes), [changes])
  // Дифф отмены (стор называет его «Отмена»): строки «вернулись», а не новые.
  const undone = !!changes && /^(отмен|вернул)/i.test(changes.titleRu || '')
  const removed = useMemo(
    () => removedItems(head?.userRemoved, [...(changes?.removed ?? [])], new Set(mods.map((m) => m.projectId))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [head],
  )
  // Индекс поиска и дерево — один раз на голову, не на каждый символ.
  // Индекс поиска нужен только при вводе: клик по галочке его не пересобирает.
  const hasQuery = query.trim() !== ''
  const index = useMemo(() => (hasQuery ? buildIndex([...mods, ...removed]) : undefined), [mods, removed, hasQuery])
  const tree = useMemo(() => packTree([...mods, ...removed]), [mods, removed])

  const out = useMemo(
    () => benchRows({ mods, removed, marks, group, filter, query, modder, toggled, index, tree, orphansHidden, lines }),
    [mods, removed, marks, filter, query, modder, toggled, index, tree, orphansHidden, lines],
  )
  const rows = out.rows
  // Раскладка анимируется только от действий (клик, группа, новая ревизия, режим), не от поиска и фильтра.
  const animKey = useMemo(() => ({}), [head, toggled, modder, orphansHidden])

  // Замер для QA: первый рендер вкладки (от начала рендера до коммита).
  const measured = useRef(false)
  useLayoutEffect(() => {
    // Под <Activity> эффекты перезапускаются при каждом показе — меряем только первый.
    if (measured.current) return
    measured.current = true
    markPerf('milli:mods:render:end')
    measurePerf('milli:mods:render', 'milli:mods:render:start', 'milli:mods:render:end')
  }, [])
  // Обновление списка (поиск, фильтр, группа, клик) — отдельной меткой: от рендера до коммита.
  const first = useRef(true)
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    markPerf('milli:mods:update:end')
    measurePerf('milli:mods:update', 'milli:mods:update:start', 'milli:mods:update:end')
  }, [rows])

  // Сборка сменилась — выбор и закрытая плашка сирот сбрасываются.
  const chainId = head?.chain ?? head?.buildId ?? ''
  useEffect(() => {
    setSelected(new Set())
    setOrphansHidden(false)
  }, [chainId])
  // Режим моддера выключили — выбор снимается (у игрока его нет).
  useEffect(() => {
    if (!modder) setSelected((s) => (s.size ? new Set() : s))
  }, [modder])

  // Выбранные, которых больше нет в строках (убрали), выпадают из выбора.
  useEffect(() => {
    setSelected((s) => {
      if (!s.size) return s
      const ids = new Set([...mods.map((m) => m.projectId), ...removed.map((m) => m.projectId)])
      const n = new Set([...s].filter((id) => ids.has(id)))
      return n.size === s.size ? s : n
    })
  }, [mods, removed])

  // «Показать» из чипа изменений: развернуть группу, прокрутить к строке, мигнуть.
  const revealSeq = reveal?.seq ?? 0
  const pendingReveal = useRef<string>('')
  useEffect(() => {
    // Одно «Показать» — одна прокрутка: при повторном раскрытии вкладки старое не повторяем.
    if (!reveal || reveal.tab !== 'mods' || !reveal.projectId || reveal.seq <= revealDone) return
    revealDone = reveal.seq
    const m = mods.find((x) => x.projectId === reveal.projectId) ?? removed.find((x) => x.projectId === reveal.projectId)
    if (m) {
      const key = groupKeyOf(m, group)
      const collapsed = rows.some((r) => r.kind === 'group' && r.group === key && r.collapsed)
      if (collapsed) setToggled((s) => new Set(s).add(key))
    }
    // Строку могли спрятать фильтр или поиск — показываем всё.
    if (filter !== 'all' || query) setUi({ filter: 'all', query: '' })
    pendingReveal.current = reveal.projectId
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealSeq])
  useEffect(() => {
    const id = pendingReveal.current
    if (!id) return
    const i = rowIndexOf(rows, id)
    if (i < 0) return
    pendingReveal.current = ''
    list.current?.scrollToIndex(i, 'center')
    setFlash({ id, seq: revealSeq })
  }, [rows, revealSeq])
  // Окно вспышки (моушн): мигают строки дифа, смонтированные в эти 1,4 с; доскролленные позже — нет.
  const flashOn = useFlashWindow(flash.seq || null, 1400)

  // Панель свернули — подсказка уходит.
  const closeTip = tip.close
  useEffect(() => {
    if (!panelOpen || !shownInCard) closeTip()
  }, [panelOpen, shownInCard, closeTip])

  // ── Действия ──────────────────────────────────────────────────────────────
  const live = useRef({ rows, head, tree, mods, removed })
  live.current = { rows, head, tree, mods, removed }

  const toggle = useCallback((m: MilliItem, ghost: boolean) => {
    if (isLockedItem(m)) return
    void benchOp({ op: ghost ? 'restore' : 'remove', tab: 'mods', ref: m.projectId })
  }, [])

  const openMod = useCallback(
    (m: MilliItem) => {
      tip.close()
      const t = live.current.tree
      void openMilliItem(m, 'mods', { locked: isLockedItem(m), neededBy: (t.parents.get(m.projectId) || []).map((p) => p.title) })
    },
    // tip.close стабилен
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const select = useCallback((id: string, shift: boolean) => {
    const index = rowIndexOf(live.current.rows, id)
    setSelected((s) => {
      const n = new Set(s)
      const rs = live.current.rows
      if (shift && lastPick.current >= 0) {
        const [a, b] = lastPick.current < index ? [lastPick.current, index] : [index, lastPick.current]
        for (let i = a; i <= b; i++) {
          const it = rs[i]?.item
          if (it && !isLockedItem(it)) n.add(it.projectId)
        }
      } else if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
    lastPick.current = index
  }, [])

  const mc = head?.mcVersion
  const fns = useMemo<RowFns>(
    () => ({
      fit: fitter(width),
      ver: (v) => shortVer(v, mc),
      toggle,
      open: openMod,
      select,
      tipShow: tip.show,
      tipHide: tip.hide,
      copy: (slug) => void copyText(slug).then((ok) => showToast(ok ? 'slug скопирован' : 'Не удалось скопировать', ok ? 'ok' : 'error')),
      en: (id) =>
        setEnOn((s) => {
          const n = new Set(s)
          if (n.has(id)) n.delete(id)
          else n.add(id)
          return n
        }),
      group: (key) =>
        setToggled((s) => {
          const n = new Set(s)
          if (n.has(key)) n.delete(key)
          else n.add(key)
          return n
        }),
      groupSelect: (ids) =>
        setSelected((s) => {
          const all = ids.every((id) => s.has(id))
          const n = new Set(s)
          for (const id of ids) if (all) n.delete(id)
          else n.add(id)
          return n
        }),
      dropOrphans: (ls) => void benchOp(ls.map((m) => ({ op: 'remove' as const, tab: 'mods' as const, ref: m.projectId }))),
      hideOrphans: () => setOrphansHidden(true),
    }),
    [toggle, openMod, select, tip.show, tip.hide, width, mc],
  )

  const onKey = useCallback(
    (k: 'toggle' | 'open', i: number) => {
      const r = live.current.rows[i]
      if (!r) return
      if (r.kind === 'group') {
        if (r.group) fns.group(r.group)
        return
      }
      if (!r.item) return
      if (k === 'toggle') toggle(r.item, r.kind === 'ghost')
      else openMod(r.item)
    },
    [fns, toggle, openMod],
  )

  const onSettle = useCallback((top: number) => {
    const s = useBench.getState()
    if ((s.ui.scroll.mods ?? 0) !== top) s.setUi({ scroll: { ...s.ui.scroll, mods: top } })
  }, [])
  const onWidth = useCallback((w: number) => setWidth((x) => (Math.abs(x - w) > 1 ? w : x)), [])

  // ── Хвост: «Можно добавить» (не в сборке и не убранные игроком), «Не вошли» (моддеру) ──
  const optional = head?.optional
  const userRemoved = head?.userRemoved
  const suggest = useMemo(() => {
    if (!Array.isArray(optional) || !optional.length) return []
    const inPack = new Set(mods.map((m) => m.projectId))
    const off = new Set(userRemoved ?? [])
    return optional.filter((m) => m && m.projectId && !inPack.has(m.projectId) && !off.has(m.projectId))
  }, [optional, mods, userRemoved])
  const excluded = head?.excluded ?? []
  const searching = !!query.trim()
  const tail =
    !searching && filter === 'all' && (suggest.length || (modder && excluded.length)) ? (
      <>
        <Suggest items={suggest} />
        {modder ? <Excluded list={excluded} /> : null}
      </>
    ) : null

  // ── Массовые действия (моддер) ───────────────────────────────────────────
  const selIds = [...selected]
  const onIds = new Set(mods.map((m) => m.projectId))
  const selOn = selIds.filter((id) => onIds.has(id))
  const selOff = selIds.filter((id) => !onIds.has(id))
  const bulkRemove = () => {
    const ids = selOn.filter((id) => {
      const m = mods.find((x) => x.projectId === id)
      return m && !isLockedItem(m)
    })
    if (ids.length) void benchOp(ids.map((ref) => ({ op: 'remove' as const, tab: 'mods' as const, ref })))
    setSelected(new Set())
  }
  const bulkRestore = () => {
    if (selOff.length) void benchOp(selOff.map((ref) => ({ op: 'restore' as const, tab: 'mods' as const, ref })))
    setSelected(new Set())
  }
  const askMilli = () => {
    const titles = selIds.map((id) => (mods.find((m) => m.projectId === id) ?? removed.find((m) => m.projectId === id))?.title).filter(Boolean) as string[]
    const text = 'Про моды ' + few(titles, 6) + ': '
    useMilli.setState((s) => ({ restore: { text, seq: s.restore.seq + 1 }, focusSeq: s.focusSeq + 1 }))
    setSelected(new Set())
  }

  // ── Подсказка ────────────────────────────────────────────────────────────
  const rel = (m: MilliItem): TipRel => {
    const ps = tree.parents.get(m.projectId) || []
    const on = (x: MilliItem) => onIds.has(x.projectId)
    return {
      needFor: ps.map((p) => p.title),
      needs: needsOf(tree, m, [...mods, ...removed]).map((d) => d.title),
      broken: isLib(m) && !on(m) && ps.some(on) ? ps.filter(on).map((p) => p.title) : [],
    }
  }

  if (!head) return null
  const selecting = modder && selected.size > 0
  const loader = LOADER_LABEL[head.loader] || head.loader
  const restoreKey = restoreSeq + ':' + (panelOpen ? 1 : 0) + (shownInCard ? 1 : 0)

  return (
    <div className={'mbl mmd' + (modder ? ' is-modder' : '') + (selecting ? ' is-selecting' : '')} data-section="milli_bench_mods">
      <div className="mbl-bar">
        <label className="mbl-search">
          <PxIcon name="search" size={12} />
          <input
            ref={search}
            data-bench-search=""
            className="input sm"
            type="search"
            placeholder="Найти мод"
            aria-label="Найти мод"
            value={query}
            spellCheck={false}
            onChange={(e) => setUi({ query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation()
                setUi({ query: '' })
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                list.current?.focusIndex(0)
              }
            }}
          />
        </label>
        <div className="mbl-filters" role="radiogroup" aria-label="Фильтр">
          {FILTERS.map((f) => {
            const n = out.counts[f.id]
            if (f.id !== 'all' && !n && filter !== f.id) return null
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={filter === f.id}
                aria-label={f.ru + ': ' + n}
                title={f.ru}
                className={'mbl-fc' + (filter === f.id ? ' on' : '') + ' f-' + f.id}
                data-track="milli_bench_filter"
                data-id={f.id}
                onClick={() => setUi({ filter: filter === f.id && f.id !== 'all' ? 'all' : f.id })}
              >
                <PxIcon name={f.icon} size={12} />
                <i>{n}</i>
              </button>
            )
          })}
        </div>
      </div>

      {rows.length ? (
        <VirtualList
          ref={list}
          rows={rows}
          heightOf={rowH}
          keyOf={rowKey}
          pidOf={rowPid}
          scrollKey="mods"
          label="Моды сборки"
          className="mbl-list"
          maxH={MODS_MAX_H}
          restoreTop={useBench.getState().ui.scroll.mods ?? 0}
          restoreSeq={restoreKey}
          onSettle={onSettle}
          onScroll={tip.tip ? tip.close : undefined}
          onKey={onKey}
          onWidth={onWidth}
          animKey={animKey}
          tail={tail}
          render={(r) => {
            const id = r.item?.projectId ?? ''
            return (
              <Row
                row={r}
                modder={modder}
                selected={!!id && selected.has(id)}
                selecting={selecting}
                picked={r.kind === 'group' && selecting ? (r.ids ?? []).filter((x) => selected.has(x)).length : 0}
                en={!!id && enOn.has(id)}
                flash={flashOn && !!id && (flash.id === id || !!r.mark)}
                back={undone}
                fns={fns}
              />
            )
          }}
        />
      ) : (
        <div className="mbl-empty" data-bench-scroll="mods">
          <McItem name="barrier" size={24} />
          <b>{query ? 'Ничего не нашлось' : filter === 'off' ? 'Всё включено' : filter === 'warn' ? 'Проблем нет' : filter === 'changed' ? 'Изменений нет' : 'Модов пока нет'}</b>
          {query ? (
            <button
              type="button"
              className="btn sm secondary"
              onClick={() => {
                useMilli.setState((s) => ({ restore: { text: 'Добавь мод: ' + query, seq: s.restore.seq + 1 }, focusSeq: s.focusSeq + 1 }))
              }}
            >
              Спросить Милли
            </button>
          ) : filter !== 'all' ? (
            <button type="button" className="btn sm secondary" onClick={() => setUi({ filter: 'all' })}>
              Показать все
            </button>
          ) : null}
        </div>
      )}

      {selecting ? (
        <div className="bulk-float mbl-bulk" role="toolbar" aria-label="Выбранные моды">
          <b>{selected.size}</b>
          {selOn.length ? (
            <button type="button" className="btn sm secondary" data-track="milli_bulk_remove" onClick={bulkRemove}>
              Выключить
            </button>
          ) : null}
          {selOff.length ? (
            <button type="button" className="btn sm secondary" data-track="milli_bulk_restore" onClick={bulkRestore}>
              Включить
            </button>
          ) : null}
          <button type="button" className="btn sm primary" data-track="milli_bulk_ask" onClick={askMilli}>
            Спросить Милли
          </button>
          <button type="button" className="mpc-x" aria-label="Снять выбор" onClick={() => setSelected(new Set())}>
            <PxIcon name="x" size={12} />
          </button>
        </div>
      ) : null}

      {tip.tip ? (
        <MilliModTip
          tip={tip.tip}
          mc={head.mcVersion}
          loader={loader}
          rel={rel(tip.tip.m)}
          keep={tip.keep}
          hide={tip.hide}
          close={tip.close}
          onToggle={() => {
            const t = tip.tip
            if (!t || !t.canToggle) return
            toggle(t.m, !t.on)
            tip.sync({ on: !t.on })
          }}
          onOpen={() => {
            const t = tip.tip
            if (t) openMod(t.m)
          }}
        />
      ) : null}
    </div>
  )
}

const rowH = (r: BenchRow) => r.h
const rowKey = (r: BenchRow) => r.key
const rowPid = (r: BenchRow) => r.item?.projectId
