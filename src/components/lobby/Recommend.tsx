import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type ReactNode } from 'react'
import { renderLive } from '../../lib/renderGate'
import { Icon } from '../Icon'
import { anarchyOnlineShown } from '../playhub/AnarchyTile'
import { ANARCHY_HERO, LAVA_STRIP, OBSIDIAN_TILE } from '../playhub/anarchyArt'
import { ANARCHY, anarchyMode } from '../../lib/ownServer'
import { loadAnarchyOnline, useAnarchy } from '../../lib/anarchy'
import { usePromo } from '../../state/promo'
import { playMode } from '../../lib/lobbyPlay'
import { useLobby } from '../../state/lobbyMode'
import { useProfiles } from '../../state/profiles'
import { fmtN } from '../../lib/format'
import { trackImpression } from '../../lib/uiTrack'
import { setScreen } from '../../state/ui'
import { loadCatalogPacks } from '../playhub/data'
import { PRISON_SLUG } from '../playhub/featured'
import { PxIcon } from '../PxIcon'
import { PlusMark } from '../premium/PlusMark'
import { modeIcon } from '../playhub/modeIcon'
import { hasMillidaAccount, openExt } from '../../lib/api'
import { loadDiscordReward, loadTelegramReward } from '../../lib/rubies'
import { TIER_SERVER } from '../../state/tiers'
import { openPvpArena } from '../playhub/hubTab'
import { ARCANIA_SLUG, DISCORD_INVITE, PROMO_ROTATE_MS, TELEGRAM_CHAT, promoAt, promoSeed, promoSlides, promoStart } from './promo'
import { PRISON_BANNER, PRISON_CO, type PrisonFace } from '../playhub/PrisonTile'
import { loadInvites } from '../../lib/referrals'
import { pickFriendsTab } from '../friends/friendsView'
import { t, useMarket, useMarketOffers, useT, type Market } from '../../i18n'
import '../../styles/pixel/playhub.css'
import { TIERS_SECTION_PUBLIC } from '../../lib/tiersSection'
import { ArcaniaCover, ArcaniaFx, ArcaniaName, isArcania } from '../arcania/ArcaniaCard'
import { enterArcania } from '../arcania/transition'

type PackFace = PrisonFace

/**
 * Баннер справа в лобби — карусель раз в минуту (владелец 11.10.2026): чаты
 * игроков в Discord и Telegram, наша анархия, Аркания, PrisonRPG и сервер
 * PvP-тиров. Наведение держит слайд. API по-прежнему может снять баннер без
 * релиза (promo.lobby).
 */
export function Recommend({ on }: { on: boolean }) {
  const t = useT()
  const shown = usePromo((s) => s.promo.lobby === ANARCHY.mode)
  const partners = useMarketOffers('partners')
  const ruContent = useMarketOffers('ru-content')
  const [packs, setPacks] = useState<{ prison: PackFace | null; arcania: PackFace | null } | undefined>(undefined)
  const [step, setStep] = useState(0)
  // Направление последней смены: слайд въезжает с той стороны, куда листали.
  const [dir, setDir] = useState<1 | -1>(1)
  // Ручное листание перезапускает таймер: только что выбранный слайд не уезжает через секунду.
  const [touch, setTouch] = useState(0)
  const hovered = useRef(false)
  const swipe = useRef<{ x: number; moved: boolean } | null>(null)
  const rewards = useChatRewards(on && shown)
  const invite = useInviteOffer(on && shown)
  const slides = packs ? promoSlides({ arcania: !!packs.arcania, prisonrpg: !!packs.prison, invite: !!invite, partners, ruContent }).filter((s) => TIERS_SECTION_PUBLIC || s !== 'smp') : null
  const seed = promoSeed()
  const start = slides ? promoStart(slides.length, seed.day, seed.salt) : 0
  const slide = slides ? promoAt(slides, start, step) : null

  useEffect(() => {
    if (!on || !shown || !slides) return
    const id = window.setInterval(() => {
      if (hovered.current || !renderLive()) return
      setDir(1)
      setStep((s) => s + 1)
    }, PROMO_ROTATE_MS)
    return () => window.clearInterval(id)
  }, [on, shown, !!slides, touch])

  useEffect(() => {
    if (!shown) return
    let alive = true
    const face = (p: { title: string; cover: string | null; online?: number | null } | undefined): PackFace | null =>
      p ? { title: p.title, coverUrl: p.cover, online: typeof p.online === 'number' ? p.online : null } : null
    void loadCatalogPacks().then((list) => {
      if (alive) setPacks({ prison: face(list.find((x) => x.slug === PRISON_SLUG)), arcania: face(list.find((x) => x.slug === ARCANIA_SLUG)) })
    }).catch(() => {
      if (alive) setPacks({ prison: null, arcania: null })
    })
    return () => {
      alive = false
    }
  }, [shown])

  useEffect(() => {
    if (!on || !shown || !slide) return
    const id = slide === 'anarchy' ? 'own_server:' + ANARCHY.mode : slide === 'prisonrpg' || slide === 'arcania' ? 'pack:' + (slide === 'arcania' ? ARCANIA_SLUG : PRISON_SLUG) : 'promo:' + slide
    trackImpression('recommend', [id], 'play')
  }, [on, shown, slide])

  if (!shown || !slide || !slides) return null
  const go = (delta: 1 | -1) => {
    setDir(delta)
    setStep((s) => s + delta)
    setTouch((t) => t + 1)
  }
  const jump = (i: number) => {
    const cur = slides.indexOf(slide)
    if (i === cur) return
    setDir(i > cur ? 1 : -1)
    setStep((s) => s + (i - cur))
    setTouch((t) => t + 1)
  }
  const hover: Hover = {}
  let body: ReactNode
  if (slide === 'prisonrpg' && packs?.prison) body = <PrisonRecommend pack={packs.prison} hover={hover} dots={null} />
  else if (slide === 'arcania' && packs?.arcania) body = <PackPromo slug={ARCANIA_SLUG} pack={packs.arcania} hover={hover} dots={null} />
  else if (slide === 'discord' || slide === 'telegram') body = <ChatPromo kind={slide} reward={rewards[slide]} />
  else if (slide === 'smp') body = <SmpPromo hover={hover} dots={null} />
  else if (slide === 'invite' && invite) body = <InvitePromo plusDays={invite.plusDays} />
  else body = <AnarchyPromo on={on} hover={hover} dots={null} />

  return (
    <div
      className="lrec-wrap"
      onPointerEnter={() => {
        hovered.current = true
      }}
      onPointerLeave={() => {
        hovered.current = false
        swipe.current = null
      }}
      onPointerDown={(e) => {
        swipe.current = { x: e.clientX, moved: false }
      }}
      onPointerUp={(e) => {
        const sw = swipe.current
        if (!sw) return
        const dx = e.clientX - sw.x
        if (Math.abs(dx) > 40) {
          sw.moved = true
          go(dx < 0 ? 1 : -1)
        }
      }}
      onClickCapture={(e) => {
        // Свайп не должен заодно нажимать на слайд под пальцем.
        if (swipe.current?.moved) {
          e.stopPropagation()
          e.preventDefault()
          swipe.current = null
        }
      }}
      onWheel={(e) => {
        if (Math.abs(e.deltaX) > 30 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) go(e.deltaX > 0 ? 1 : -1)
      }}
    >
      <div key={slide + ':' + step} className={'lrec-slide ' + (dir > 0 ? 'from-r' : 'from-l')}>
        {body}
      </div>
      <button className="lrec-arrow l" aria-label={t('Предыдущий')} data-track="recommend_prev" onClick={() => go(-1)}>
        <Icon id="i-chev-r" />
      </button>
      <button className="lrec-arrow r" aria-label={t('Следующий')} data-track="recommend_next" onClick={() => go(1)}>
        <Icon id="i-chev-r" />
      </button>
      <span className="lrec-dots">
        {slides.map((sl, i) => (
          <button key={sl} className={sl === slide ? 'on' : undefined} aria-label={t('Слайд {n}', { n: i + 1 })} onClick={() => jump(i)} />
        ))}
      </span>
    </div>
  )
}

/** Награды за Telegram и Discord из магазина: есть незабранная — слайд зовёт её забрать. */
function useChatRewards(on: boolean): { telegram: number; discord: number } {
  const [r, setR] = useState({ telegram: 0, discord: 0 })
  useEffect(() => {
    if (!on || !hasMillidaAccount()) return
    let alive = true
    const take = (v: { available?: boolean; claimed?: boolean; amount?: number } | null) =>
      v && v.available && !v.claimed && typeof v.amount === 'number' ? v.amount : 0
    void Promise.allSettled([loadTelegramReward(), loadDiscordReward()]).then(([t, d]) => {
      if (!alive) return
      setR({ telegram: t.status === 'fulfilled' ? take(t.value) : 0, discord: d.status === 'fulfilled' ? take(d.value) : 0 })
    })
    return () => {
      alive = false
    }
  }, [on])
  return r
}

/// The slide quotes the referral terms the server answers with, so it stays hidden until they arrive.
function useInviteOffer(on: boolean): { plusDays: number } | null {
  const [offer, setOffer] = useState<{ plusDays: number } | null>(null)
  useEffect(() => {
    if (!on || !hasMillidaAccount()) return
    let alive = true
    void loadInvites()
      .then((r) => {
        if (alive && r.perFriendPlusDays > 0) setOffer({ plusDays: r.perFriendPlusDays })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [on])
  return offer
}

/** Открыть магазин на задании и подсветить его (блок грузится вместе с магазином — ждём до 4 с). */
function openShopTask(id: string) {
  setScreen('rubies')
  const t0 = Date.now()
  const find = () => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('sh-flash')
      window.setTimeout(() => el.classList.remove('sh-flash'), 1600)
    } else if (Date.now() - t0 < 4000) window.setTimeout(find, 150)
  }
  window.setTimeout(find, 150)
}

type Hover = Pick<ComponentProps<'button'>, 'onPointerEnter' | 'onPointerLeave'>

/** The lobby banner of our anarchy in one palette: obsidian, lava and white. Pressing it starts the game right away. */
function AnarchyPromo({ on, hover, dots }: { on: boolean; hover: Hover; dots: ReactNode }) {
  const t = useT()
  const [online, setOnline] = useState<number | null>(null)
  const an = useAnarchy()

  useEffect(() => {
    if (!on) return
    let alive = true
    void loadAnarchyOnline().then((n) => alive && setOnline(n))
    return () => {
      alive = false
    }
  }, [on, an.addr])

  const play = () => {
    const m = anarchyMode()
    useLobby.getState().pick(m)
    void playMode(m, useProfiles.getState().profiles)
  }

  return (
    <button
      className="lobby-rec lobby-an"
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind="own_server"
      data-id={ANARCHY.mode}
      data-pos={0}
      aria-label={t('Играть: {name}', { name: an.fullName })}
      style={{ '--px-img': 'url("' + OBSIDIAN_TILE + '")' } as CSSProperties}
      onClick={play}
      {...hover}
    >
      <img className="lan-hero" src={ANARCHY_HERO} alt="" draggable={false} />
      <span className="an-lava" aria-hidden="true" style={{ '--lava': 'url("' + LAVA_STRIP + '")' } as CSSProperties}>
        <i />
      </span>
      <span className="lan-co">MCRU.ME × Millida</span>
      <span className="lan-title">
        {t('Полная')}
        <br />
        <em>{t('анархия')}</em>
      </span>
      <span className="lan-foot">
        <span className="lan-go">
          <Icon id="i-play" /> {t('Играть')}
        </span>
        {anarchyOnlineShown(online) ? (
          <span className="lan-on">
            <span className="ph-dot" aria-hidden="true"></span>
            {t('{n} играют', { n: fmtN(online) })}
          </span>
        ) : null}
      </span>
      {dots}
    </button>
  )
}

// Discord и Telegram: есть награда — «+300 рубинов» и кнопка в задание магазина
// (владелец 11.10.2026: «мотивация — подпишись, получи»); забрана — просто вход.
const CHAT = {
  discord: { url: DISCORD_INVITE, task: 'shop-discord', icon: 'discord' },
  telegram: { url: TELEGRAM_CHAT, task: 'shop-telegram', icon: 'telegram' },
} as const

// Abroad the Discord slide is the plain invitation the owner asked for: «Join our Discord».
const chatCopy = (kind: 'discord' | 'telegram', market: Market) =>
  kind === 'discord'
    ? market === 'RU'
      ? { what: t('за Discord'), title: t('Войсы и пати'), where: t('в Discord'), go: t('Зайти') }
      : { what: t('за Discord'), title: t('Вступай в наш'), where: 'Discord', go: t('Вступить') }
    : { what: t('за Telegram'), title: t('Новости первыми'), where: t('в Telegram'), go: t('Подписаться') }

function ChatPromo({ kind, reward }: { kind: 'discord' | 'telegram'; reward: number }) {
  const t = useT()
  const c = CHAT[kind]
  const market = useMarket()
  const copy = chatCopy(kind, market)
  const paid = reward > 0
  return (
    <button
      className={'lobby-rec lobby-an lobby-chat is-' + kind + (paid ? ' is-reward' : '')}
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind="chat"
      data-id={kind + (paid ? '_reward' : '')}
      data-pos={0}
      aria-label={paid ? t('+{n} рубинов {what}', { n: reward, what: copy.what }) : copy.title + ' ' + copy.where}
      onClick={() => (paid ? openShopTask(c.task) : openExt(c.url))}
    >
      {paid ? <img className="lch-pile" src="/packs/hoard.png" alt="" draggable={false} /> : null}
      <span className="lch-logo" aria-hidden="true">
        <PxIcon name={c.icon} />
      </span>
      {paid ? (
        <span className="lan-title lch-reward">
          <em>+{reward}</em>
          <small>{t('рубинов {what}', { what: copy.what })}</small>
        </span>
      ) : (
        <span className="lan-title">
          {copy.title}
          <br />
          <em>{copy.where}</em>
        </span>
      )}
      <span className="lan-foot">
        <span className="lan-go">
          <Icon id={paid ? 'i-gift' : 'i-play'} /> {paid ? t('Забрать') : copy.go}
        </span>
      </span>
    </button>
  )
}

function InvitePromo({ plusDays }: { plusDays: number }) {
  const open = () => {
    setScreen('friends')
    pickFriendsTab('invite')
  }
  return (
    <button
      className="lobby-rec lobby-an lobby-chat is-invite"
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind="promo"
      data-id="invite"
      data-pos={0}
      aria-label={t('Бесплатный PLUS за друга')}
      onClick={open}
    >
      <span className="lch-logo" aria-hidden="true">
        <PlusMark height={30} shine />
      </span>
      <span className="lan-co">{t('+{days} дн. PLUS за каждого друга', { days: plusDays })}</span>
      <span className="lan-title">
        {t('Бесплатный PLUS')}
        <br />
        <em>{t('за друга')}</em>
      </span>
      <span className="lan-foot">
        <span className="lan-go">
          <Icon id="i-users" /> {t('Пригласить')}
        </span>
      </span>
    </button>
  )
}

/** Сервер PvP-тиров: вход сразу на экзамен, тир пишется на аккаунт Millida. */
function SmpPromo({ hover, dots }: { hover: Hover; dots: ReactNode }) {
  const t = useT()
  const rig = modeIcon('PVP')?.rig
  return (
    <button
      className="lobby-rec lobby-an lobby-smp"
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind="own_server"
      data-id="millida-smp"
      data-pos={0}
      aria-label={t('Играть: {name}', { name: TIER_SERVER.name })}
      onClick={() => openPvpArena()}
      {...hover}
    >
      {rig ? <img className="lan-hero lsmp-rig" src={rig.url} alt="" draggable={false} /> : null}
      <span className="lan-co">{TIER_SERVER.name}</span>
      <span className="lan-title">
        {t('Узнай свой')}
        <br />
        <em>{t('PvP-тир')}</em>
      </span>
      <span className="lan-foot">
        <span className="lan-go">
          <Icon id="i-play" /> {t('Играть')}
        </span>
      </span>
      {dots}
    </button>
  )
}

/** Сборка из каталога (Аркания) во весь баннер: открывает её страницу в «Во что играем». */
function PackPromo({ slug, pack, hover, dots }: { slug: string; pack: PackFace; hover: Hover; dots: ReactNode }) {
  const t = useT()
  // Arcania — в своей коже (зелёная рамка с искрами, «Arcania 2.0») и с переходом
  // пикселями, как на её страницу из каталога.
  const arc = isArcania(slug)
  const open = () => {
    const go = () => {
      useLobby.setState({ hubTarget: { pack: slug } })
      setScreen('playhub')
    }
    if (arc) enterArcania(go)
    else go()
  }
  return (
    <button
      className={'lobby-rec lobby-an lobby-pr lobby-pack' + (arc ? ' arc2-skin lobby-arc' : '')}
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind="pack"
      data-id={slug}
      data-pos={0}
      aria-label={t('Открыть: {name}', { name: pack.title })}
      onClick={open}
      {...hover}
    >
      {arc ? (
        <ArcaniaCover className="lpr-art" />
      ) : pack.coverUrl ? (
        <img className="lpr-art" src={pack.coverUrl} alt="" draggable={false} />
      ) : null}
      <span className="pr-co">{arc ? <ArcaniaName /> : pack.title}</span>
      <span className="lan-foot">
        <span className="lan-go">
          <Icon id="i-arrow-r" /> {t('Открыть')}
        </span>
      </span>
      {dots}
      {arc ? <ArcaniaFx /> : null}
    </button>
  )
}

/**
 * PrisonRPG in the anarchy's lobby spot on its turn: the same CTA over the
 * partner's full banner. It is a native game, so pressing it opens its
 * pack page in «Во что играем» instead of joining a server.
 */
function PrisonRecommend({ pack, hover, dots }: { pack: PrisonFace; hover: Hover; dots: ReactNode }) {
  const t = useT()
  const open = () => {
    useLobby.setState({ hubTarget: { pack: PRISON_SLUG } })
    setScreen('playhub')
  }
  return (
    <button
      className="lobby-rec lobby-an lobby-pr"
      data-sound="open"
      data-track="recommend"
      data-section="recommend"
      data-src="recommend"
      data-kind="pack"
      data-id={PRISON_SLUG}
      data-pos={0}
      aria-label={t('Открыть: {name}', { name: pack.title })}
      onClick={open}
      {...hover}
    >
      <img className="lpr-art" src={pack.coverUrl || PRISON_BANNER} alt="" draggable={false} />
      <span className="pr-co">{PRISON_CO}</span>
      <span className="lan-foot">
        <span className="lan-go">
          <Icon id="i-play" /> {t('Играть')}
        </span>
        {anarchyOnlineShown(pack.online) ? (
          <span className="lan-on">
            <span className="ph-dot" aria-hidden="true"></span>
            {t('{n} играют', { n: fmtN(pack.online) })}
          </span>
        ) : null}
      </span>
      {dots}
    </button>
  )
}
