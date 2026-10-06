import { useEffect, useRef, useState } from 'react'
import { Slider } from '../Slider'
import { PxArt } from './px'
import { useBump } from './motion'
import { benchOp } from '../../state/milliBench'

/*
 * Выбор размера сборки: ≈25 · ≈70 · ≈150 · ≈250 · своё число (10–400).
 * (а) в ленте — ответ на «Сколько модов взять?» (onPick шлёт размер в чат);
 * (б) `compact` — inline в шапке карточки «70 модов · изменить» → op size.
 * Выбор запоминается и уходит `size` в следующий запрос (`readMilliSize`).
 */

export const MILLI_SIZE_MIN = 10
export const MILLI_SIZE_MAX = 400
const KEY = 'm-milli-size'

export const MILLI_SIZES: readonly { n: number; ru: string; px: string }[] = [
  { n: 25, ru: 'лёгкая', px: 'chest' },
  { n: 70, ru: 'обычная', px: 'chest_large' },
  { n: 150, ru: 'большая', px: 'ender_chest' },
  { n: 250, ru: 'огромная', px: 'shulker_box' },
]

/** Число в пределах 10–400 или null (мусор, пусто). */
export function clampMilliSize(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.max(MILLI_SIZE_MIN, Math.min(MILLI_SIZE_MAX, Math.round(n)))
}

export function readMilliSize(): number | null {
  try {
    return clampMilliSize(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

export function saveMilliSize(n: number): void {
  const v = clampMilliSize(n)
  if (v === null) return
  try {
    localStorage.setItem(KEY, String(v))
  } catch {}
}

/** «70 модов», «1 мод», «23 мода». */
export function modsWord(n: number): string {
  const d = n % 10
  const h = n % 100
  if (d === 1 && h !== 11) return n + ' мод'
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return n + ' мода'
  return n + ' модов'
}

/** Ближайший чип к числу: подсвечиваем его, если число «около» (±15 %). */
function nearChip(n: number | null | undefined): number | null {
  if (!n) return null
  const hit = MILLI_SIZES.find((s) => Math.abs(s.n - n) <= s.n * 0.15)
  return hit ? hit.n : null
}

export function MilliSizePick({
  value,
  onPick,
  onClose,
  compact = false,
}: {
  value?: number | null
  /** Выбрано число (уже сохранено; в `compact` op size уже ушёл). */
  onPick?: (n: number) => void
  /** `compact`: Esc — свернуть выбор (кнопку «70 модов · изменить» рисует карточка). */
  onClose?: () => void
  compact?: boolean
}) {
  const [own, setOwn] = useState(false)
  const start = value ?? readMilliSize() ?? 70
  const [custom, setCustom] = useState(String(start))
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!compact || !onClose) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && root.current?.contains(document.activeElement)) onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [compact, onClose])

  const pick = (raw: number) => {
    const n = clampMilliSize(raw)
    if (n === null) return
    saveMilliSize(n)
    setOwn(false)
    if (compact && n !== value) void benchOp({ op: 'size', target: n })
    onPick?.(n)
  }

  const on = nearChip(value)
  const ownN = clampMilliSize(custom) ?? start
  const bump = useBump(ownN)
  return (
    <div className={'msz' + (compact ? ' compact' : '')} ref={root} role="group" aria-label="Сколько модов взять">
      <div className="msz-chips">
        {MILLI_SIZES.map((s) => (
          <button
            key={s.n}
            className={'seg msz-chip' + (on === s.n && !own ? ' on' : '')}
            onClick={() => pick(s.n)}
            aria-label={'≈' + s.n + ' модов, ' + s.ru}
            aria-pressed={on === s.n && !own}
          >
            <PxArt name={s.px} size={compact ? 12 : 32} />
            <span className="msz-n">{s.n}</span>
            {compact ? null : <span className="msz-l">{s.ru}</span>}
          </button>
        ))}
        <button className={'seg msz-chip own' + (own ? ' on' : '')} aria-expanded={own} onClick={() => setOwn((v) => !v)}>
          {compact ? null : <PxArt name="crafting_table" size={32} />}
          <span className="msz-n">Своё</span>
        </button>
      </div>
      {own ? (
        <div className="msz-own">
          <span className="msz-own-n" data-mlm-bump={bump}>
            {ownN}
          </span>
          <Slider width="100%" min={MILLI_SIZE_MIN} max={MILLI_SIZE_MAX} step={5} value={ownN} onChange={(v) => setCustom(String(v))} />
          <span className="input sm">
            <input
              inputMode="numeric"
              aria-label="Число модов"
              value={custom}
              onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))}
              onKeyDown={(e) => e.key === 'Enter' && pick(ownN)}
            />
          </span>
          <button className="btn sm primary" onClick={() => pick(ownN)}>
            Готово
          </button>
        </div>
      ) : null}
    </div>
  )
}
