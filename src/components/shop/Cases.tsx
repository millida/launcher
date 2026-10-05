import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { Chest3D } from '../daily/Chest3D'
import { ChestLive } from '../daily/ChestLive'
import type { ChestTier } from '../../lib/rubies'
import { loadCaseContents, newRequestId, openCase, type CaseContents, type CaseOpened, type CaseView, type ItemRef, type SetTheme } from '../../lib/rubies'
import { playSound } from '../../lib/sound'
import { ItemArt, Price, toneStyle } from './parts'
import { PxThumb, THEME_TONE } from './Sets'
import { RarityFx, RarityPlate } from './rarityUi'
import { RARITY_NAME_PLURAL, RARITY_TONE } from './rarity'

/**
 * Ящики (02.10.2026; в коде case*, в интерфейсе «Ящик» — слово владельца): тема из нескольких наборов, выпадает случайная вещь темы,
 * которой у игрока ещё нет. Раз в `pity` открытий — эпическая или выше. Проценты
 * игроку не показываются: только редкость, что выпадает чаще всего. Открытие — сундук трясётся, лента вещей едет и встаёт на
 * вещи из ответа службы. Анимация — только transform и opacity.
 */

const CHEST: Record<SetTheme, ChestTier> = { flame: 'LEGEND', dark: 'EPIC', future: 'RARE', cozy: 'COMMON' }
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const caseTitle = (c: CaseView) => 'Ящик «' + c.title + '»'

function Chest({ theme }: { theme: SetTheme }) {
  return (
    <span className="cs-cover-chest">
      <ChestLive ready={false} tier={CHEST[theme] ?? 'COMMON'} size={112} look="model" />
    </span>
  )
}

function CaseCard({ view, balance, busy, onContents, onOpen }: { view: CaseView; balance: number; busy: boolean; onContents: () => void; onOpen: () => void }) {
  const theme = view.id as SetTheme
  const done = view.left <= 0
  const often = view.odds.reduce<CaseView['odds'][number] | null>((top, o) => (o.weight > 0 && (!top || o.weight > top.weight) ? o : top), null)
  return (
    <div className="sh-card cs-card" style={{ ['--sh-tone' as string]: THEME_TONE[theme] }} data-kind="case" data-id={view.id}>
      <div className="cs-cover">
        <span className="cs-cover-items">
          {view.cover.map((it) => (
            <span key={it.code} className="cs-cover-i">
              <PxThumb item={it} />
            </span>
          ))}
        </span>
        <Chest theme={theme} />
      </div>
      <b className="cs-name">{caseTitle(view)}</b>
      {often ? <span className="cs-often">Чаще всего — {RARITY_NAME_PLURAL[often.rarity]}</span> : null}
      <span className="cs-got">
        Собрано {view.total - view.left} из {view.total}
      </span>
      <span className="cs-foot">
        <Price price={view.price} />
        <button className="btn sm secondary" data-track="case_contents" onClick={onContents}>
          Состав
        </button>
        <button className={'btn sm ' + (view.price > balance ? 'secondary' : 'primary')} disabled={busy || done} data-track="case_open" onClick={onOpen}>
          {done ? 'Всё собрано' : 'Открыть'}
        </button>
      </span>
    </div>
  )
}

/** Вкладка «Кейсы»: четыре карточки и строка про честность внизу. */
export function CasesTab({ cases, balance, busy, onOpen }: { cases: CaseView[] | null; balance: number; busy: boolean; onOpen: (c: CaseView) => void }) {
  const [look, setLook] = useState<CaseView | null>(null)
  if (!cases)
    return (
      <div className="cs-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="skel cs-skel" />
        ))}
      </div>
    )
  return (
    <div className="cs-tab">
      <div className="cs-grid">
        {cases.map((c) => (
          <CaseCard key={c.id} view={c} balance={balance} busy={busy} onContents={() => setLook(c)} onOpen={() => onOpen(c)} />
        ))}
      </div>
      <p className="cs-fine">Выпадает только то, чего у тебя нет.</p>
      {look ? <ContentsModal view={look} onClose={() => setLook(null)} /> : null}
    </div>
  )
}

/** Состав кейса: все вещи темы и шанс каждой, свои помечены. */
function ContentsModal({ view, onClose }: { view: CaseView; onClose: () => void }) {
  const [data, setData] = useState<CaseContents | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    loadCaseContents(view.id).then(setData).catch(() => setFailed(true))
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [view.id, onClose])
  return createPortal(
    <div className="modal-bg open vis st-bg" onClick={onClose}>
      <div className="modal mw-xl st-modal" style={{ ['--sh-tone' as string]: THEME_TONE[view.id as SetTheme] }} role="dialog" aria-label={caseTitle(view)} onClick={(e) => e.stopPropagation()}>
        <button className="st-x btn sm ghost" aria-label="Закрыть" data-track="case_close" onClick={onClose}>
          <Icon id="i-x" />
        </button>
        <div className="st-m-head">
          <h3>{caseTitle(view)}</h3>
        </div>
        {failed ? (
          <div className="st-empty">
            <b>Состав не загрузился</b>
            <button className="btn sm secondary" onClick={() => (setFailed(false), loadCaseContents(view.id).then(setData).catch(() => setFailed(true)))}>
              Повторить
            </button>
          </div>
        ) : !data ? (
          <div className="st-m-grid" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="skel st-skel-tile" />
            ))}
          </div>
        ) : (
          <div className="st-m-grid">
            {data.items.map((x) => (
              <div key={x.item.code} className={'sh-card is-show st-tile' + (x.owned ? ' is-owned' : '')} style={toneStyle(x.item)} data-rar={x.item.rarity}>
                <RarityFx />
                <ItemArt item={x.item} />
                <b className="sh-card-name">{x.item.name}</b>
                <span className="sh-card-meta">
                  <RarityPlate rarity={x.item.rarity} small />
                </span>
                <span className="sh-card-foot">
                  {x.owned ? (
                    <span className="sh-owned sm">
                      <Icon id="i-check" />
                      Есть
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/* ── Открытие ────────────────────────────────────────────────────────────── */

const SHAKE_MS = 1000
const SPIN_MS = 4200
const TILE = 112
const WIN_AT = 36
const TAIL = 8

type Phase = 'shake' | 'spin' | 'flash' | 'result'

/**
 * Оверлей открытия. Запрос уходит в начале анимации: пока сундук трясётся,
 * служба уже ответила. Ошибка (нет рубинов и т.п.) прерывает анимацию через
 * `onFail`. «Пропустить» и Esc — сразу к результату; без анимации (reduced
 * motion) результат показывается, как только пришёл ответ.
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
  view: CaseView
  balance: number
  onBalance: (n: number) => void
  onFail: (e: unknown) => void
  /** Открытие завершено: обновить список кейсов. */
  onDone: () => void
  onClose: () => void
  onWear: (item: ItemRef) => void
}) {
  const [phase, setPhase] = useState<Phase>('shake')
  const [res, setRes] = useState<CaseOpened | null>(null)
  const [strip, setStrip] = useState<ItemRef[]>([])
  const [shift, setShift] = useState(0)
  const [run, setRun] = useState(0)
  const pool = useRef<ItemRef[]>([])
  const skipped = useRef(false)
  const viewport = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  const alive = useRef(true)
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const theme = view.id as SetTheme

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      timers.current.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  const toResult = useCallback(() => {
    setPhase('flash')
    playSound('open')
    timers.current.push(window.setTimeout(() => alive.current && setPhase('result'), reduced() ? 0 : 420))
  }, [])

  useEffect(() => {
    skipped.current = false
    setRes(null)
    setPhase('shake')
    setShift(0)
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    const calm = reduced()
    if (!calm) playSound('open')
    const req = openCase(view.id, newRequestId())
    const wait = new Promise<void>((ok) => later(ok, calm ? 0 : SHAKE_MS))
    const items = pool.current.length ? Promise.resolve(pool.current) : loadCaseContents(view.id).then((c) => (pool.current = c.items.map((x) => x.item)))
    req.then(
      async (got) => {
        if (!alive.current) return
        setRes(got)
        onBalance(got.balance)
        const list = await items.catch(() => [] as ItemRef[])
        await wait
        if (!alive.current) return
        if (calm || skipped.current || !list.length) return toResult()
        const rnd = (): ItemRef => list[Math.floor(Math.random() * list.length)]!
        const next = Array.from({ length: WIN_AT + TAIL }, (_, i) => (i === WIN_AT ? got.item : rnd()))
        setStrip(next)
        setPhase('spin')
        // Лента стартует после отрисовки: ширина окна известна, стоп — в середине плитки с лёгким промахом от центра.
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!alive.current) return
            const vw = viewport.current?.clientWidth ?? 800
            const jitter = Math.round((Math.random() - 0.5) * (TILE - 40))
            setShift(WIN_AT * TILE + TILE / 2 - vw / 2 + jitter)
          }),
        )
        later(() => toResult(), SPIN_MS + 250)
      },
      (e) => alive.current && onFail(e),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  const skip = useCallback(() => {
    skipped.current = true
    if (res && (phase === 'shake' || phase === 'spin')) {
      timers.current.forEach((t) => window.clearTimeout(t))
      toResult()
    }
  }, [res, phase, toResult])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (phase === 'result') onClose()
      else skip()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [phase, skip, onClose])

  useEffect(() => {
    if (phase === 'result') onDone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const again = () => {
    if (view.price > balance) return onFail('insufficient')
    setRun((n) => n + 1)
  }
  const item = res?.item
  const reel = phase === 'spin' || phase === 'flash'
  return createPortal(
    <div className={'cs-o ph-' + phase} role="status" aria-label="Открытие ящика" style={{ ['--sh-tone' as string]: THEME_TONE[theme] }}>
      {phase !== 'result' ? (
        <button className="btn sm secondary cs-skip" data-track="case_skip" onClick={skip}>
          Пропустить
        </button>
      ) : (
        <button className="btn sm ghost cs-skip" aria-label="Закрыть" data-track="case_close" onClick={onClose}>
          <Icon id="i-x" />
        </button>
      )}
      {phase === 'shake' ? (
        <div className="cs-stage">
          <Chest3D tier={CHEST[theme] ?? 'COMMON'} mode="open" framing="reveal" look="model" flatSize={240} />
        </div>
      ) : null}
      {reel ? (
        <div className="cs-reel" ref={viewport}>
          <i className="cs-mark" aria-hidden="true" />
          <div className="cs-strip" style={{ transform: 'translate3d(' + -shift + 'px,0,0)', transitionDuration: shift ? SPIN_MS + 'ms' : '0ms' }}>
            {strip.map((it, i) => (
              <div key={i} className={'sh-card cs-tile' + (i === WIN_AT ? ' is-win' : '')} style={toneStyle(it)} data-rar={it.rarity}>
                <PxThumb item={it} />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {phase === 'flash' ? <i className="cs-flash" aria-hidden="true" style={{ ['--flash' as string]: item ? RARITY_TONE[item.rarity] : 'var(--m-fg)' }} /> : null}
      {phase === 'result' && item && res ? (
        <div className={'cs-res' + (res.top ? ' is-top' : '')} style={toneStyle(item)} data-rar={item.rarity}>
          <RarityFx />
          <ItemArt item={item} size="lg" />
          <b className="cs-res-name">{item.name}</b>
          <span className="cs-res-rar">{res.rarityName}</span>
          <span className="cs-res-acts">
            <button className="btn md primary" data-track="case_wear" onClick={() => onWear(item)}>
              Надеть
            </button>
            <button className={'btn md ' + (view.price > balance ? 'secondary' : 'primary')} data-track="case_again" onClick={again}>
              Ещё раз
              <Ruby size={14} />
              {view.price.toLocaleString('ru-RU')}
            </button>
          </span>
        </div>
      ) : null}
    </div>,
    document.body,
  )
}
