import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { playSound } from '../../lib/sound'

/**
 * Одно окно подтверждения на любую покупку магазина (ТЗ v3, 06.10.2026):
 * вещь, набор, ящик, пакет, PLUS. Большая картинка того, что получишь, кнопка
 * с ценой и «Отмена». После оплаты в том же окне — результат (набор на
 * персонаже со вспышкой, рубины досчитываются), потом окно закрывается само.
 *
 * `run` бросает ошибку — окно закрывается, ошибку показывает вызвавший (тост).
 * `run` вернул `null` — окно просто закрывается: результат покажет другой
 * экран (открытие ящика, страница оплаты PLUS).
 */
export interface SheetDone {
  /** Что показать после покупки; без него — та же картинка со вспышкой. */
  art?: ReactNode
  /** Рубины досчитываются от `from` до `to`. */
  rubies?: { from: number; to: number }
  /** «Надеть» под результатом. */
  onWear?: () => void
}

export interface SheetSpec {
  /** Метка для замеров: set / item / case / pack / plus / topup. */
  kind: string
  art: ReactNode
  /** Имя одной строкой (можно не давать, если картинка говорит сама). */
  name?: string
  /** Цвет подложки картинки. */
  tone?: string
  /** Содержимое главной кнопки: «Купить ◆1020», «199 ₽», «PLUS 299 ₽». */
  confirm: ReactNode
  run: () => Promise<SheetDone | null>
  /** Второй вариант под кнопками. */
  extra?: ReactNode
  /** Выбор из нескольких вариантов бок о бок (PLUS / Diamond): у каждого своя картинка и кнопка. */
  choices?: { key: string; art: ReactNode; confirm: ReactNode; tone?: string; run: () => Promise<SheetDone | null> }[]
  /** Закрыли, не нажав главную кнопку (замер воронки). */
  onCancel?: () => void
}

interface SheetState {
  spec: SheetSpec | null
  open: (spec: SheetSpec) => void
  close: () => void
}

export const useBuySheet = create<SheetState>((set) => ({
  spec: null,
  open: (spec) => set({ spec }),
  close: () => set({ spec: null }),
}))

export const openSheet = (spec: SheetSpec) => useBuySheet.getState().open(spec)

/** «Купить ◆1 020» — главная кнопка покупки за рубины. */
export function BuyLabel({ verb = 'Купить', price }: { verb?: string; price: number }) {
  return (
    <>
      {verb}
      <Ruby size={18} />
      {price.toLocaleString('ru-RU')}
    </>
  )
}

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Число рубинов досчитывается до нового баланса за ~0,9 с. */
function CountUp({ from, to }: { from: number; to: number }) {
  const [n, setN] = useState(reduced() ? to : from)
  useEffect(() => {
    if (reduced()) return setN(to)
    const start = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 900)
      setN(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [from, to])
  return (
    <span className="bs-count">
      <Ruby size={44} />
      <b>{n.toLocaleString('ru-RU')}</b>
    </span>
  )
}

/** Сколько висит результат, если человек его не трогает. */
const DONE_MS = 2600

export function BuySheetHost() {
  const spec = useBuySheet((s) => s.spec)
  const shut = useBuySheet((s) => s.close)
  const [phase, setPhase] = useState<'ask' | 'busy' | 'done'>('ask')
  const [done, setDone] = useState<SheetDone | null>(null)
  const hold = useRef(false)
  const timer = useRef(0)

  useEffect(() => {
    setPhase('ask')
    setDone(null)
    hold.current = false
    window.clearTimeout(timer.current)
  }, [spec])

  useEffect(() => {
    if (!spec) return
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      if (phase === 'ask') spec.onCancel?.()
      if (phase !== 'busy') shut()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [spec, phase, shut])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!spec) return null

  const close = () => {
    if (phase === 'ask') spec.onCancel?.()
    shut()
  }

  const autoClose = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (hold.current) return autoClose()
      shut()
    }, DONE_MS)
  }

  const buy = async (run: () => Promise<SheetDone | null> = spec.run) => {
    if (phase !== 'ask') return
    setPhase('busy')
    try {
      const res = await run()
      if (useBuySheet.getState().spec !== spec) return
      if (!res) return shut()
      playSound('open')
      setDone(res)
      setPhase('done')
      autoClose()
    } catch {
      if (useBuySheet.getState().spec === spec) shut()
    }
  }

  const isDone = phase === 'done'
  return createPortal(
    <div className="modal-bg open vis bs-bg" onClick={() => phase !== 'busy' && close()}>
      <div
        className={'modal bs' + (isDone ? ' is-done' : '') + (spec.choices ? ' is-choice' : '')}
        role="dialog"
        aria-label={spec.name || 'Покупка'}
        data-kind={'sheet_' + spec.kind}
        style={spec.tone ? { ['--sh-tone' as string]: spec.tone } : undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerEnter={() => (hold.current = true)}
        onPointerLeave={() => (hold.current = false)}
      >
        {spec.choices && !isDone ? (
          <div className="bs-choices">
            {spec.choices.map((c) => (
              <div key={c.key} className="bs-choice" style={c.tone ? { ['--sh-tone' as string]: c.tone } : undefined}>
                <div className="bs-art">{c.art}</div>
                <button className="btn lg primary bs-buy" disabled={phase === 'busy'} data-track={'sheet_buy_' + spec.kind + '_' + c.key} onClick={() => void buy(c.run)}>
                  {phase === 'busy' ? <span className="bs-spin" aria-label="Ждём" /> : c.confirm}
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="bs-art" hidden={!!spec.choices && !isDone}>
          {isDone && done?.rubies ? <CountUp from={done.rubies.from} to={done.rubies.to} /> : isDone && done?.art ? done.art : spec.art}
          {isDone ? (
            <>
              <i className="bs-flash" aria-hidden="true" />
              <span className="bs-ok" aria-label="Готово">
                <Icon id="i-check" />
              </span>
            </>
          ) : null}
        </div>
        {spec.name && !spec.choices ? <b className="bs-name">{spec.name}</b> : null}
        <div className="bs-acts">
          {isDone ? (
            done?.onWear ? (
              <button className="btn lg primary" data-track={'sheet_wear_' + spec.kind} onClick={() => (close(), done.onWear?.())}>
                Надеть
              </button>
            ) : (
              <button className="btn lg primary" data-track={'sheet_ok_' + spec.kind} onClick={close}>
                Ок
              </button>
            )
          ) : (
            <>
              {spec.choices ? null : (
                <button className="btn lg primary bs-buy" disabled={phase === 'busy'} data-track={'sheet_buy_' + spec.kind} onClick={() => void buy()}>
                  {phase === 'busy' ? <span className="bs-spin" aria-label="Ждём" /> : spec.confirm}
                </button>
              )}
              <button className="btn lg secondary" disabled={phase === 'busy'} data-track={'sheet_cancel_' + spec.kind} onClick={close}>
                Отмена
              </button>
            </>
          )}
        </div>
        {!isDone && spec.extra ? <div className="bs-extra">{spec.extra}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
