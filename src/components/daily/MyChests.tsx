import { useMemo, type CSSProperties } from 'react'
import { Icon } from '../Icon'
import type { ChestTier, PendingChest } from '../../lib/rubies'
import { chestList, useDaily } from '../../state/daily'
import { openChestFlow, useChestOpen } from './ChestOpen'
import { chestSprite, SPRITE_H, SPRITE_W } from './chestSprite'
import { CHEST_NAME } from './rewards'
import { useRail } from './useRail'

/** Ширина клетки ленты + зазор: стрелка листает на одну клетку. */
const CELL = 128 + 8

/** Цвет уровня: подложка клетки и искры. */
const TIER_TONE: Record<ChestTier, string> = {
  COMMON: '#ffcf52',
  RARE: 'var(--m-rarity-rare)',
  EPIC: 'var(--m-rarity-epic)',
  LEGEND: 'var(--m-rarity-legendary)',
}

/** «24 сен» по Москве: подпись, когда служба не прислала клетку бонуса. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }).replace('.', '')

/** Откуда сундук — два-три слова: «Бонус · день 4», «Код автора», «250 ч игры». */
export function chestSource(c: PendingChest): string {
  const src = (c.source || '').trim()
  const hours = /^playtime:hours(\d+)$/i.exec(src)
  if (hours) return hours[1] + ' ч игры'
  switch (src.toUpperCase()) {
    case 'DAILY':
      return c.day ? 'Бонус · день ' + c.day : 'Бонус · ' + shortDate(c.createdAt)
    case 'DAILY_PLUS':
      return c.day ? 'PLUS · день ' + c.day : 'PLUS · ' + shortDate(c.createdAt)
    case 'CREATOR':
    case 'CREATOR_CODE':
      return 'Код автора'
    case 'PROMO':
      return 'Промокод'
    case 'STREAK':
      return 'Серия входов'
    case 'XRAY':
      return 'Рентген'
    default:
      return shortDate(c.createdAt)
  }
}

/** Клетка ленты: один сундук, арт своего уровня, подпись «откуда». Клик — открыть его. */
function Cell({ chest, i, busy }: { chest: PendingChest; i: number; busy: boolean }) {
  const tier = chest.tier
  const name = CHEST_NAME[tier]
  return (
    <button
      type="button"
      className={'mc-cell tier-' + tier.toLowerCase()}
      style={{ '--mc-tone': TIER_TONE[tier], '--i': i } as CSSProperties}
      disabled={busy}
      data-track="chest_open"
      data-kind="chest"
      data-id={tier}
      data-pos={i}
      aria-label={'Открыть: ' + name.toLowerCase() + ' сундук, ' + chestSource(chest)}
      onClick={() => openChestFlow([chest])}
    >
      {tier !== 'COMMON' ? (
        <span className="mc-sparks" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      <img className="mc-art" src={chestSprite(tier)} alt="" width={SPRITE_W * 2} height={SPRITE_H * 2} draggable={false} />
      <b className="mc-name">{name}</b>
      <span className="mc-src">{chestSource(chest)}</span>
    </button>
  )
}

/**
 * «Мои сундуки» как в Brawl Stars (правка владельца 24.09.2026, 18:12): лента
 * сундуков по порядку получения — каждый отдельной клеткой, старые слева
 * (первым — тот, что открыть сейчас), новые справа. Никаких плиток «0» по
 * уровням: пусто — блока нет. Клик — открыть этот сундук, «Открыть все» — в
 * шапке. Лента листается колесом, перетаскиванием и стрелками.
 */
export function MyChests() {
  const status = useDaily((s) => s.status)
  const pending = useDaily((s) => s.pending)
  const busy = useChestOpen((s) => s.queue.length > 0)
  const chests = useMemo(
    () =>
      chestList({ status, pending })
        .map((c, i) => ({ c, i }))
        .sort((a, b) => Date.parse(a.c.createdAt) - Date.parse(b.c.createdAt) || a.i - b.i)
        .map((x) => x.c),
    [status, pending],
  )
  const { ref, edge, page } = useRail(null, CELL)
  if (!chests.length) return null
  return (
    <section className="mc" aria-label="Мои сундуки">
      <div className="mc-head">
        <h4>Мои сундуки</h4>
        <b className="mc-count">{chests.length}</b>
        {chests.length > 1 ? (
          <button type="button" className="btn sm secondary mc-all" disabled={busy} data-track="chest_open_all" onClick={() => openChestFlow(chests)}>
            Открыть все
          </button>
        ) : null}
      </div>
      <div className="mc-view">
        <div className="mc-scroll" ref={ref}>
          <div className="mc-row">
            {chests.map((c, i) => (
              <Cell key={c.id} chest={c} i={i} busy={busy} />
            ))}
          </div>
        </div>
        {edge.l || edge.r ? (
          <>
            <button type="button" className="dp2-arrow l" aria-label="Раньше" disabled={!edge.l} onClick={() => page(-1)}>
              <Icon id="i-chev-l" />
            </button>
            <button type="button" className="dp2-arrow r" aria-label="Дальше" disabled={!edge.r} onClick={() => page(1)}>
              <Icon id="i-chev-r" />
            </button>
          </>
        ) : null}
      </div>
    </section>
  )
}
