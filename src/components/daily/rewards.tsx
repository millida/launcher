import type { CSSProperties } from 'react'
import { Ruby } from '../Ruby'
import { useVariantPreview } from '../../lib/variantArt'
import { Shard } from '../shop/parts'
import { ChestArt } from './ChestArt'
import { RARITY_NAME_SHORT, RARITY_TONE } from '../shop/rarity'
import type { ChestTier, Rarity, Reward } from '../../lib/rubies'
import type { TrackReward } from './track'

/**
 * Картинка награды: осколки — кристалл, сундук — сундук своего уровня (в треке
 * с 24.09.2026 только они); рубины, фрагменты и вещь — для старых ответов.
 * Как в Brawl Stars: видно ВЕЩЬ, а не слово «награда».
 */

export const CHEST_NAME: Record<ChestTier, string> = {
  COMMON: 'Обычный',
  RARE: 'Редкий',
  EPIC: 'Эпический',
  LEGEND: 'Легендарный',
}

const CHEST_RARITY: Record<ChestTier, Rarity> = { COMMON: 'COMMON', RARE: 'RARE', EPIC: 'EPIC', LEGEND: 'LEGENDARY' }

/** Редкость награды — от неё цвет рамки и вспышки при выпадении. */
export function rewardRarity(r: TrackReward): Rarity {
  if (r.kind === 'MYSTERY') return r.rarity || 'EPIC'
  if (r.kind === 'CHEST') return CHEST_RARITY[r.tier]
  if (r.kind === 'ITEM' || r.kind === 'FRAGMENTS') return r.rarity || r.item?.rarity || 'EPIC'
  return 'COMMON'
}

/** Цвет рамки и вспышки: у рубинов — цвет рубина, у остального — редкость. */
export const rarityTone = (r: TrackReward) =>
  r.kind === 'RUBIES' ? 'var(--m-ruby)' : r.kind === 'SHARDS' ? 'var(--m-rarity-rare)' : RARITY_TONE[rewardRarity(r)]

/** Подпись под картинкой: одно короткое слово или число. */
export function rewardLabel(r: TrackReward): string {
  if (r.kind === 'MYSTERY') return r.of === 'FRAGMENTS' ? 'Фрагменты' : 'Новая вещь'
  if (r.kind === 'RUBIES' || r.kind === 'SHARDS') return String(r.amount)
  if (r.kind === 'CHEST') return CHEST_NAME[r.tier]
  if (r.kind === 'FRAGMENTS') return 'Фрагменты'
  return r.item?.name || RARITY_NAME_SHORT[rewardRarity(r)]
}

/** Для экранного чтеца и подсказок. */
export function rewardTitle(r: TrackReward): string {
  if (r.kind === 'MYSTERY')
    return r.of === 'FRAGMENTS' ? (r.amount || 0) + ' фрагм. новой вещи двух недель' : 'Новая вещь, откроется в свою неделю'
  if (r.kind === 'RUBIES') return r.amount + ' рубинов'
  if (r.kind === 'SHARDS') return r.amount + ' осколков'
  if (r.kind === 'CHEST') return CHEST_NAME[r.tier] + ' сундук'
  if (r.kind === 'FRAGMENTS') return r.amount + ' фрагм. ' + (r.item ? '«' + r.item.name + '»' : RARITY_NAME_SHORT[rewardRarity(r)].toLowerCase())
  return (r.item?.name || RARITY_NAME_SHORT[rewardRarity(r)]) + ', навсегда'
}

export function RewardArt({ reward, size }: { reward: TrackReward; size: number }) {
  const it = reward.kind === 'ITEM' || reward.kind === 'FRAGMENTS' ? reward.item : undefined
  const preview = useVariantPreview(it?.preview, it?.tintFrom, it?.tintFrom ? it.color : null)
  const style = { '--ra-size': size + 'px', '--ra-tone': rarityTone(reward) } as CSSProperties
  if (reward.kind === 'MYSTERY') {
    // Закрытая карта: вещь той недели клиенту ещё неизвестна.
    const q = <b className="ra-q">?</b>
    return reward.of === 'FRAGMENTS' ? (
      <span className="ra ra-frag ra-mystery" style={style}>
        <span className="ra-shard">{q}</span>
        {reward.amount ? <b className="ra-count">×{reward.amount}</b> : null}
      </span>
    ) : (
      <span className="ra ra-item ra-mystery" style={style}>
        <span className="ra-frame">{q}</span>
      </span>
    )
  }
  if (reward.kind === 'RUBIES') {
    return (
      <span className="ra ra-rubies" style={style}>
        <Ruby size={Math.round(size * 0.82)} />
      </span>
    )
  }
  if (reward.kind === 'SHARDS') {
    return (
      <span className="ra ra-rubies ra-shards" style={style}>
        <Shard size={Math.round(size * 0.8)} />
      </span>
    )
  }
  if (reward.kind === 'CHEST') {
    return (
      <span className="ra ra-chest" style={style}>
        <ChestArt ready={false} tier={reward.tier} size={Math.round(size * 0.8)} />
      </span>
    )
  }
  if (reward.kind === 'FRAGMENTS') {
    return (
      <span className="ra ra-frag" style={style}>
        <span className="ra-shard">{preview ? <img src={preview} alt="" draggable={false} /> : null}</span>
        <b className="ra-count">×{reward.amount}</b>
      </span>
    )
  }
  return (
    <span className={'ra ra-item' + (reward.owned ? ' owned' : '')} style={style}>
      <span className="ra-frame">{preview ? <img src={preview} alt="" draggable={false} /> : null}</span>
    </span>
  )
}

/** Сумма рубинов в списке наград. */
export const rubiesIn = (list: Reward[]) =>
  list.reduce((n, r) => n + (r.kind === 'RUBIES' ? r.amount : 0), 0)

/**
 * Каким выглядит сундук дня: по самой ценной награде внутри. Сундук даёт свой
 * тир, вещь — по редкости (эпическая и выше — эпический, редкая — редкий).
 * Так день 7 и день с вещью PLUS видно издалека.
 */
export function dayChestTier(list: Reward[] | undefined): ChestTier {
  const order: ChestTier[] = ['COMMON', 'RARE', 'EPIC', 'LEGEND']
  let best: ChestTier = 'COMMON'
  const bump = (t: ChestTier) => {
    if (order.indexOf(t) > order.indexOf(best)) best = t
  }
  for (const r of list || []) {
    if (r.kind === 'CHEST') bump(r.tier)
    if (r.kind === 'ITEM') {
      const rar = r.rarity || r.item?.rarity || 'EPIC'
      if (rar === 'LEGENDARY' || rar === 'MYTHIC' || rar === 'RELIC') bump('LEGEND')
      else if (rar === 'EPIC') bump('EPIC')
      else if (rar === 'RARE') bump('RARE')
    }
  }
  return best
}
