import type { SetColorwayView, SetView } from '../../lib/rubies'
import { RarityChip } from '../shop/rarityUi'
import { PxThumb, defaultWay } from '../shop/Sets'
import { toneStyle } from '../shop/parts'
import { ItemGrid, ItemTile } from './ItemTile'

/**
 * «Наборы» в разделе «Образы» гардероба (02.10.2026): наборы магазина, где у
 * игрока есть хоть одна вещь. Плитка — 2×2 превью, название, «3/5». Нажатие
 * надевает все свои вещи расцветки, где их больше всего.
 */

/** Расцветка набора, которую показываем и надеваем: где своих вещей больше всего. */
export const wardrobeWay = (set: SetView): SetColorwayView => defaultWay(set)

export function SetLooks({
  sets,
  busy,
  onWear,
}: {
  sets: SetView[]
  /** Набор, который надевается сейчас. */
  busy: string
  onWear: (set: SetView, way: SetColorwayView) => void
}) {
  const mine = sets.filter((s) => s.colorways.some((c) => c.have > 0))
  if (!mine.length) return null
  return (
    <>
      <h3 className="ch-bar-title ch-sub">Наборы</h3>
      <ItemGrid>
        {mine.map((set) => {
          const way = wardrobeWay(set)
          const shown = [...way.items].sort((a, b) => Number(b.owned) - Number(a.owned) || b.price - a.price).slice(0, 4)
          return (
            <ItemTile
              key={set.id}
              art={
                <span className="sl-art" aria-hidden="true">
                  {shown.map((x) => (
                    <span key={x.item.code} className={'sl-cell' + (x.owned ? '' : ' is-miss')} style={toneStyle(x.item)}>
                      <PxThumb item={x.item} />
                      <RarityChip rarity={x.item.rarity} />
                    </span>
                  ))}
                </span>
              }
              name={set.title}
              status={way.have >= way.items.length ? 'Весь ' + way.have + '/' + way.items.length : way.have + '/' + way.items.length}
              loading={busy === set.id}
              track="set_wear_wardrobe"
              kind="set"
              itemId={set.id}
              onClick={busy ? undefined : () => onWear(set, way)}
            />
          )
        })}
      </ItemGrid>
    </>
  )
}
