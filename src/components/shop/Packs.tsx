import { useState, type ReactNode } from 'react'
import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { DIAMOND_ITEM_PCT, PLUS_ITEM_PCT, rubles, type ChestTier, type MonthOffer, type ShopPack } from '../../lib/rubies'
import { BoltArt, GemArt } from './shopArt'
import { NickFlip } from '../premium/StatusCompare'
import { PlusMark } from '../premium/PlusMark'
import { PLUS_CHESTS } from './PlusBanner'
import { ChestArt } from '../daily/ChestArt'
import { CHEST_DROPS, PLUS_PASS } from '../daily/chestDrops'
import { Shard, Timer } from './parts'
import { FragmentIcon } from './rarityUi'
import { useOffscreenPause } from './useOffscreen'
import '../../styles/pixel/plus-bundle.css'

/** Недостающее на счёте, округлённое вверх до целого рубля; 0 — хватает. */
export const topUpKopecks = (short: number): number => (short > 0 ? Math.ceil(short / 100) * 100 : 0)

/**
 * Рисунки пакетов от малого к большому. Кодов у сервера девять и они
 * меняются, поэтому рисунок берётся по месту пакета в ряду, а не по коду.
 */
// Девять рисунков на девять пакетов службы: у каждого свой (chests — два сундука, 06.10.2026).
const ART_ORDER = ['handful', 'pouch', 'purse', 'casket', 'chests', 'hoard', 'trove', 'treasury', 'vault']
export const packArtAt = (i: number, n: number): string => '/packs/' + ART_ORDER[n < 2 ? 0 : Math.round((i * (ART_ORDER.length - 1)) / (n - 1))] + '.png'

/** Пакеты по цене и код самого выгодного (рубин дешевле всех по живым ценам). */
export function sortPacks<P extends ShopPack>(packs: P[]): { list: P[]; best: string } {
  const list = [...packs].sort((x, y) => x.kopecks - y.kopecks)
  const best = list.reduce(
    (win, pack) => (pack.kopecks > 0 && pack.rubies / pack.kopecks > win.rate ? { code: pack.code, rate: pack.rubies / pack.kopecks } : win),
    { code: '', rate: 0 },
  ).code
  return { list, best }
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
}

type PlusTier = 'PLUS' | 'DIAMOND'

/** Сундуки пропуска PLUS по уровням — как в треке службы (SEASON_TRACK: 3 редких, 5 эпических, легендарный). */
const PASS_CHESTS = (['RARE', 'EPIC', 'LEGEND'] as ChestTier[])
  .map((t) => ({ tier: t, n: PLUS_PASS.chests[t] ?? 0 }))
  .filter((c) => c.n > 0)
const CHEST_LABEL: Record<ChestTier, string> = { COMMON: 'Обычный', RARE: 'Редкий', EPIC: 'Эпический', LEGEND: 'Легендарный' }
/** Пример зачёркнутой цены в плитке скидки. */
const EXAMPLE_PRICE = 1000
const cut = (price: number, pct: number) => Math.max(10, Math.round((price * (100 - pct)) / 100 / 10) * 10)
const nf = (n: number) => n.toLocaleString('ru-RU')

/** Плитка содержимого бандла: картинка крупно, число, подпись в одно слово. */
function Part({ art, n, cap, tone, wide, now, children }: { art: ReactNode; n: ReactNode; cap?: ReactNode; tone?: string; wide?: boolean; now?: boolean; children?: ReactNode }) {
  return (
    <span className={'pb-part' + (wide ? ' is-wide' : '')} style={tone ? { ['--pb-tone' as string]: tone } : undefined}>
      {now ? (
        <i className="pb-stamp">
          <BoltArt size={12} />
          сразу
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
function ChestInside() {
  return (
    <span className="pb-in" role="tooltip">
      {PASS_CHESTS.map(({ tier, n }) => {
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
              {d.items === 1 ? '1 вещь' : d.items + ' вещи'}
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
  const paused = useOffscreenPause<HTMLDivElement>()
  const [pick, setPick] = useState<PlusTier>('PLUS')
  const [inside, setInside] = useState(false)
  const dia = tile.sub ? !!tile.diamond : pick === 'DIAMOND'
  const tier: PlusTier = dia ? 'DIAMOND' : 'PLUS'
  const pct = dia ? DIAMOND_ITEM_PCT : PLUS_ITEM_PCT
  const buy = () => (tile.onPick && !tile.sub ? tile.onPick(tier) : tile.onOpen())
  const label = tile.sub || !tile.prices ? tile.label : 'Купить · ' + tile.prices[tier]
  return (
    <div className={'pb pb2' + (dia ? ' is-diamond' : '')} ref={paused} data-kind="plus_offer" data-id="plus" data-tier={tier}>
      <span className="pb-ribbon">{dia ? 'Всё сразу — в день покупки' : 'Выгоднее, чем просто рубины'}</span>
      <div className="pb-top">
        <button className="pb-head" aria-label={'Millida ' + tier} data-track="plus_tile_art" onClick={buy}>
          <PlusMark tier={tier} height={dia ? 28 : 38} shine />
        </button>
        {tile.sub || !tile.prices ? null : (
          <span className="pb-seg" role="radiogroup" aria-label="Тариф">
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
              сразу: <Ruby size={18} />
              <b>{nf(tile.rubies)}</b> + <b>{PLUS_CHESTS}</b> сундуков
            </>
          ) : (
            <>по дням, 28 дней</>
          )}
        </span>
        <NickFlip />
      </div>
      <div className="pb-body">
        <div className="pb-parts">
          <Part art={<img src="/packs/treasury.png" alt="" draggable={false} />} n={<><Ruby size={20} />{nf(tile.rubies)}</>} cap="рубинов" tone="#e8364f" now={dia} />
          <Part
            wide
            now={dia}
            tone="#a855f7"
            art={
              <span className="pb-chests">
                {PASS_CHESTS.map(({ tier: t, n }) => (
                  <span key={t} className={'pb-chest tier-' + t.toLowerCase()}>
                    <ChestArt ready={false} tier={t} size={t === 'LEGEND' ? 72 : 62} />
                    <b>×{n}</b>
                  </span>
                ))}
              </span>
            }
            n={PLUS_CHESTS + ' сундуков'}
          >
            <span className={'pb-inside' + (inside ? ' is-open' : '')} onMouseLeave={() => setInside(false)}>
              <button className="pb-inside-btn" data-notip aria-expanded={inside} data-track="plus_tile_inside" onClick={() => setInside((v) => !v)}>
                что внутри
              </button>
              <ChestInside />
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
            n="на всё"
            cap="в магазине"
          />
          <Part art={<Shard size={60} />} n={'×' + String(PLUS_PASS.shardBoost).replace('.', ',')} cap="осколки" tone="#36b3ff" />
          <Part art={<FragmentIcon rarity="EPIC" size={60} />} n="фрагменты" cap="вещей" tone="#f5b301" />
        </div>
        <div className="pb-buy">
          <button className={'btn lg pl-btn pb-btn ' + (dia ? 'is-diamond' : 'is-plus')} data-track="plus_tile" onClick={buy}>
            {dia ? <GemArt size={22} /> : <Icon id="i-crown" />}
            {label}
          </button>
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
  const was = usualKopecks(offer.rubies, packs)
  return (
    <section className="mo" data-section="month_offer" data-kind="ruby_pack" data-id={offer.code}>
      <button className="mo-art" aria-label={offer.rubies + ' рубинов'} data-track="buy_month_art" disabled={busy} onClick={onBuy}>
        <img src="/packs/vault.png" alt="" draggable={false} />
      </button>
      <div className="mo-mid">
        <span className="mo-tags">
          <b className="mo-once">Один раз</b>
          <Timer to={offer.endsAt} onEnd={onEnd} />
        </span>
        <b className="mo-n">
          {offer.rubies.toLocaleString('ru-RU')}
          <Ruby size={40} />
        </b>
        <small className="mo-title">{offer.title}</small>
      </div>
      <button className="btn lg primary mo-btn" disabled={busy} data-track="buy_month" onClick={onBuy}>
        {was > offer.kopecks ? <s>{rubles(was)}</s> : null}
        {rubles(offer.kopecks)}
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
    {n.toLocaleString('ru-RU')}
  </b>
)

/**
 * Рубины (ТЗ v3): первая плитка — PLUS (корона, ◆2100, цена), дальше пакеты:
 * картинка, число крупно, кнопка с ценой в рублях. Лучший — значок «выгодно».
 */
export function Packs<P extends ShopPack>({
  packs,
  busy,
  onBuy,
  plusTile,
}: {
  packs: P[] | null
  busy: string
  onBuy: (pack: P, art: string) => void
  /** Плитка подписки первой. Гостю её нет. */
  plusTile?: PlusTile
}) {
  const starter = packs?.find((p) => p.oneTime) ?? null
  const { list, best } = sortPacks((packs ?? []).filter((p) => !p.oneTime))
  const starterWas = starter ? usualKopecks(starter.rubies, list) : 0
  return (
    <div className="pk-wrap" id="shopPacks" data-section="ruby_packs">
      {packs !== null && plusTile ? <PlusBundle tile={plusTile} /> : null}
    <div className="pk-grid" style={{ ['--pk-n' as string]: packs === null ? 5 : list.length + (starter ? 1 : 0) }}>
      {/* Стартовый набор — такая же плитка пакета, с лентой акции и зачёркнутой ценой. */}
      {starter ? (
        <div className="sh-card pk is-promo" data-kind="ruby_pack" data-id={starter.code}>
          <span className="pk-promo">Акция · один раз</span>
          <button className="pk-pick" aria-label={starter.rubies + ' рубинов'} data-track="buy_starter_art" disabled={busy === starter.code} onClick={() => onBuy(starter, '/packs/starter.png')}>
            <PackArt src="/packs/starter.png" />
          </button>
          <button className="btn md primary pk-btn pk-topup" disabled={busy === starter.code} data-track="buy_starter" onClick={() => onBuy(starter, '/packs/starter.png')}>
            <b>
              +{starter.rubies.toLocaleString('ru-RU')}
              <Ruby size={16} />
            </b>
            <small>
              {starterWas > starter.kopecks ? <s>{rubles(starterWas)}</s> : null} {rubles(starter.kopecks)}
            </small>
          </button>
        </div>
      ) : null}
      {packs === null
        ? [0, 1, 2, 3, 4].map((n) => <span key={n} className="skel pk-skel" />)
        : list.map((pack, i) => {
            const art = packArtAt(i, list.length)
            return (
              <div key={pack.code} className="sh-card pk" data-kind="ruby_pack" data-id={pack.code} data-pos={i}>
                {pack.code === best ? <span className="pk-best">выгодно</span> : null}
                <button className="pk-pick" aria-label={pack.rubies + ' рубинов'} data-track="buy_pack_art" disabled={busy === pack.code} onClick={() => onBuy(pack, art)}>
                  <PackArt src={art} />
                </button>
                <button className="btn md primary pk-btn pk-topup" disabled={busy === pack.code} data-track="buy_pack" onClick={() => onBuy(pack, art)}>
                  <b>
                    +{pack.rubies.toLocaleString('ru-RU')}
                    <Ruby size={16} />
                  </b>
                  <small>{rubles(pack.kopecks)}</small>
                </button>
              </div>
            )
          })}
    </div>
    </div>
  )
}
