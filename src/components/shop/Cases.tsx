import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { ChestLive } from '../daily/ChestLive'
import type { ChestTier, Rarity } from '../../lib/rubies'
import { loadCaseContents, newRequestId, openCase, opensOf, type CaseContents, type CaseDrop, type CaseView, type ItemRef } from '../../lib/rubies'
import { Head as SecHead, Shard, toneStyle } from './parts'
import { Head } from '../Head'
import { DayClock, OffBadge } from './SetsV2'
import { PxThumb } from './Sets'
import { RARITY_TONE, rarityRank } from './rarity'
import { useVirtualRows } from './useVirtualRows'
import { ItemShot } from './Today'
import { ChestPop } from '../chest/ChestPop'
import { CaseReveal, type RevealData } from '../chest/CaseReveal'
import { caseCoins, prizeRanges } from './casePrizes'
import { useOffscreenPause } from './useOffscreen'

/**
 * Ящики (02.10.2026; в коде case*, в интерфейсе «Ящик» — слово владельца): тема из нескольких наборов, выпадает случайная вещь темы,
 * которой у игрока ещё нет. Раз в `pity` открытий — эпическая или выше. Проценты
 * игроку не показываются: только редкость, что выпадает чаще всего. Открытие — сундук трясётся, лента вещей едет и встаёт на
 * вещи из ответа службы. Анимация — только transform и opacity.
 */

/**
 * Сундук ящика: одна из трёх моделей (медь, алмаз, обсидиан), перекрашенная в
 * цвет ящика прямо в текстуре (bbModel.tintPixels) — у всех восьми один
 * стиль. Без своего цвета — модель как есть.
 */
// Сетка 4×2: соседи по ряду и по столбцу — разные модели (Д — алмаз, О — обсидиан, М — медь):
// Пламя Д · Тьма О · Будущее Д · Уют М / Крылья М · Питомцы Д · Эмоции О · Мифический Д.
const CHEST: Record<string, { tier: ChestTier; tint?: string }> = {
  shards: { tier: 'COMMON', tint: '#e9eeff' },
  flame: { tier: 'RARE', tint: '#ff6a1a' },
  dark: { tier: 'EPIC' },
  future: { tier: 'RARE' },
  cozy: { tier: 'COMMON' },
  wings: { tier: 'COMMON', tint: '#e9eeff' },
  pets: { tier: 'RARE', tint: '#ffc93d' },
  emotes: { tier: 'EPIC', tint: '#ff5fa8' },
  mythic: { tier: 'RARE', tint: '#ff2d55' },
}
const chestOf = (id: string) => CHEST[id] ?? { tier: 'COMMON' as ChestTier }

export const caseTitle = (c: CaseView) => 'Ящик «' + c.title + '»'
/** Цвет ящика для подложки и тона: RRGGBB от службы → #rrggbb. */
export const caseHex = (c: CaseView) => '#' + (c.color || '8B8B8B').replace('#', '')
const tint = (c: CaseView): CSSProperties => ({ ['--sh-tone' as string]: caseHex(c), ['--cs' as string]: caseHex(c) })


/** Состав ящика: один запрос на ящик за сеанс, неудача не запоминается. */
const contentsAsk = new Map<string, Promise<CaseContents>>()
export function caseContents(id: string): Promise<CaseContents> {
  const hit = contentsAsk.get(id)
  if (hit) return hit
  const p = loadCaseContents(id)
  contentsAsk.set(id, p)
  p.catch(() => contentsAsk.delete(id))
  return p
}

/**
 * Разнообразие вместо расцветок: одна вещь — один раз (по базовому коду,
 * «КОД~расцветка» → «КОД»), и соседние — из разных мест на теле, по кругу.
 * Иначе лента показывала одни крылья в трёх цветах.
 */
export function variety(items: ItemRef[]): ItemRef[] {
  const seen = new Set<string>()
  const bySlot = new Map<string, ItemRef[]>()
  for (const it of items) {
    const base = it.code.split('~')[0]!
    if (seen.has(base)) continue
    seen.add(base)
    const list = bySlot.get(it.slot) ?? []
    list.push(it)
    bySlot.set(it.slot, list)
  }
  const lanes = [...bySlot.values()]
  const out: ItemRef[] = []
  for (let i = 0; out.length < seen.size; i++) for (const lane of lanes) if (lane[i]) out.push(lane[i]!)
  return out
}

/** Пул вещей ящика для «что выпадает»: сначала обложка, потом весь состав. */
function usePool(view: CaseView): ItemRef[] {
  const [pool, setPool] = useState<ItemRef[]>(() => variety(view.cover))
  useEffect(() => {
    let alive = true
    caseContents(view.id)
      .then((c) => alive && c.items.length && setPool(variety([...view.cover, ...c.items.map((x) => x.item)])))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [view.id])
  return pool
}

/**
 * Сундук ящика своего цвета: на карточке, в герое и в окне покупки. `pop` —
 * из него по очереди выскакивают вещи пула (ChestPop), `delay` разводит
 * карточки во времени.
 */
export function CaseArt({ view, size = 150, pop, delay = 0 }: { view: CaseView; size?: number; pop?: boolean; delay?: number }) {
  const c = chestOf(view.id)
  const pool = usePool(view)
  const chest = <ChestLive ready tier={c.tier} tint={c.tint} size={size} look="model" />
  return (
    <span className="cs3-art" style={tint(view)}>
      {pop ? (
        <ChestPop items={pool} coins={caseCoins(view)} delay={delay}>
          {chest}
        </ChestPop>
      ) : (
        chest
      )}
    </span>
  )
}

/** Чья гарантия: «Гарант эпической 7/15» (как «Прогресс гаранта 7/20» у OneBlock). */
const PITY_OF: Partial<Record<Rarity, string>> = { RARE: 'редкой', EPIC: 'эпической', LEGENDARY: 'легендарной', MYTHIC: 'мифической' }

/**
 * Счётчик гарантии: подпись с числами и тонкая полоса по делениям — одно деление
 * на открытие. Заполнена — следующее открытие гарантированно `pityFrom` и выше.
 */
function PityBar({ view }: { view: CaseView }) {
  if (view.pity <= 1) return null
  const done = Math.max(0, Math.min(view.pity, view.pity - view.pityLeft))
  const now = view.pityLeft <= 1
  const on = now ? view.pity : done
  return (
    <span
      className={'cs3-pity2' + (now ? ' is-now' : '')}
      style={{ ['--pt' as string]: RARITY_TONE[view.pityFrom] }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={view.pity}
      aria-valuenow={done}
      aria-label={'Гарант ' + (PITY_OF[view.pityFrom] ?? '')}
    >
      <span className="cs3-pity2-t">
        <b>{now ? 'Гарант сейчас' : 'Гарант ' + (PITY_OF[view.pityFrom] ?? '')}</b>
        <i>{(now ? view.pity : done) + '/' + view.pity}</i>
      </span>
      <span className="cs3-segs" style={{ ['--n' as string]: view.pity }}>
        {Array.from({ length: view.pity }, (_, i) => (
          <i key={i} className={i < on ? 'on' : ''} />
        ))}
      </span>
    </span>
  )
}

/** Гарантия в каждом ящике чипом цвета редкости: «Редкая+ в каждом». Старая служба не шлёт — чипа нет. */
function GuaranteeChip({ view }: { view: CaseView }) {
  const g = view.guarantee
  if (!g) return null
  return (
    <span className="cs3-guar" data-rar={g.minRarity} style={{ ['--g' as string]: RARITY_TONE[g.minRarity] }}>
      {g.label.replace(/ ящике$/, '')}
    </span>
  )
}

/** Как открыть: один ящик, десять за девять цен или бесплатный первый. */
export type CaseMode = 'one' | 'x10' | 'free'
/** Ящик в окне открытия: сам ящик и как его открыли. */
export type CaseRun = CaseView & { mode?: CaseMode }
/** Цена открытия этим способом. */
export const casePriceOf = (c: CaseView, mode: CaseMode = 'one') => (mode === 'free' ? 0 : mode === 'x10' && c.multi ? c.multi.price : c.price)

/** ×10: «×10 ◆6 210 6 900» — цена за девять, десять цен зачёркнуто. */
function MultiPrice({ view, balance, busy, onOpen }: { view: CaseView; balance: number; busy: boolean; onOpen: () => void }) {
  const m = view.multi
  if (!m) return null
  return (
    <button className={'btn md ' + (m.price > balance ? 'secondary' : 'primary') + ' sv-pbtn cs3-x10'} disabled={busy || view.left <= 0} data-track="case_open_x10" onClick={onOpen}>
      <b className="cs3-x10-n">×{m.count}</b>
      <Ruby size={16} />
      {m.price.toLocaleString('ru-RU')}
      {m.basePrice > m.price ? <s className="sv-was">{m.basePrice.toLocaleString('ru-RU')}</s> : null}
    </button>
  )
}

/** Карточка ящика: большой сундук своего цвета, имя, кнопка цены; шансы — (i) в углу. */
/** Кнопка цены ящика; подписчику — зачёркнутая цена без скидки рядом. */
function CasePrice({ view, balance, busy, sub, size = 'md', onOpen }: { view: CaseView; balance: number; busy: boolean; sub?: boolean; size?: 'md' | 'lg'; onOpen: () => void }) {
  const done = view.left <= 0
  return (
    <button className={'btn ' + size + ' ' + (view.price > balance ? 'secondary' : 'primary') + ' sv-pbtn'} disabled={busy || done} data-track="case_open" onClick={onOpen}>
      {done ? <Icon id="i-check" /> : view.currency === 'shards' ? <Shard size={size === 'lg' ? 22 : 16} /> : <Ruby size={size === 'lg' ? 22 : 16} />}
      {done ? null : view.price.toLocaleString('ru-RU')}
      {!done && sub && view.basePrice > view.price ? <s className="sv-was">{view.basePrice.toLocaleString('ru-RU')}</s> : null}
    </button>
  )
}

/** Ящик дня в первом экране: большой сундук на своей сцене, −30%, часы, цена. */
export function HeroCase({ view, balance, busy, sub, refreshAt, ofDayPct, onOpen }: { view: CaseView; balance: number; busy: boolean; sub?: boolean; refreshAt?: string; ofDayPct: number; onOpen: () => void }) {
  return (
    <div className="card cs3-hero" style={tint(view)} data-kind="case_day" data-id={view.id}>
      <button className="cs3-hero-stage" aria-label={caseTitle(view)} data-track="case_hero" disabled={busy} onClick={onOpen}>
        <span className="sv-scene cs3-scene" aria-hidden="true">
          <i className="sv-rays" />
          <i className="sv-glow" />
        </span>
        <CaseArt view={view} size={230} pop />
      </button>
      <span className="sv-corner">
        <span className="sv-daytag">Ящик дня</span>
        <OffBadge pct={ofDayPct} />
        {refreshAt ? <DayClock to={refreshAt} /> : null}
      </span>
      <div className="sv-stand-foot">
        <b className="sv-stand-name">{view.title}</b>
        <CasePrice view={view} balance={balance} busy={busy} sub={sub} size="lg" onOpen={onOpen} />
      </div>
    </div>
  )
}

function CaseCard({
  view,
  at,
  balance,
  busy,
  sub,
  free,
  refreshAt,
  ofDayPct,
  onOdds,
  onOpen,
}: {
  view: CaseView
  at: number
  balance: number
  busy: boolean
  sub?: boolean
  /** На этой карточке — бесплатный первый ящик. */
  free?: boolean
  refreshAt?: string
  ofDayPct: number
  onOdds: () => void
  onOpen: (mode?: CaseMode) => void
}) {
  const done = view.left <= 0
  return (
    <div className={'sh-card cs3' + (view.ofDay ? ' is-day' : '') + (free ? ' is-free' : '')} style={tint(view)} data-kind="case" data-id={view.id}>
      <button className="cs3-stage" aria-label={caseTitle(view)} data-track="case_pick" disabled={busy || done} onClick={() => onOpen(free ? 'free' : 'one')}>
        <CaseArt view={view} size={150} pop delay={(at * 325) % 1300} />
      </button>
      <button className="cs3-info is-left" aria-label="Что внутри" data-track="case_contents" onClick={onOdds}>
        <Icon id="i-eye" />
      </button>
      <span className="sv-corner">
        {view.ofDay ? <OffBadge pct={ofDayPct} /> : null}
        {view.ofDay && refreshAt ? <DayClock to={refreshAt} /> : null}
      </span>
      <GuaranteeChip view={view} />
      <b className="cs3-name">{view.title}</b>
      <PityBar view={view} />
      {free ? (
        <span className="cs3-foot is-one">
          <span className="cs3-free">
            <button className="btn md primary" disabled={busy || done} data-track="case_free" onClick={() => onOpen('free')}>
              <Icon id="i-gift" />
              Открыть бесплатно
            </button>
          </span>
        </span>
      ) : (
        <span className={'cs3-foot' + (view.multi ? '' : ' is-one')}>
          <CasePrice view={view} balance={balance} busy={busy} sub={sub} onOpen={() => onOpen('one')} />
          <MultiPrice view={view} balance={balance} busy={busy} onOpen={() => onOpen('x10')} />
        </span>
      )}
    </div>
  )
}

/** Лента последних выпадений: голова, ник, картинка вещи. Движется только transform. */
export function DropsTicker({ drops }: { drops: CaseDrop[] }) {
  if (!drops.length) return null
  const row = (k: string) =>
    drops.map((d, i) => (
      <span key={k + i} className="cs2-drop" style={toneStyle(d.item)}>
        <Head nick={d.nick} size={28} className="cs3-drop-head" />
        <b>{d.nick}</b>
        <span className="cs2-drop-art">
          <PxThumb item={d.item} />
        </span>
      </span>
    ))
  return (
    <div className="cs2-ticker" aria-label="Недавние выпадения">
      <div className="cs2-ticker-track" style={{ ['--n' as string]: drops.length }}>
        {row('a')}
        <span aria-hidden="true" className="cs2-ticker-dup">
          {row('b')}
        </span>
      </div>
    </div>
  )
}

/** Раздел «Ящики»: восемь карточек и лента выпадений под сеткой. */
export function CasesSection({
  cases,
  drops,
  refreshAt,
  ofDayPct,
  balance,
  busy,
  sub,
  onOpen,
}: {
  cases: CaseView[] | null
  drops: CaseDrop[]
  refreshAt?: string
  ofDayPct: number
  balance: number
  busy: boolean
  sub?: boolean
  onOpen: (c: CaseView, mode?: CaseMode) => void
}) {
  const [look, setLook] = useState<CaseView | null>(null)
  const paused = useOffscreenPause<HTMLElement>()
  // Бесплатный первый ящик — на одной карточке: ящик дня, если подходит, иначе первый подходящий.
  const freeId = cases ? (cases.find((c) => c.ofDay && c.freeAvailable) ?? cases.find((c) => c.freeAvailable))?.id : undefined
  return (
    <section id="shop-cases" className="sv-sec" data-section="cases" ref={paused}>
      <SecHead title="Ящики" />
      {!cases ? (
        <div className="cs2-grid" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="skel cs2-skel" />
          ))}
        </div>
      ) : (
        <>
          <div className="cs2-grid">
            {cases.map((c, i) => (
              <CaseCard
                key={c.id}
                at={i}
                view={c}
                balance={balance}
                busy={busy}
                sub={sub}
                free={c.id === freeId}
                refreshAt={refreshAt}
                ofDayPct={ofDayPct}
                onOdds={() => setLook(c)}
                onOpen={(mode) => onOpen(c, mode)}
              />
            ))}
          </div>
          <DropsTicker drops={drops} />
        </>
      )}
      {look ? <ContentsModal view={look} onClose={() => setLook(null)} /> : null}
    </section>
  )
}

type Way = CaseContents['items'][number]
/** Вещь «Что внутри»: одна плитка на базовую вещь, расцветки — кружками. */
interface Group {
  base: string
  ways: Way[]
  rank: number
}

/** Группы по базовому коду, от самых редких; внутри — расцветки по порядку службы. */
export function groupContents(items: Way[]): Group[] {
  const map = new Map<string, Group>()
  for (const w of items) {
    const base = w.item.code.split('~')[0]!
    const g = map.get(base) ?? { base, ways: [], rank: 0 }
    g.ways.push(w)
    g.rank = Math.max(g.rank, rarityRank(w.item.rarity))
    map.set(base, g)
  }
  return [...map.values()].sort((x, y) => y.rank - x.rank || y.ways.length - x.ways.length)
}

/** Кружков расцветок в плитке: дальше — «+N», плитки одной высоты (виртуальная сетка). */
const DOTS = 6

/** Плитка группы: картинка выбранной расцветки, слово редкости, имя, кружки расцветок. */
function GroupTile({ g, big }: { g: Group; big?: boolean }) {
  const [at, setAt] = useState(0)
  const way = g.ways[at] ?? g.ways[0]!
  const all = g.ways.every((w) => w.owned)
  return (
    <div className={'cs4-tile' + (big ? ' is-big' : '') + (all ? ' is-owned' : '')} style={toneStyle(way.item)} data-rar={way.item.rarity}>
      <span className="cs4-pic">
        <ItemShot key={way.item.code} item={way.item} big={big} flatEffects />
      </span>
      <b className="cs4-name">{way.item.name}</b>
      {g.ways.length > 1 ? (
        <span className="cs4-dots" role="radiogroup" aria-label="Расцветки">
          {g.ways.slice(0, DOTS).map((w, i) => (
            <button
              key={w.item.code}
              role="radio"
              aria-checked={i === at}
              aria-label={w.item.name + (w.owned ? ', есть' : '')}
              className={'cs4-dot' + (i === at ? ' on' : '') + (w.owned ? ' is-own' : '')}
              style={{ ['--dot' as string]: w.item.color ? '#' + w.item.color.replace('#', '') : RARITY_TONE[w.item.rarity] }}
              onClick={() => setAt(i)}
            >
              {w.owned ? <Icon id="i-check" /> : null}
            </button>
          ))}
          {g.ways.length > DOTS ? (
            // Остальные расцветки — по кругу одной кнопкой: ряд кружков всегда в одну строку.
            <button className="cs4-more" aria-label="Следующая расцветка" onClick={() => setAt((i) => (i + 1 < DOTS ? DOTS : i + 1) % g.ways.length)}>
              {at >= DOTS ? at + 1 + '/' + g.ways.length : '+' + (g.ways.length - DOTS)}
            </button>
          ) : null}
        </span>
      ) : null}
      {all ? (
        <span className="cs4-own" aria-label="Есть">
          <Icon id="i-check" />
        </span>
      ) : null}
    </div>
  )
}

/** Остальные вещи «Что внутри»: виртуальная сетка — в DOM только видимые ряды (у «Осколочного» сотни вещей). */
function RestGrid({ groups }: { groups: Group[] }) {
  const v = useVirtualRows(groups.length, { minCol: 160, gap: 10 })
  return (
    <div ref={v.ref} className="cs4-grid" style={{ paddingTop: v.padTop, paddingBottom: v.padBottom }}>
      {groups.slice(v.from, v.to).map((g) => (
        <GroupTile key={g.base} g={g} />
      ))}
    </div>
  )
}

/**
 * «Что внутри» (владелец 06.10.2026): компактно — одна плитка на вещь, её
 * расцветки кружками (нажал — плитка показывает эту расцветку, свои отмечены),
 * плотная сетка одинаковых плиток, первый ряд чуть крупнее, от самых редких.
 * Сверху — что бывает вместо вещи: утешительный приз осколками или рубинами.
 */
function ContentsModal({ view, onClose }: { view: CaseView; onClose: () => void }) {
  const [data, setData] = useState<CaseContents | null>(null)
  const [failed, setFailed] = useState(false)
  const load = () => {
    setFailed(false)
    caseContents(view.id).then(setData).catch(() => setFailed(true))
  }
  useEffect(() => {
    load()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [view.id, onClose])
  const groups = data ? groupContents(data.items) : []
  const consolation = data?.consolation ?? view.consolation ?? []
  return createPortal(
    <div className="modal-bg open vis st-bg" onClick={onClose}>
      <div className="modal mw-xl st-modal cs4" style={tint(view)} role="dialog" aria-label={caseTitle(view)} onClick={(e) => e.stopPropagation()}>
        <button className="st-x btn sm ghost" aria-label="Закрыть" data-track="case_close" onClick={onClose}>
          <Icon id="i-x" />
        </button>
        <div className="cs4-head">
          {/* Без вылета вещей: в шапке окна они обрезались о верхний край. */}
          <CaseArt view={view} size={72} />
          <h3>{view.title}</h3>
        </div>
        {consolation.length ? (
          <span className="cs4-miss">
            Не повезло — всё равно {view.cheapItem || data?.items.length ? 'шмотка +' : ''}
            {prizeRanges(consolation).map((c, i) => (
              <span key={c.kind} className="cs4-miss-it">
                {i ? <i>/</i> : null}
                {c.kind === 'rubies' ? <Ruby size={18} /> : <Shard size={18} />}
                {c.kind === 'rubies' ? 'рубины' : 'осколки'} {c.min === c.max ? c.min : c.min + '–' + c.max}
              </span>
            ))}
          </span>
        ) : null}
        {failed ? (
          <div className="st-empty">
            <button className="btn sm secondary" onClick={load}>
              Повторить
            </button>
          </div>
        ) : !data ? (
          <div className="cs4-grid" aria-hidden="true">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className="skel cs4-skel" />
            ))}
          </div>
        ) : (
          <div className="cs4-body">
            <div className="cs4-top">{groups.slice(0, 4).map((g) => <GroupTile key={g.base} g={g} big />)}</div>
            <RestGrid groups={groups.slice(4)} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ── Открытие: общий CaseReveal (components/chest) ──────────────────────── */

/** Пол лестницы редкости: гарантия ящика; бесплатный первый — не ниже редкой (служба). */
function floorOf(view: CaseView, mode: CaseMode): Rarity | undefined {
  const g = view.guarantee?.minRarity
  if (!g) return undefined
  return mode === 'free' && rarityRank(g) < rarityRank('RARE') ? 'RARE' : g
}

/**
 * Открытие ящика: удары по огромному сундуку (свечение растёт от гарантии до
 * выпавшей редкости), взрыв, награды по одной и итог. ×10 — десять карт.
 * «Ещё раз» — новое открытие тем же способом (после бесплатного — обычное).
 */
export function CaseOpening({
  view,
  balance,
  onBalance,
  onFail,
  onDone,
  onClose,
  onWear,
}: {
  view: CaseRun
  balance: number
  onBalance: (n: number) => void
  onFail: (e: unknown) => void
  /** Открытие завершено: обновить список кейсов. */
  onDone: () => void
  onClose: () => void
  onWear: (item: ItemRef) => void
}) {
  const [run, setRun] = useState(0)
  const [mode, setMode] = useState<CaseMode>(view.mode ?? 'one')
  const c = chestOf(view.id)
  const shards = view.currency === 'shards'
  const nextMode: CaseMode = mode === 'free' ? 'one' : mode
  const nextPrice = casePriceOf(view, nextMode)
  return (
    <CaseReveal
      key={run}
      title={view.title}
      tier={c.tier}
      tint={c.tint}
      color={caseHex(view)}
      floor={floorOf(view, mode)}
      deal={mode === 'x10'}
      early
      request={(): Promise<RevealData> =>
        openCase(view.id, newRequestId(), mode === 'x10' ? { count: 10 } : mode === 'free' ? { free: true } : {}).then((r) => {
          onBalance(r.balance)
          return { opens: opensOf(r) }
        })
      }
      again={{
        primary: nextPrice <= balance,
        onClick: () => {
          if (nextPrice > balance) return onFail('insufficient')
          setMode(nextMode)
          setRun((n) => n + 1)
        },
        node: (
          <>
            {nextMode === 'x10' ? 'Ещё ×10' : 'Ещё раз'}
            {shards ? <Shard size={18} /> : <Ruby size={18} />}
            {nextPrice.toLocaleString('ru-RU')}
          </>
        ),
      }}
      onFail={onFail}
      onDone={onDone}
      onClose={onClose}
      onWear={onWear}
    />
  )
}
