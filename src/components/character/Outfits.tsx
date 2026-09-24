import { useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { OUTFIT_NAME_MAX, OUTFITS_LIMIT } from '../../state/outfits'
import type { Outfit } from '../../state/outfits'
import { ItemGrid, ItemTile } from './ItemTile'

const things = (n: number) => {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return n + ' вещь'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + ' вещи'
  return n + ' вещей'
}

/**
 * Раздел «Образы», как Outfits в Roblox и Essential: карточка — весь набор
 * целиком, нажатие надевает его. Первая карточка сохраняет то, что надето
 * сейчас. Двойной клик или карандаш — переименовать.
 */
export function Outfits({
  list,
  activeId,
  busyId,
  art,
  currentArt,
  onSave,
  onWear,
  onRename,
  onRemove,
}: {
  list: Outfit[]
  /** Образ, который надет прямо сейчас. */
  activeId: string | null
  /** Образ, который сейчас надевается. */
  busyId: string | null
  art: (o: Outfit) => ReactNode
  /** Как выглядит то, что надето сейчас, — для карточки сохранения. */
  currentArt: ReactNode
  onSave: () => void
  onWear: (o: Outfit) => void
  onRename: (id: string, name: string) => void
  onRemove: (o: Outfit) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const startEdit = (o: Outfit) => {
    setEditing(o.id)
    setDraft(o.name)
  }
  const commit = () => {
    if (editing) onRename(editing, draft)
    setEditing(null)
  }

  return (
    <ItemGrid>
      {/* Карточка видна всегда (владелец 24.09.2026: после первого образа она
          пропадала, и новый было не создать). */}
      {list.length < OUTFITS_LIMIT ? (
        <ItemTile
          action
          art={
            <span className="ch-action-art">
              {currentArt}
              <span className="ch-action-plus">
                <Icon id="i-plus" />
              </span>
            </span>
          }
          name={list.length ? 'Новый образ' : 'Сохранить образ'}
          status={list.length + ' из ' + OUTFITS_LIMIT}
          track="outfit_save"
          onClick={onSave}
        />
      ) : null}
      {list.map((o) =>
        editing === o.id ? (
          <div key={o.id} className="ch-tile on">
            <div className="ch-tile-hit">
              <span className="ch-tile-art">{art(o)}</span>
              <input
                className="ch-look-input"
                value={draft}
                maxLength={OUTFIT_NAME_MAX}
                autoFocus
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            </div>
          </div>
        ) : (
          <div key={o.id} className="ch-look-wrap" onDoubleClick={() => startEdit(o)}>
            <ItemTile
              art={art(o)}
              name={o.name}
              on={o.id === activeId}
              loading={o.id === busyId}
              status={o.id === activeId ? 'Надет' : things(o.cosmetics.length + 1 + (o.cape !== 'none' ? 1 : 0))}
              track="outfit_wear"
              kind="outfit"
              onClick={busyId ? undefined : () => onWear(o)}
              tools={
                <>
                  <button aria-label="Переименовать" data-track="outfit_rename" onClick={() => startEdit(o)}>
                    <Icon id="i-edit" />
                  </button>
                  <button aria-label="Удалить" data-track="outfit_remove" onClick={() => onRemove(o)}>
                    <Icon id="i-trash" />
                  </button>
                </>
              }
            />
          </div>
        ),
      )}
    </ItemGrid>
  )
}
