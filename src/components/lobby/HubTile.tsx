import { useEffect, useState } from 'react'
import { useShopGiftReady } from '../shop'
import { dailyReady, useDaily } from '../../state/daily'
import { api, hasMillidaAccount } from '../../lib/api'
import { track } from '../../lib/telemetry'
import { useUi } from '../../state/ui'
import '../../styles/pixel/hubtile.css'

/**
 * Плитка раздела под сундуком лобби (23.09.2026, «сделайте всё остальное
 * точно так же», как Battle Pass). Ширина — как у <DailyChest hero/>, 196 px.
 *
 * Язык тот же, что у окна наград (docs/DESIGN-JUICE.md):
 * - рамка слоями: тёмный силуэт → плита цвета раздела → грани света и тени,
 *   каждый слой со своим срезом, поэтому линия не рвётся на ступеньке;
 * - за артом — жёсткие лучи (стопы без растушёвки);
 * - арт СТОИТ на плитке: прижат к низу, крупно, над верхней кромкой выходят
 *   только головы (правка владельца 23.09.2026: «вылезают слишком высоко»);
 * - подпись — на плотной плашке поверх низа арта, одна строка;
 * - в покое ничего не движется, на наведении арт подпрыгивает ступенями.
 */
export type HubTileKind = 'shop' | 'server' | 'daily' | 'wardrobe'

const ART: Record<HubTileKind, string> = {
  shop: '/lobby/skins@2x.png',
  server: '/lobby/duo@2x.webp',
  daily: '/lobby/daily@2x.png',
  wardrobe: '/lobby/capes@2x.png',
}

/** Свой скин уже открывали — «!» на «Моём скине» гаснет. */
const SKIN_SEEN_KEY = 'm-skin-seen'
const skinSeen = () => {
  try {
    return localStorage.getItem(SKIN_SEEN_KEY) === '1'
  } catch {
    return true
  }
}

function go(kind: HubTileKind) {
  if (kind === 'wardrobe') {
    try {
      localStorage.setItem(SKIN_SEEN_KEY, '1')
    } catch {}
    useUi.getState().setScreen('skins')
    return
  }
  const screen = kind === 'shop' ? 'rubies' : 'hosting'
  if (kind === 'server') track('hosting_open', {})
  useUi.getState().setScreen(screen)
}


/** Плитка «Бонус за вход» — тот же вид, данные и клик отдаёт DailyChest. */
export interface HubTileDaily {
  title: string
  sub: string
  ribbon: string | null
  hot: boolean
  onClick: () => void
  /** Свой арт вместо картинки раздела (пиксельный сундук). */
  art?: string
}

export function HubTile({ kind, className, daily }: { kind: HubTileKind; className?: string; daily?: HubTileDaily }) {
  const shopGiftRaw = useShopGiftReady()
  const shop = kind === 'shop'
  // Ежедневный бонус внутри магазина: не забран — «!» и «Бонус ждёт».
  const bonus = useDaily((s) => dailyReady(s.status))
  useEffect(() => {
    if (kind === 'shop' && hasMillidaAccount()) void useDaily.getState().load()
  }, [kind])
  const shopGift = shopGiftRaw || bonus
  // «Создать сервер», а у кого сервер уже есть — «Мои серверы» (правка 21:24).
  const [servers, setServers] = useState(0)
  useEffect(() => {
    if (kind !== 'server' || !hasMillidaAccount()) return
    let alive = true
    api<unknown>('/hosting/servers/me')
      .then((l) => alive && setServers(Array.isArray(l) ? l.length : 0))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [kind])
  const gift = shop && shopGift
  const skin = kind === 'wardrobe'
  const skinNew = skin && !skinSeen()
  const hot = gift || !!daily?.hot || skinNew
  // «Мой скин» вместо «Гардероба»: школьнику сразу ясно, где загрузить свой
  // скин (правка владельца 23.09.2026, 21:31).
  // Хостинг продаётся через друзей (владелец 24.09.2026, 13:33): плитка зовёт
  // играть вместе, а не «Мои серверы». Друзья в сети — живым числом.
  const title = daily ? daily.title : skin ? 'Мой скин' : shop ? 'Магазин' : 'Играть с друзьями'
  const sub = daily
    ? daily.sub
    : skin
      ? skinNew
        ? 'Загрузи свой'
        : null
      : shop
      ? bonus
        ? 'Бонус ждёт'
        : gift
          ? 'Есть новое'
          : null
      : null
  const ribbon = daily || skin || shop ? null : servers ? null : 'Бесплатно'
  return (
    <button
      type="button"
      className={'ht ht-' + kind + (hot ? ' is-gift' : '') + (className ? ' ' + className : '')}
      data-sound="nav"
      data-track={'tile_' + (daily ? 'daily' : kind)}
      data-section="lobby_tiles"
      onClick={() => (daily ? daily.onClick() : go(kind))}
      aria-label={title + (sub ? ': ' + sub : '')}
    >
      <span className="ht-frame" aria-hidden="true">
        <span className="ht-plate">
          <span className="ht-rays" />
          <span className="ht-edge-t" />
        </span>
      </span>
      <span className="ht-artbox" aria-hidden="true">
        <img className="ht-art" src={daily?.art || ART[kind]} alt="" draggable={false} />
      </span>
      <span className="ht-band">
        <b className="ht-title">{title}</b>
        {sub ? <span className="ht-sub">{sub}</span> : null}
        {ribbon ? <span className="ht-ribbon">{ribbon}</span> : null}
      </span>
      {hot ? (
        <span className="ht-gift" aria-hidden="true">
          !
        </span>
      ) : null}
    </button>
  )
}
