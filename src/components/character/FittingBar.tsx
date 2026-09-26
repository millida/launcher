import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'

/**
 * Панель «Сет» под фигурой. Сет собирается кликами по вещам в разделах: своя
 * вещь надевается сразу, чужая встаёт на фигуру примеркой и попадает сюда.
 * Крестиков у вещей нет — повторный клик по вещи в разделе снимает её из сета
 * (владелец 24.09.2026). Касса одна на весь сет: «Купить всё».
 */
export interface SetPiece {
  id: string
  name: string
  art: ReactNode
  /** Цена в рубинах. Пусто — вещь открывает PLUS. */
  price?: number
  plus?: boolean
  note?: string
  /** Модель ещё едет — на фигуре вещи пока нет. */
  loading?: boolean
  tones?: { name: string; color?: string }[]
  tone?: string
}

const things = (n: number) => {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return n + ' вещь'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' вещи'
  return n + ' вещей'
}

export function FittingBar({
  pieces,
  total,
  rubies,
  busy,
  canWear,
  needLogin,
  onPick,
  onTone,
  onClear,
  onBuy,
  onTopUp,
  onWear,
  onPlus,
}: {
  pieces: SetPiece[]
  /** Сумма за вещи, которые продаются за рубины. */
  total: number
  rubies: number
  busy: boolean
  /** В сете есть уже открытые вещи (например, после оформления PLUS). */
  canWear: boolean
  /** Купить нечем, пока нет аккаунта: кнопка ведёт на вход, а не в кассу. */
  needLogin?: boolean
  /** Клик по миниатюре — показать вещь в её разделе. */
  onPick: (id: string) => void
  onTone: (id: string, tone: string) => void
  onClear: () => void
  onBuy: () => void
  /** Рубинов не хватает — в пополнение. */
  onTopUp: () => void
  onWear: () => void
  /** В сете есть вещи PLUS, а подписки нет. */
  onPlus?: () => void
}) {
  if (!pieces.length) return null
  const short = Math.max(0, total - rubies)
  return (
    <div className="ch-fit ch-set" aria-label="Сет" data-section="fitting">
      <div className="ch-set-head">
        <b>Сет</b>
        <small>{things(pieces.length)}</small>
        <button className="btn sm ghost" disabled={busy} data-track="fitting_clear" onClick={onClear}>
          Сбросить
        </button>
      </div>
      <div className="ch-set-list">
        {pieces.map((piece) => (
          <div key={piece.id} className={'ch-set-item' + (piece.loading ? ' is-loading' : '')}>
            <button className="ch-set-art" title={piece.name} aria-label={piece.name} data-track="fitting_piece" data-kind="item" data-id={piece.id} onClick={() => onPick(piece.id)}>
              {piece.art}
            </button>
            <span className={'ch-set-price' + (piece.plus ? ' plus' : '')}>
              {piece.plus ? (
                'PLUS'
              ) : piece.price !== undefined ? (
                <>
                  <Ruby size={10} />
                  {piece.price}
                </>
              ) : (
                piece.note ?? 'твоя'
              )}
            </span>
            {(piece.tones?.length ?? 0) > 1 ? (
              <span className="ch-fit-tones">
                {(piece.tones ?? []).map((tone) => (
                  <button
                    key={tone.name}
                    className={'ch-tone' + (piece.tone === tone.name ? ' on' : '')}
                    style={{ background: '#' + (tone.color ?? '888888') }}
                    aria-label={tone.name}
                    data-track="fitting_tone"
                    onClick={() => onTone(piece.id, tone.name)}
                  />
                ))}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="ch-fit-buy">
        {total > 0 ? (
          needLogin ? (
            <button className="btn md primary" disabled={busy} data-track="login" onClick={onBuy}>
              <Icon id="i-login" />
              Войти
            </button>
          ) : short > 0 ? (
            <button className="btn md primary" disabled={busy} data-track="fitting_topup" onClick={onTopUp}>
              Не хватает
              <Ruby size={14} />
              {short}
            </button>
          ) : (
            <button className="btn md primary" disabled={busy} data-track="fitting_buy" onClick={onBuy}>
              {busy ? (
                'Покупаем…'
              ) : (
                <>
                  Купить всё
                  <Ruby size={14} />
                  {total}
                </>
              )}
            </button>
          )
        ) : null}
        {onPlus ? (
          <button className={'btn md ' + (total > 0 ? 'secondary' : 'primary')} disabled={busy} data-track="plus_subscribe" onClick={onPlus}>
            <Icon id="i-star" />
            PLUS
          </button>
        ) : null}
        {canWear ? (
          <button className={'btn md ' + (total > 0 || onPlus ? 'secondary' : 'primary')} disabled={busy} data-track="fitting_wear" onClick={onWear}>
            Надеть
          </button>
        ) : null}
        {total > 0 && !needLogin ? (
          <span className="ch-fit-have" title="Твои рубины">
            <Ruby size={12} />
            {rubies}
          </span>
        ) : null}
      </div>
    </div>
  )
}
