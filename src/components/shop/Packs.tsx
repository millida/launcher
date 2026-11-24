import { useState, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { DIAMOND_ITEM_PCT, PLUS_ITEM_PCT, type ChestTier, type MonthOffer, type SecondOffer, type ShopPack } from '../../lib/rubies'
import { offerPct, packArtAt, SECOND_ART, sortPacks } from './packMath'
import { rubyPackPrice, rubyPackWas, useMoney } from '../../lib/useMoney'
import { BoltArt, GemArt } from './shopArt'
import { NickFlip } from '../premium/StatusCompare'
import { PlusMark } from '../premium/PlusMark'
import { usePlusPass } from '../daily/passTotals'
import { daysWord } from '../daily/track'
import { ChestArt } from '../daily/ChestArt'
import { CHEST_DROPS, PLUS_PASS } from '../daily/chestDrops'
import { Shard, Timer } from './parts'
import { FragmentIcon } from './rarityUi'
import { useOffscreenPause } from './useOffscreen'
import '../../styles/pixel/plus-bundle.css'
import { formatNumber, intlTag, t, useT } from '../../i18n'

/** Значок «+N%» в углу карточки; 0 — значка нет. */
export function PctBadge({ pct, best }: { pct: number; best?: boolean }) {
  const t = useT()
  if (best) return <span className="pk-best">{t('Выгоднее всего')}{pct > 0 ? ' +' + pct + '%' : ''}</span>
  if (pct <= 0) return null
  return <span className="pk-pct">+{pct}%</span>
}

export interface PlusTile {
  rubies: number
  label: ReactNode
  onOpen: () => void
  /** Есть подписка — «Продлить»/апгрейд, без выбора тарифа. */
  sub?: boolean
  /** Плитка Diamond (подписчику Diamond и апгрейд с PLUS): синяя, знак DIAMOND, −15%, «сразу». */
  diamond?: boolean
  /** Цены тарифов для переключателя PLUS / Diamond: «299 ₽», «539 ₽». */
  prices?: Record<PlusTier, string>
  /** Покупка выбранного тарифа (без него — onOpen). */
  onPick?: (tier: PlusTier) => void
  onGift?: (tier: PlusTier) => void
}

type PlusTier = 'PLUS' | 'DIAMOND'

/**
 * Сундуки строки PLUS по уровням. Числа — от службы через usePlusPass: в
 * обычном сезоне 3 редких, 5 эпических, легендарный (SEASON_TRACK), в декабре —
 * итоги новогоднего календаря.
 */
const passChests = (chests: Partial<Record<ChestTier, number>>) =>
  (['COMMON', 'RARE', 'EPIC', 'LEGEND'] as ChestTier[]).map((t) => ({ tier: t, n: chests[t] ?? 0 })).filter((c) => c.n > 0)
const CHEST_LABEL: Record<ChestTier, string> = {
  get COMMON() { return t('Обычный') },
  get RARE() { return t('Редкий') },
  get EPIC() { return t('Эпический') },
  get LEGEND() { return t('Легендарный') },
}
/** Пример зачёркнутой цены в плитке скидки. */
const EXAMPLE_PRICE = 1000
const cut = (price: number, pct: number) => Math.max(10, Math.round((price * (100 - pct)) / 100 / 10) * 10)
const nf = (n: number) => n.toLocaleString(intlTag())

/** Плитка содержимого бандла: картинка крупно, число, подпись в одно слово. */
function Part({ art, n, cap, tone, wide, now, children }: { art: ReactNode; n: ReactNode; cap?: ReactNode; tone?: string; wide?: boolean; now?: boolean; children?: ReactNode }) {
  const t = useT()
  return (
    <span className={'pb-part' + (wide ? ' is-wide' : '')} style={tone ? { ['--pb-tone' as string]: tone } : undefined}>
      {now ? (
        <i className="pb-stamp">
          <BoltArt size={12} />
          {t('сразу')}
        </i>
      ) : null}
      <span className="pb-part-art">{art}</span>
      <b className="pb-part-n">{n}</b>
      {cap ? <small className="pb-part-cap">{cap}</small> : null}
      {children}
    </span>
  )
}

/** «Что внутри»: обычное содержимое сундука каждого уровня по таблице выпадения. */
function ChestInside({ chests }: { chests: { tier: ChestTier; n: number }[] }) {
  const t = useT()
  return (
    <span className="pb-in" role="tooltip">
      {chests.map(({ tier, n }) => {
        const d = CHEST_DROPS[tier]
        return (
          <span key={tier} className="pb-in-row">
            <ChestArt ready={false} tier={tier} size={30} />
            <b className="pb-in-name" aria-label={CHEST_LABEL[tier]}>
              ×{n}
            </b>
            <span className="pb-in-got">
              <Shard size={16} />
              {d.shards[0]}–{d.shards[1]}
            </span>
            <span className="pb-in-got">
              <FragmentIcon rarity={tier === 'LEGEND' ? 'LEGENDARY' : tier} size={16} />
              {d.items === 1 ? t('1 вещь') : t('{n} вещи', { n: d.items })}
            </span>
            {d.rubies ? (
              <span className="pb-in-got">
                <Ruby size={16} />
                {d.rubies.amount[0]}–{d.rubies.amount[1]}
              </span>
            ) : null}
          </span>
        )
      })}
    </span>
  )
}

/**
 * Millida PLUS как бандл в Supercell (06.10.2026): золотая рамка с бликом,
 * лента сверху; шапка — знак, переключатель PLUS / Diamond с ценами и
 * таблички ника «без PLUS / с PLUS»; плитки — горка ◆2 100, сундуки пропуска
 * по уровням с «что внутри», −10% с зачёркнутой ценой, осколки ×1,5,
 * фрагменты. Diamond — те же награды сразу и −15%.
 */
function PlusBundle({ tile }: { tile: PlusTile }) {
  const t = useT()
  const paused = useOffscreenPause<HTMLDivElement>()
  const [pick, setPick] = useState<PlusTier>('PLUS')
  const [inside, setInside] = useState(false)
  const pass = usePlusPass()
  const chests = passChests(pass.chests)
  const dia = tile.sub ? !!tile.diamond : pick === 'DIAMOND'
  const tier: PlusTier = dia ? 'DIAMOND' : 'PLUS'
  const pct = dia ? DIAMOND_ITEM_PCT : PLUS_ITEM_PCT
  const buy = () => (tile.onPick && !tile.sub ? tile.onPick(tier) : tile.onOpen())
  const label = tile.sub || !tile.prices ? tile.label : t('Купить · {price}', { price: tile.prices[tier] })
  return (
    <div className={'pb pb2' + (dia ? ' is-diamond' : '')} ref={paused} data-kind="plus_offer" data-id="plus" data-tier={tier}>
      <span className="pb-ribbon">{dia ? t('Всё сразу — в день покупки') : t('Выгоднее, чем просто рубины')}</span>
      <div className="pb-top">
        <button className="pb-head" aria-label={'Millida ' + tier} data-track="plus_tile_art" onClick={buy}>
          <PlusMark tier={tier} height={dia ? 28 : 38} shine />
        </button>
        {tile.sub || !tile.prices ? null : (
          <span className="pb-seg" role="radiogroup" aria-label={t('Тариф')}>
            {(['PLUS', 'DIAMOND'] as PlusTier[]).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={pick === t}
                className={'pb-seg-btn is-' + t.toLowerCase() + (pick === t ? ' is-on' : '')}
                data-track={'plus_tile_pick_' + t.toLowerCase()}
                onClick={() => setPick(t)}
              >
                {t === 'DIAMOND' ? <GemArt size={18} /> : <Icon id="i-crown" />}
                <b>{t === 'DIAMOND' ? 'Diamond' : 'PLUS'}</b>
                <span>{tile.prices![t]}</span>
              </button>
            ))}
          </span>
        )}
        <span className={'pb-when' + (dia ? ' is-now' : '')}>
          {dia ? (
            <>
              <BoltArt size={18} />
              {t('сразу:')} <Ruby size={18} />
              <b>{nf(tile.rubies)}</b> + <b>{pass.count}</b> {t('сундуков')}
            </>
          ) : (
            <>{t('по дням, {days}', { days: daysWord(pass.days) })}</>
          )}
        </span>
        <NickFlip />
      </div>
      <div className="pb-body">
        <div className="pb-parts">
          <Part art={<img src="/packs/treasury.png" alt="" draggable={false} />} n={<><Ruby size={20} />{nf(tile.rubies)}</>} cap={t('рубинов')} tone="#e8364f" now={dia} />
          <Part
            wide
            now={dia}
            tone="#a855f7"
            art={
              <span className="pb-chests">
                {chests.map(({ tier: t, n }) => (
                  <span key={t} className={'pb-chest tier-' + t.toLowerCase()}>
                    <ChestArt ready={false} tier={t} size={t === 'LEGEND' ? 72 : 62} />
                    <b>×{n}</b>
                  </span>
                ))}
              </span>
            }
            n={t('{n} сундуков', { n: pass.count })}
          >
            <span className={'pb-inside' + (inside ? ' is-open' : '')} onMouseLeave={() => setInside(false)}>
              <button className="pb-inside-btn" data-notip aria-expanded={inside} data-track="plus_tile_inside" onClick={() => setInside((v) => !v)}>
                {t('что внутри')}
              </button>
              <ChestInside chests={chests} />
            </span>
          </Part>
          <Part
            tone="#5bd16b"
            art={
              <span className="pb-sale">
                <b className="pb-off">−{pct}%</b>
                <span className="pb-was">
                  <s>{nf(EXAMPLE_PRICE)}</s>
                  <Ruby size={16} />
                  <b>{nf(cut(EXAMPLE_PRICE, pct))}</b>
                </span>
              </span>
            }
            n={t('на всё')}
            cap={t('в магазине')}
          />
          <Part art={<Shard size={60} />} n={'×' + formatNumber(PLUS_PASS.shardBoost)} cap={t('осколки')} tone="#36b3ff" />
          <Part art={<FragmentIcon rarity="EPIC" size={60} />} n={t('фрагменты')} cap={t('вещей')} tone="#f5b301" />
        </div>
        <div className="pb-buy">
          <button className={'btn lg pl-btn pb-btn ' + (dia ? 'is-diamond' : 'is-plus')} data-track="plus_tile" onClick={buy}>
            {dia ? <GemArt size={22} /> : <Icon id="i-crown" />}
            {label}
          </button>
          {tile.onGift ? (
            <button className="btn md secondary" data-track="plus_tile_gift" onClick={() => tile.onGift?.(tier)}>
              <Icon id="i-gift" />
              {t('Подарить')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * Сколько те же рубины стоят по курсу обычного пакета, ближайшего по размеру
 * (до рубля, в копейках): зачёркнутая цена у разовых предложений.
 */
export function usualKopecks(rubies: number, packs: ShopPack[]): number {
  const usual = packs.filter((p) => !p.oneTime && p.rubies > 0)
  if (!usual.length) return 0
  const near = usual.reduce((a, p) => (Math.abs(p.rubies - rubies) < Math.abs(a.rubies - rubies) ? p : a))
  return Math.round((rubies * near.kopecks) / near.rubies / 100) * 100
}

/**
 * Предложение месяца (служба 7e81279a7): разовый пакет до конца месяца —
 * горка рубинов, «3 200», «Один раз» (купить можно однажды, владелец 07.10.2026), отсчёт и цена с зачёркнутой обычной.
 * Стоит прямо перед «Скидками дня»; null — блока нет.
 */
export function MonthOfferBlock({ offer, packs, busy, onBuy, onEnd }: { offer: MonthOffer; packs: ShopPack[]; busy: boolean; onBuy: () => void; onEnd?: () => void }) {
  const t = useT()
  useMoney()
  const pct = offerPct(offer.rubies, offer.kopecks, packs, offer.badgePct)
  return (
    <section className="mo" data-section="month_offer" data-kind="ruby_pack" data-id={offer.code}>
      <button className="mo-art" aria-label={t('{n} рубинов', { n: offer.rubies })} data-track="buy_month_art" disabled={busy} onClick={onBuy}>
        <img src="/packs/vault.png" alt="" draggable={false} />
      </button>
      <div className="mo-mid">
        <span className="mo-tags">
          <b className="mo-once">{t('Один раз')}</b>
          {pct > 0 ? <span className="pk-pct is-inline">+{pct}%</span> : null}
          <Timer to={offer.endsAt} onEnd={onEnd} />
        </span>
        <b className="mo-n">
          {offer.rubies.toLocaleString(intlTag())}
          <Ruby size={40} />
        </b>
        <small className="mo-title">{offer.title}</small>
      </div>
      <button className="btn lg primary mo-btn" disabled={busy} data-track="buy_month" onClick={onBuy}>
        {rubyPackPrice(offer.code, offer.kopecks)}
      </button>
    </section>
  )
}

/**
 * Сетка без сироты: плитка PLUS шире (2–3 колонки), колонок 4–6 так, чтобы
 * ряды были полными. 9 пакетов: PLUS в 3 колонки, 6 колонок — 2 ровных ряда.
 */
export function packGrid(packs: number, plus: boolean): { cols: number; span: number } {
  if (!plus) {
    for (const cols of [5, 6, 4, 3]) if (packs % cols === 0) return { cols, span: 1 }
    return { cols: 5, span: 1 }
  }
  for (const span of [2, 3])
    for (const cols of [6, 5, 4]) if ((packs + span) % cols === 0) return { cols, span }
  return { cols: 5, span: 2 }
}

/** Картинка пакета: мешок/сундук рубинов, без картинки — крупный рубин. */
export function PackArt({ src, size = 'md' }: { src: string; size?: 'md' | 'lg' }) {
  const [gone, setGone] = useState(false)
  return (
    <span className={'pk-art is-' + size}>
      {!gone ? <img src={src} alt="" draggable={false} onError={() => setGone(true)} /> : <Ruby size={size === 'lg' ? 96 : 64} />}
    </span>
  )
}

/** Число рубинов крупно. */
export const PackCount = ({ n }: { n: number }) => (
  <b className="pk-count">
    <Ruby size={22} />
    {n.toLocaleString(intlTag())}
  </b>
)

/**
 * «Второй шаг» (разовый оффер первых 72 ч): карточка-пакет первой в ряду —
 * «Только сейчас», таймер, итог рубинов крупно, значок выгоды, цена без
 * зачёркнутой. Покупается тем же путём, что пакет.
 */
export function SecondCard({ offer, packs, busy, onBuy, onEnd }: { offer: SecondOffer; packs: ShopPack[]; busy: boolean; onBuy: () => void; onEnd?: () => void }) {
  const t = useT()
  const pct = offerPct(offer.rubies, offer.kopecks, packs, offer.badgePct)
  return (
    <div className="sh-card pk is-second" data-kind="ruby_pack" data-id={offer.code}>
      <span className="pk-promo is-now">{t('Только сейчас')}</span>
      <button className="pk-pick" aria-label={t('{n} рубинов', { n: offer.rubies })} data-track="buy_second_art" disabled={busy} onClick={onBuy}>
        <PackArt src={SECOND_ART} />
      </button>
      <PackCount n={offer.rubies} />
      <span className="pk-second-meta">
        {pct > 0 ? <span className="pk-pct is-inline">+{pct}%</span> : null}
        <Timer to={offer.endsAt} onEnd={onEnd} />
      </span>
      <button className="btn md primary pk-btn pk-buy" disabled={busy} data-track="buy_second" onClick={onBuy}>
        {rubyPackPrice(offer.code, offer.kopecks)}
      </button>
    </div>
  )
}

export function Packs<P extends ShopPack>({
  packs,
  busy,
  onBuy,
  plusTile,
  second,
  onSecond,
  onOfferEnd,
}: {
  packs: P[] | null
  busy: string
  onBuy: (pack: P, art: string) => void
  /** Плитка подписки первой. Гостю её нет. */
  plusTile?: PlusTile
  /** Разовый «Второй шаг» первой карточкой ряда. */
  second?: SecondOffer | null
  onSecond?: () => void
  onOfferEnd?: () => void
}) {
  const t = useT()
  useMoney()
  const starter = packs?.find((p) => p.oneTime) ?? null
  const { list, best: bestFallback } = sortPacks((packs ?? []).filter((p) => !p.oneTime))
  const anyBest = list.some((p) => p.best)
  const starterWas = starter ? usualKopecks(starter.rubies, list) : 0
  const showSecond = !!second && !!onSecond
  const count = (packs === null ? 5 : list.length + (starter ? 1 : 0)) + (showSecond ? 1 : 0)
  return (
    <div className="pk-wrap" id="shopPacks" data-section="ruby_packs">
      {packs !== null && plusTile ? <PlusBundle tile={plusTile} /> : null}
    <div className="pk-grid" style={{ ['--pk-n' as string]: count }}>
      {showSecond ? <SecondCard offer={second!} packs={list} busy={busy === second!.code} onBuy={onSecond!} onEnd={onOfferEnd} /> : null}
      {/* Стартовый набор — такая же плитка пакета, с лентой акции и зачёркнутой ценой. */}
      {starter ? (
        <div className="sh-card pk is-promo" data-kind="ruby_pack" data-id={starter.code}>
          <span className="pk-promo">{t('Акция · один раз')}</span>
          <button className="pk-pick" aria-label={t('{n} рубинов', { n: starter.rubies })} data-track="buy_starter_art" disabled={busy === starter.code} onClick={() => onBuy(starter, '/packs/starter.png')}>
            <PackArt src="/packs/starter.png" />
          </button>
          <button className="btn md primary pk-btn pk-topup" disabled={busy === starter.code} data-track="buy_starter" onClick={() => onBuy(starter, '/packs/starter.png')}>
            <b>
              +{starter.rubies.toLocaleString(intlTag())}
              <Ruby size={16} />
            </b>
            <small>
              {starterWas > starter.kopecks ? <s>{rubyPackWas(starter.code, starter.kopecks, starterWas)}</s> : null} {rubyPackPrice(starter.code, starter.kopecks)}
            </small>
          </button>
        </div>
      ) : null}
      {packs === null
        ? [0, 1, 2, 3, 4].map((n) => <span key={n} className="skel pk-skel" />)
        : list.map((pack, i) => {
            const art = packArtAt(i, list.length)
            const isBest = pack.best || (!anyBest && pack.code === bestFallback)
            // «Берут чаще всего» (решает служба) важнее «выгодно»: на пакете одна плашка.
            const popular = !!pack.popular
            return (
              <div key={pack.code} className="sh-card pk" data-kind="ruby_pack" data-id={pack.code} data-pos={i} data-badge={popular ? 'popular' : isBest ? 'best' : undefined}>
                {popular ? <span className="pk-best pk-pop">{t('Берут чаще всего')}</span> : <PctBadge pct={offerPct(pack.rubies, pack.kopecks, list, pack.badgePct)} best={isBest} />}
                <button className="pk-pick" aria-label={t('{n} рубинов', { n: pack.rubies })} data-track="buy_pack_art" disabled={busy === pack.code} onClick={() => onBuy(pack, art)}>
                  <PackArt src={art} />
                </button>
                <PackCount n={pack.rubies} />
                <button className="btn md primary pk-btn pk-buy" disabled={busy === pack.code} data-track="buy_pack" onClick={() => onBuy(pack, art)}>
                  {rubyPackPrice(pack.code, pack.kopecks)}
                </button>
              </div>
            )
          })}
    </div>
    </div>
  )
}
