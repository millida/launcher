import { useMemo, type CSSProperties } from 'react'
import { Icon } from '../Icon'
import type { ChestTier, PendingChest } from '../../lib/rubies'
import { chestList, useDaily } from '../../state/daily'
import { openChestFlow, useChestOpen } from './ChestOpen'
import { ChestLive } from './ChestLive'
import { CHEST_NAME } from './rewards'
import { useRail } from './useRail'
import { intlTag, t, useT } from '../../i18n'

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
  new Date(iso).toLocaleDateString(intlTag(), { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' }).replace('.', '')

/** Откуда сундук — два-три слова: «Бонус · день 4», «Код автора», «250 ч игры». */
export function chestSource(c: PendingChest): string {
  const src = (c.source || '').trim()
  const hours = /^playtime:hours(\d+)$/i.exec(src)
  if (hours) return t('{n} ч игры', { n: hours[1] ?? '' })
  switch (src.toUpperCase()) {
    case 'DAILY':
      return c.day ? t('Бонус · день {n}', { n: c.day }) : t('Бонус · {date}', { date: shortDate(c.createdAt) })
    case 'DAILY_PLUS':
      return c.day ? t('PLUS · день {n}', { n: c.day }) : 'PLUS · ' + shortDate(c.createdAt)
    case 'CREATOR':
    case 'CREATOR_CODE':
      return t('Код автора')
    case 'PROMO':
      return t('Промокод')
    case 'REFERRAL':
      return t('Приглашённый друг')
    case 'STREAK':
      return t('Серия входов')
    case 'XRAY':
      return t('Рентген')
    default:
      return shortDate(c.createdAt)
  }
}

/** Клетка ленты: один сундук, арт своего уровня, подпись «откуда». Клик — открыть его. */
function Cell({ chest, i, busy }: { chest: PendingChest; i: number; busy: boolean }) {
  const t = useT()
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
      aria-label={t('Открыть: {tier} сундук, {source}', { tier: name.toLowerCase(), source: chestSource(chest) })}
      onClick={() => openChestFlow([chest])}
    >
      {tier !== 'COMMON' ? (
        <span className="mc-sparks" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      {/* Тот же 3D-сундук, что в ящиках и при открытии (один вид, 06.10.2026). */}
      <span className="mc-art">
        <ChestLive ready tier={tier} size={64} />
      </span>
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
  const t = useT()
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
    <section className="mc" aria-label={t('Мои сундуки')}>
      <div className="mc-head">
        <h4>{t('Мои сундуки')}</h4>
        <b className="mc-count">{chests.length}</b>
        {chests.length > 1 ? (
          <button type="button" className="btn sm secondary mc-all" disabled={busy} data-track="chest_open_all" onClick={() => openChestFlow(chests)}>
            {t('Открыть все')}
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
            <button type="button" className="dp2-arrow l" aria-label={t('Раньше')} disabled={!edge.l} onClick={() => page(-1)}>
              <Icon id="i-chev-l" />
            </button>
            <button type="button" className="dp2-arrow r" aria-label={t('Дальше')} disabled={!edge.r} onClick={() => page(1)}>
              <Icon id="i-chev-r" />
            </button>
          </>
        ) : null}
      </div>
    </section>
  )
}
