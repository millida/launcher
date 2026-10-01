import { useState } from 'react'
import { Ruby } from '../Ruby'
import { rubles, type ShopPack } from '../../lib/rubies'
import { gridCols, Head } from './parts'

/** Базовый курс v3: 7 рубинов за рубль. Бонус пакета — всё, что сверх него. */
const RUBY_KOPECKS = 100 / 7
type Pack = ShopPack & { bonus?: number }

/** Недостающее на счёте, округлённое вверх до целого рубля; 0 — хватает. */
export const topUpKopecks = (short: number): number => (short > 0 ? Math.ceil(short / 100) * 100 : 0)

/**
 * Рисунки пакетов от малого к большому. Кодов у сервера теперь девять и они
 * меняются, поэтому рисунок берётся по месту пакета в ряду, а не по коду.
 */
const ART_ORDER = ['handful', 'pouch', 'purse', 'casket', 'hoard', 'trove', 'treasury', 'vault']
const artAt = (i: number, n: number): string => '/packs/' + ART_ORDER[n < 2 ? 0 : Math.round((i * (ART_ORDER.length - 1)) / (n - 1))] + '.png'

/**
 * Пакеты рубинов.
 *
 * «Выгодно» стоит на пакете, у которого рубин дешевле всех по ответу сервера,
 * а не на том, который нам хочется продать: это считается из живых цен.
 * Рисуем всё, что вернул сервер (сейчас девять), первой плиткой — PLUS.
 */
export function Packs<P extends Pack>({
  packs,
  busy,
  onBuy,
  wallet,
  onTopUp,
  plusOffer,
}: {
  packs: P[] | null
  busy: string
  onBuy: (pack: P) => void
  /** Сколько на счёте Millida, копейки: платят оттуда. */
  wallet?: number
  /** Денег на счёте меньше цены пакета: пополнить счёт на недостающее (копейки, до целого рубля). */
  onTopUp?: (missingKopecks: number, pack: P) => void
  /** Первая плитка: рубины с PLUS. Нет — плитки нет (PLUS уже оформлен или гость). */
  plusOffer?: { kopecks: number; rubies: number; chests: number; onOpen: () => void }
}) {
  const [artGone, setArtGone] = useState<string[]>([])
  const list = [...(packs ?? [])].sort((x, y) => x.kopecks - y.kopecks)
  const best = list.reduce(
    (win, pack) => (pack.kopecks > 0 && pack.rubies / pack.kopecks > win.rate ? { code: pack.code, rate: pack.rubies / pack.kopecks } : win),
    { code: '', rate: 0 },
  ).code

  return (
    <div className="card sh-block" id="shopPacks" data-section="ruby_packs">
      <Head title="Рубины">
        {wallet !== undefined ? <span className="sh-note">На счёте {rubles(wallet)}</span> : null}
      </Head>
      <div className="sh-grid is-fit" style={gridCols(packs === null ? 5 : list.length + (plusOffer ? 1 : 0))}>
        {packs !== null && plusOffer ? (
          <div className="sh-card sh-pack is-plus" data-kind="plus_offer" data-id="plus" data-pos={-1}>
            <span className="sh-best is-big">Выгоднее всего</span>
            <b className="sh-plus-name">PLUS</b>
            <span className="sh-pack-art">
              <Ruby size={56} />
            </span>
            <span className="sh-pack-count">
              <Ruby size={18} />
              {plusOffer.rubies.toLocaleString('ru-RU')}
            </span>
            <span className="sh-pack-bonus">+ {plusOffer.chests} сундуков, осколки x1,5</span>
            <span className="sh-pack-bonus is-dim">Милли 100 в день, значок</span>
            <button className="btn sm primary" data-track="plus_tile" onClick={plusOffer.onOpen}>
              {rubles(plusOffer.kopecks)} / 28 дней
            </button>
          </div>
        ) : null}
        {packs === null
          ? [0, 1, 2, 3, 4].map((n) => <span key={n} className="skel sh-skel sh-cell" />)
          : list.map((pack, i) => {
              // Не хватает на счёте — кнопка сразу ведёт пополнять недостающее (правка 24.09.2026).
              const missing = wallet !== undefined && onTopUp ? topUpKopecks(pack.kopecks - wallet) : 0
              const bonus = pack.bonus ?? Math.max(0, Math.round(pack.rubies - pack.kopecks / RUBY_KOPECKS))
              return (
                <div key={pack.code} className="sh-card sh-pack" data-kind="ruby_pack" data-id={pack.code} data-pos={i}>
                  {pack.code === best && !plusOffer ? <span className="sh-best">Выгодно</span> : null}
                  <span className="sh-pack-art">
                    {!artGone.includes(pack.code) ? (
                      <img
                        src={artAt(i, list.length)}
                        alt=""
                        draggable={false}
                        onError={() => setArtGone((was) => (was.includes(pack.code) ? was : [...was, pack.code]))}
                      />
                    ) : (
                      <Ruby size={56} />
                    )}
                  </span>
                  <span className="sh-pack-count">
                    <Ruby size={18} />
                    {pack.rubies.toLocaleString('ru-RU')}
                  </span>
                  <span className="sh-pack-bonus">{bonus > 0 ? '+' + bonus.toLocaleString('ru-RU') + ' сверху' : ''}</span>
                  {missing > 0 ? (
                    <button className="btn sm secondary sh-pack-topup" data-tip={'Цена ' + rubles(pack.kopecks)} data-track="wallet_topup" onClick={() => onTopUp!(missing, pack)}>
                      Пополнить {rubles(missing)}
                    </button>
                  ) : (
                    <button className="btn sm primary" disabled={busy === pack.code} data-track="buy_pack" onClick={() => onBuy(pack)}>
                      {rubles(pack.kopecks)}
                    </button>
                  )}
                </div>
              )
            })}
      </div>
    </div>
  )
}
