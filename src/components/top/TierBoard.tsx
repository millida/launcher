import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { effectiveNick } from '../../state/accounts'
import { api, hasMillidaAccount } from '../../lib/api'
import { modeIcon } from '../playhub/modeIcon'
import { openPvp } from '../../state/pvp'
import { plural } from '../../lib/format'
import {

  bestTier,
  kitIcon,
  modeTitle,
  playerTiers,
  tierLevel,
  tierRank,
  useTiers,
  type TierKitRow,
  type TierModeInfo,
  type TierPeriod,
  type TierPeriodRow,
  type TierPlayer,
  type TierTopEntry,
} from '../../state/tiers'
import '../../styles/pixel/tierlist.css'

const avatarUrl = (nick: string) => 'https://api.millida.net/v2/heads/avatar/' + encodeURIComponent(nick || 'Steve') + '?size=112&safe=1'
const bodyUrl = (nick: string, size = 160) => 'https://api.millida.net/v2/heads/body/' + encodeURIComponent(nick || 'Steve') + '?size=' + size + '&safe=1'

/** Ник для тир-листа: тир пишется на аккаунт Millida, без него своего тира нет. */
export const tierNick = (): string => {
  // Превью (только DEV): ?tiernick=<ник> показывает раздел глазами игрока с тиром.
  if (import.meta.env.DEV) {
    const q = new URLSearchParams(location.search).get('tiernick')
    if (q) return q
  }
  return hasMillidaAccount() ? effectiveNick() : ''
}

export function TierBadge({ tier, big }: { tier: string; big?: boolean }) {
  return (
    <b className={'tr-badge' + (big ? ' big' : '')} data-lv={tierLevel(tier)} data-h={tier.startsWith('H') ? '1' : tier.startsWith('M') ? 'm' : '0'}>
      {tier}
    </b>
  )
}

function KitIcon({ slug, size = 20 }: { slug: string; size?: number }) {
  return <img className="tl-kit-ic" src={kitIcon(slug)} alt="" width={size} height={size} draggable={false} />
}

const points = (n: number) => n + ' ' + plural(n, 'очко', 'очка', 'очков')

/** Все тиры игрока лучшими вперёд. */
function sortedTiers(tiers: Record<string, string>, order: string[]): { mode: string; tier: string }[] {
  return Object.entries(tiers)
    .filter(([, t]) => tierRank(t) !== null)
    .map(([mode, tier]) => ({ mode, tier: tier.toUpperCase() }))
    .sort((a, b) => tierRank(a.tier)! - tierRank(b.tier)! || order.indexOf(a.mode) - order.indexOf(b.mode))
}


const winRate = (w: number, l: number) => (w + l > 0 ? Math.round((100 * w) / (w + l)) + '%' : '—')


/**
 * Главный топ лаунчера — тир-лист PvP (владелец 11.10.2026: «самый основной топ
 * теперь тир-лист», часы и огоньки — фоном). Режимы рядом иконок-предметов, как
 * на millida.net/tiers; три лучших — на пьедестале; свежие тесты — лентой.
 */
export function TierBoard({ on }: { on: boolean }) {
  const nick = tierNick()
  const me = useTiers((s) => (s.nick === nick ? s.me : undefined))
  const top = useTiers((s) => s.top)
  const modes = useTiers((s) => s.modes)
  const failed = useTiers((s) => s.failed)
  const kit = useTiers((s) => s.kit)
  const kitRows = useTiers((s) => (kit === 'all' ? null : s.kitRows[kit] ?? null))
  const stats = useTiers((s) => s.stats)
  const [found, setFound] = useState<TierPlayer | null>(null)

  useEffect(() => {
    if (!on) return
    const t = useTiers.getState()
    void t.load(nick)
    void t.loadLive()
    if (t.kit !== 'all') void t.loadKit(t.kit)
  }, [on, nick])

  const order = modes.map((m) => m.slug)
  // Одна таблица — тиры (владелец 12.10.2026: «три вида переключения — дерьмо»).
  // Сверху своя строка, как у всех; ниже список с первого места, без пьедестала.
  const mine = me ? myLine(me, kit, order) : null

  return (
    <div className="tl">
      <div className="tl-bar">
        <KitRail kit={kit} modes={modes} stats={stats} />
        <SearchBox onFound={setFound} />
      </div>

      {found ? (
        <PlayerCard p={found} modes={modes} onClose={() => setFound(null)} />
      ) : mine ? (
        <div className="tl-mine">
          <span className="tl-mine-cap">Моё место</span>
          <Row l={mine.line} modes={modes} mine />
          {mine.next ? <span className="tl-mine-next">{mine.next}</span> : null}
        </div>
      ) : (
        <JoinBanner hasTier={false} />
      )}

      <Board kit={kit} period="tier" top={top} kitRows={kitRows} periodRows={undefined} order={order} modes={modes} meName={me?.name ?? nick} failed={failed} />
    </div>
  )
}

/** Своя строка: в общем — место и тиры по китам, в ките — тир и ELO; плюс подсказка сервера. */
function myLine(p: TierPlayer, kit: string, order: string[]): { line: Line; next?: string } | null {
  if (kit === 'all') {
    const all = sortedTiers(playerTiers(p), order)
    if (!all.length && !p.points) return null
    return {
      line: {
        pos: p.rank ?? 0,
        name: p.name,
        sub: p.title,
        badge: p.overallTier && tierRank(p.overallTier) !== null ? p.overallTier.toUpperCase() : undefined,
        region: p.region,
        kits: all.slice(0, 6),
        more: Math.max(0, all.length - 6),
        value: points(p.points),
      },
    }
  }
  const m = p.modes?.[kit]
  if (!m) return null
  const tier = tierRank(m.tier) !== null ? m.tier.toUpperCase() : undefined
  return {
    line: { pos: m.rank ?? 0, name: p.name, badge: tier, region: p.region, value: m.elo + ' ELO', extra: m.wins + m.losses > 0 ? m.wins + '–' + m.losses : undefined },
    next: m.next,
  }
}

function KitRail({ kit, modes, stats }: { kit: string; modes: TierModeInfo[]; stats: Record<string, { players: number; fighting: number; queued: number }> | null }) {
  return (
    <div className="tl-kits" role="tablist" aria-label="Режим">
      <button role="tab" aria-selected={kit === 'all'} className={'tl-kit all' + (kit === 'all' ? ' on' : '')} data-track="tiers_kit_all" onClick={() => useTiers.getState().setKit('all')}>
        <span className="tl-kit-art">
          <Icon id="i-trophy" />
        </span>
        <b>Все</b>
      </button>
      {modes.map((m) => {
        const st = stats?.[m.slug]
        const live = st ? st.fighting + st.queued : 0
        return (
          <button key={m.slug} role="tab" aria-selected={kit === m.slug} className={'tl-kit' + (kit === m.slug ? ' on' : '')} data-track={'tiers_kit_' + m.slug} data-tip={st ? m.title + ' · ' + st.players + ' ' + plural(st.players, 'игрок', 'игрока', 'игроков') : m.title} onClick={() => useTiers.getState().setKit(m.slug)}>
            <span className="tl-kit-art">
              <KitIcon slug={m.slug} size={30} />
              {live > 0 ? <i className="tl-kit-live" aria-label="Идут бои" /> : null}
            </span>
            <b>{m.title}</b>
          </button>
        )
      })}
    </div>
  )
}

function SearchBox({ onFound }: { onFound: (p: TierPlayer | null) => void }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'none'>('idle')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const n = q.trim()
    if (!/^[A-Za-z0-9_]{1,16}$/.test(n)) return setState('none')
    setState('busy')
    api<TierPlayer>('/tiers/player/' + encodeURIComponent(n))
      .then((p) => {
        onFound(p)
        setState('idle')
      })
      .catch(() => setState('none'))
  }
  return (
    <form className={'tl-search' + (state === 'none' ? ' none' : '')} onSubmit={submit}>
      <Icon id="i-search" />
      <input
        value={q}
        maxLength={16}
        placeholder={state === 'none' ? 'Нет в тир-листе' : 'Найти игрока'}
        spellCheck={false}
        onChange={(e) => {
          setQ(e.target.value)
          if (state === 'none') setState('idle')
        }}
      />
    </form>
  )
}

function JoinBanner({ hasTier }: { hasTier: boolean }) {
  const art = modeIcon('PVP')
  return (
    <div className="tr-banner">
      {art?.rig ? <img className="tr-banner-rig" src={art.rig.url} alt="" draggable={false} /> : null}
      <span className="tr-banner-text">
        <b>{hasTier ? 'Подними свой тир' : 'Тебя ещё нет в тир-листе'}</b>
        <span>Первый тир — экзамен с ботом, выше LT3 — тесты с игроками</span>
      </span>
      <button className="btn primary tr-banner-go" data-track="tiers_join_smp" onClick={() => openPvp('play')}>
        <Icon id="i-play" />
        Найти игру
      </button>
    </div>
  )
}

/** Карточка игрока: свой тир или найденный поиском — рендер скина, очки, плитки всех режимов. */
function PlayerCard({ p, modes, mine, pos, onClose }: { p: TierPlayer; modes: TierModeInfo[]; mine?: boolean; pos?: number | null; onClose?: () => void }) {
  const tiers = playerTiers(p)
  const best = bestTier(tiers, modes.map((m) => m.slug))
  return (
    <div className={'tl-card' + (mine ? ' mine' : '')}>
      <img className="tl-card-body" src={bodyUrl(p.name, 200)} alt="" draggable={false} />
      <div className="tl-card-head">
        <span className="tl-card-cap">{mine ? 'Ты' : 'Игрок'}</span>
        <b className="tl-card-nick">{p.name}</b>
        <span className="tl-card-meta">
          {p.title} · {points(p.points)}
          {pos ? ' · #' + pos + ' в общем' : ''}
        </span>
        {mine ? (
          <button className="btn primary sm tl-card-go" data-track="tiers_join_smp_me" onClick={() => openPvp('play')}>
            <Icon id="i-play" />
            {best ? 'Поднять тир' : 'Играть'}
          </button>
        ) : null}
      </div>
      <div className="tl-card-kits">
        {modes.map((m) => {
          const t = tiers[m.slug]
          return (
            <span key={m.slug} className={'tl-ck' + (t ? '' : ' empty')} data-tip={m.title}>
              <KitIcon slug={m.slug} size={22} />
              {t ? <TierBadge tier={t.toUpperCase()} /> : <i>—</i>}
            </span>
          )
        })}
      </div>
      {onClose ? (
        <button className="tl-card-x" aria-label="Закрыть" data-track="tiers_search_close" onClick={onClose}>
          <Icon id="i-x" />
        </button>
      ) : null}
    </div>
  )
}

/** Одна строка любого из топов, приведённая к общему виду. */
export interface Line {
  pos: number
  name: string
  sub?: string
  badge?: string
  region?: string
  kits?: { mode: string; tier: string }[]
  /** Сколько ещё режимов с тиром не влезло: «+N», как у Dawn. */
  more?: number
  value: string
  extra?: string
}

export function linesOf(kit: string, period: TierPeriod, top: TierTopEntry[] | null, kitRows: TierKitRow[] | null, periodRows: TierPeriodRow[] | null | undefined, order: string[]): Line[] | null {
  if (period !== 'tier') {
    if (!periodRows) return periodRows === null ? [] : null
    // Неделя считается по приросту ELO (сервер), сезон — по очкам сезона и дивизиону.
    return periodRows.map((r) => ({
      pos: r.pos,
      name: r.name,
      sub: r.division,
      value: period === 'week' ? ((r.eloDelta ?? 0) >= 0 ? '+' : '') + (r.eloDelta ?? 0) + ' ELO' : (r.sr ?? r.score ?? 0) + ' SR',
      extra:
        period === 'week'
          ? (r.wins ?? 0) + ' из ' + (r.games ?? 0) + ' ' + plural(r.games ?? 0, 'боя', 'боёв', 'боёв')
          : r.games
            ? r.games + ' ' + plural(r.games, 'бой', 'боя', 'боёв')
            : undefined,
    }))
  }
  if (kit === 'all') {
    if (!top) return null
    return top.map((e) => {
      const all = sortedTiers(e.tiers, order)
      return {
        pos: e.pos,
        name: e.name,
        sub: e.title,
        badge: e.overallTier && tierRank(e.overallTier) !== null ? e.overallTier.toUpperCase() : undefined,
        region: e.region,
        kits: all.slice(0, 6),
        more: Math.max(0, all.length - 6),
        value: points(e.points),
        // Откуда очки: сколько китов с тиром складываются в общий рейтинг.
        extra: all.length ? 'за ' + all.length + ' ' + plural(all.length, 'кит', 'кита', 'китов') : undefined,
      }
    })
  }
  if (!kitRows) return null
  return kitRows.map((r) => ({
    pos: r.pos,
    name: r.name,
    badge: r.tier,
    sub: r.peak && r.peak !== r.tier && tierRank(r.peak) !== null && tierRank(r.peak)! < tierRank(r.tier)! ? 'пик ' + r.peak : undefined,
    value: r.elo + ' ELO',
    extra: r.wins + r.losses > 0 ? r.wins + '–' + r.losses + ' · ' + winRate(r.wins, r.losses) : undefined,
  }))
}

function Board(props: {
  kit: string
  period: TierPeriod
  top: TierTopEntry[] | null
  kitRows: TierKitRow[] | null
  periodRows: TierPeriodRow[] | null | undefined
  order: string[]
  modes: TierModeInfo[]
  meName: string
  failed: boolean
}) {
  const lines = linesOf(props.kit, props.period, props.top, props.kitRows, props.periodRows, props.order)
  if (!lines) {
    if (props.failed)
      return (
        <div className="fr-blank">
          <Icon id="i-trophy" />
          <b>Тир-лист не загрузился</b>
          <button className="btn sm secondary" data-track="tiers_retry" onClick={() => void useTiers.getState().load(tierNick(), true)}>
            <Icon id="i-restart" />
            Повторить
          </button>
        </div>
      )
    return (
      <div className="stack tb-list" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="tb-row skel" style={{ height: 64 }} />
        ))}
      </div>
    )
  }
  if (!lines.length)
    return (
      <div className="fr-blank">
        <Icon id="i-trophy" />
        <b>Здесь пока пусто — стань первым</b>
      </div>
    )
  const me = props.meName.toLowerCase()
  return (
    <div className="stack tb-list tl-list">
      {lines.map((l) => (
        <Row key={l.pos + l.name} l={l} modes={props.modes} mine={l.name.toLowerCase() === me} />
      ))}
    </div>
  )
}

export function Row({ l, modes, mine }: { l: Line; modes: TierModeInfo[]; mine: boolean }) {
  return (
    <div className={'tb-row tl-row' + (mine ? ' me' : '') + (l.pos >= 1 && l.pos <= 3 ? ' p' + l.pos : '')}>
      <span className="tb-rank" style={{ '--digits': String(l.pos || '—').length + 1 } as CSSProperties}>
        {l.pos ? '#' + l.pos : '—'}
      </span>
      <Head nick={l.name} size={56} className="tb-head" src={avatarUrl(l.name)} />
      <span className="fr-body">
        <span className="fr-nick">
          {l.name}
          {l.region ? <i className="tl-region">{l.region}</i> : null}
        </span>
        {l.sub ? <span className="tr-title">{l.sub}</span> : null}
      </span>
      {l.kits?.length ? (
        <span className="tl-row-kits">
          {l.kits.map((t) => (
            <span key={t.mode} className="tl-ck" data-tip={modeTitle(modes, t.mode)}>
              <KitIcon slug={t.mode} size={20} />
              <TierBadge tier={t.tier} />
            </span>
          ))}
          {l.more ? <span className="tl-more">+{l.more}</span> : null}
        </span>
      ) : null}
      {l.badge ? <TierBadge tier={l.badge} big /> : null}
      <span className="tl-row-val">
        <b className="tb-val">{l.value}</b>
        {l.extra ? <i>{l.extra}</i> : null}
      </span>
    </div>
  )
}
