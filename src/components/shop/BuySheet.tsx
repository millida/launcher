import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { playSound } from '../../lib/sound'
import { intlTag, useT } from '../../i18n'

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
  /** Следующее предложение под результатом (например, «Второй шаг» после первой оплаты): окно не закрывается само. */
  next?: { label: ReactNode; onClick: () => void }
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
  /** Поле над кнопками (записка к подарку). */
  note?: ReactNode
  /** Выбор из нескольких вариантов бок о бок (PLUS / Diamond): у каждого своя картинка и кнопка. */
  choices?: { key: string; art: ReactNode; confirm: ReactNode; tone?: string; run: () => Promise<SheetDone | null> }[]
  /** Закрыли, не нажав главную кнопку (замер воронки). */
  onCancel?: () => void
  /** «Подарить» рядом с главной кнопкой: окно закрывается и открывается выбор друга. */
  gift?: () => void
  /** «Подарить» с подписью, отдельной строкой под главной кнопкой. */
  giftWide?: boolean
  /** Расцветки вещи: кружки под картинкой, выбранная подменяет картинку, имя, кнопку, покупку и подарок. */
  tones?: SheetTone[]
}

export interface SheetTone {
  color: string | null
  title: string
  view: () => Pick<SheetSpec, 'art' | 'name' | 'confirm' | 'run' | 'gift'>
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
export function BuyLabel({ verb, price }: { verb?: string; price: number }) {
  const t = useT()
  return (
    <>
      {verb ?? t('Купить')}
      <Ruby size={18} />
      {price.toLocaleString(intlTag())}
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
      <b>{n.toLocaleString(intlTag())}</b>
    </span>
  )
}

/** Сколько висит результат, если человек его не трогает. */
const DONE_MS = 2600

export function BuySheetHost() {
  const asked = useBuySheet((s) => s.spec)
  const [tone, setTone] = useState(0)
  const toneView = asked?.tones?.[tone]?.view()
  const spec = asked && toneView ? { ...asked, ...toneView } : asked
  const shut = useBuySheet((s) => s.close)
  const [phase, setPhase] = useState<'ask' | 'busy' | 'done'>('ask')
  const [done, setDone] = useState<SheetDone | null>(null)
  const t = useT()
  const hold = useRef(false)
  const timer = useRef(0)

  useEffect(() => {
    setPhase('ask')
    setTone(0)
    setDone(null)
    hold.current = false
    window.clearTimeout(timer.current)
  }, [asked])

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
      if (useBuySheet.getState().spec !== asked) return
      if (!res) return shut()
      playSound('open')
      setDone(res)
      setPhase('done')
      if (!res.next) autoClose()
    } catch {
      if (useBuySheet.getState().spec === asked) shut()
    }
  }

  const isDone = phase === 'done'
  const giftInRow = !!spec.gift && !spec.giftWide
  const giftButton = (cls: string, label: boolean) => (
    <button
      className={'btn lg secondary ' + cls}
      disabled={phase === 'busy'}
      aria-label={t('Подарить')}
      title={label ? undefined : t('Подарить')}
      data-track={'sheet_gift_' + spec.kind}
      onClick={() => {
        const gift = spec.gift
        shut()
        gift?.()
      }}
    >
      <Icon id="i-gift" />
      {label ? t('Подарить') : null}
    </button>
  )
  return createPortal(
    <div className="modal-bg open vis bs-bg" onClick={() => phase !== 'busy' && close()}>
      <div
        className={'modal bs' + (isDone ? ' is-done' : '') + (spec.choices ? ' is-choice' : '')}
        role="dialog"
        aria-label={spec.name || t('Покупка')}
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
                  {phase === 'busy' ? <span className="bs-spin" aria-label={t('Ждём')} /> : c.confirm}
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
              <span className="bs-ok" aria-label={t('Готово')}>
                <Icon id="i-check" />
              </span>
            </>
          ) : null}
        </div>
        {spec.tones && spec.tones.length > 1 && !isDone ? (
          <div className="bs-tones" role="radiogroup" aria-label={t('Расцветка')}>
            {spec.tones.map((x, i) => (
              <button
                key={i}
                role="radio"
                aria-checked={i === tone}
                aria-label={x.title}
                title={x.title}
                className={'bs-tone' + (i === tone ? ' on' : '')}
                style={x.color ? { background: '#' + x.color } : undefined}
                disabled={phase === 'busy'}
                data-track={'sheet_tone_' + spec.kind}
                onClick={() => setTone(i)}
              />
            ))}
          </div>
        ) : null}
        {spec.name && !spec.choices ? <b className="bs-name">{spec.name}</b> : null}
        {!isDone && spec.note ? <div className="bs-note">{spec.note}</div> : null}
        <div className={'bs-acts' + (giftInRow && !isDone ? ' has-gift' : '')}>
          {isDone ? (
            done?.onWear ? (
              <button className="btn lg primary" data-track={'sheet_wear_' + spec.kind} onClick={() => (close(), done.onWear?.())}>
                {t('Надеть')}
              </button>
            ) : done?.next ? (
              <>
                <button className="btn lg primary" data-track={'sheet_next_' + spec.kind} onClick={() => (close(), done.next?.onClick())}>
                  {done.next.label}
                </button>
                <button className="btn lg secondary" data-track={'sheet_ok_' + spec.kind} onClick={close}>
                  {t('Ок')}
                </button>
              </>
            ) : (
              <button className="btn lg primary" data-track={'sheet_ok_' + spec.kind} onClick={close}>
                {t('Ок')}
              </button>
            )
          ) : (
            <>
              {spec.choices ? null : (
                <button className="btn lg primary bs-buy" disabled={phase === 'busy'} data-track={'sheet_buy_' + spec.kind} onClick={() => void buy()}>
                  {phase === 'busy' ? <span className="bs-spin" aria-label={t('Ждём')} /> : spec.confirm}
                </button>
              )}
              {giftInRow ? giftButton('bs-gift', !!spec.choices) : null}
              <button className="btn lg secondary" disabled={phase === 'busy'} data-track={'sheet_cancel_' + spec.kind} onClick={close}>
                {t('Отмена')}
              </button>
            </>
          )}
        </div>
        {!isDone && spec.gift && spec.giftWide ? giftButton('bs-gift-wide', true) : null}
        {!isDone && spec.extra ? <div className="bs-extra">{spec.extra}</div> : null}
      </div>
    </div>,
    document.body,
  )
}
