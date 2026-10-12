import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { effectiveNick } from '../../state/accounts'
import { api, hasMillidaAccount } from '../../lib/api'
import { modeIcon } from '../playhub/modeIcon'
import { openPvpArena } from '../playhub/hubTab'
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
export const tierNick = (): string => (hasMillidaAccount() ? effectiveNick() : '')

export function TierBadge({ tier, big }: { tier: string; big?: boolean }) {
  return (
    <b className={'tr-badge' + (big ? ' big' : '')} data-lv={tierLevel(tier)} data-h={tier.startsWith('H') ? '1' : '0'}>
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

function ago(ts: number): string {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60_000))
  if (m < 1) return 'сейчас'
  if (m < 60) return m + ' мин'
  const h = Math.round(m / 60)
  if (h < 24) return h + ' ч'
  return Math.round(h / 24) + ' дн'
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
  const period = useTiers((s) => s.period)
  const kitRows = useTiers((s) => (kit === 'all' ? null : s.kitRows[kit] ?? null))
  const periodRows = useTiers((s) => (period === 'tier' ? undefined : s.periodRows[period + ':' + kit]))
  const hasSeason = useTiers((s) => !!s.periodRows['season:all'])
  const hasWeek = useTiers((s) => !!s.periodRows['week:all'])
  const stats = useTiers((s) => s.stats)
  const recent = useTiers((s) => s.recent)
  const [found, setFound] = useState<TierPlayer | null>(null)

  useEffect(() => {
    if (!on) return
    const t = useTiers.getState()
    void t.load(nick)
    void t.loadLive()
    void t.loadPeriod('season', 'all')
    void t.loadPeriod('week', 'all')
    if (t.kit !== 'all') void t.loadKit(t.kit)
    // Лента тестов живая: раз в минуту, пока вкладка открыта.
    const id = window.setInterval(() => void useTiers.getState().loadLive(), 60_000)
    return () => window.clearInterval(id)
  }, [on, nick])

  const order = modes.map((m) => m.slug)
  const myPos = me && top ? top.find((e) => e.name.toLowerCase() === me.name.toLowerCase())?.pos ?? null : null
  const periods: { key: TierPeriod; name: string }[] = [
    { key: 'tier', name: 'Тиры' },
    ...(hasSeason ? [{ key: 'season' as const, name: 'Сезон' }] : []),
    ...(hasWeek ? [{ key: 'week' as const, name: 'Неделя' }] : []),
  ]

  return (
    <div className="tl">
      <KitRail kit={kit} modes={modes} stats={stats} />

      <div className="tl-bar">
        {periods.length > 1 ? (
          <div className="segs tl-periods" role="tablist" aria-label="Период">
            {periods.map((p) => (
              <button key={p.key} role="tab" aria-selected={period === p.key} className={'seg' + (period === p.key ? ' on' : '')} data-track={'tiers_period_' + p.key} onClick={() => useTiers.getState().setPeriod(p.key)}>
                {p.name}
              </button>
            ))}
          </div>
        ) : (
          <span className="tl-bar-title">{kit === 'all' ? 'Общий тир-лист' : modeTitle(modes, kit)}</span>
        )}
        <SearchBox onFound={setFound} />
      </div>

      {recent && recent.length ? <RecentStrip rows={recent.slice(0, 8)} /> : null}

      {found ? (
        <PlayerCard p={found} modes={modes} onClose={() => setFound(null)} />
      ) : me ? (
        <PlayerCard p={me} modes={modes} mine pos={myPos} />
      ) : (
        <JoinBanner hasTier={false} />
      )}

      <Board kit={kit} period={period} top={top} kitRows={kitRows} periodRows={periodRows} order={order} modes={modes} meName={me?.name ?? nick} failed={failed} />
    </div>
  )
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

function RecentStrip({ rows }: { rows: { name: string; kit: string; to: string; source: string; ts: number }[] }) {
  return (
    <div className="tl-recent" aria-label="Только что">
      <span className="tl-recent-cap">
        <i className="tl-dot" aria-hidden="true" />
        Только что
      </span>
      <div className="tl-recent-row">
        {rows.map((r, i) => (
          <span key={r.name + r.ts + i} className="tl-rc" data-tip={r.source === 'exam' ? 'Экзамен' : 'Ранговые дуэли'}>
            <Head nick={r.name} size={22} src={avatarUrl(r.name)} />
            <b>{r.name}</b>
            <KitIcon slug={r.kit} size={16} />
            <TierBadge tier={r.to} />
            <em>{ago(r.ts)}</em>
          </span>
        ))}
      </div>
    </div>
  )
}

function JoinBanner({ hasTier }: { hasTier: boolean }) {
  const art = modeIcon('PVP')
  return (
    <div className="tr-banner">
      {art?.rig ? <img className="tr-banner-rig" src={art.rig.url} alt="" draggable={false} /> : null}
      <span className="tr-banner-text">
        <b>{hasTier ? 'Подними свой тир' : 'Определи свой тир'}</b>
        <span>Экзамен против ботов — тир сразу</span>
      </span>
      <button className="btn primary tr-banner-go" data-track="tiers_join_smp" onClick={() => openPvpArena()}>
        <Icon id="i-play" />
        Играть
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
          <button className="btn primary sm tl-card-go" data-track="tiers_join_smp_me" onClick={() => openPvpArena()}>
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
interface Line {
  pos: number
  name: string
  sub?: string
  badge?: string
  kits?: { mode: string; tier: string }[]
  value: string
  extra?: string
}

function linesOf(kit: string, period: TierPeriod, top: TierTopEntry[] | null, kitRows: TierKitRow[] | null, periodRows: TierPeriodRow[] | null | undefined, order: string[]): Line[] | null {
  if (period !== 'tier') {
    if (!periodRows) return periodRows === null ? [] : null
    return periodRows.map((r) => ({
      pos: r.pos,
      name: r.name,
      sub: r.division,
      value: period === 'week' ? (r.wins ?? 0) + ' ' + plural(r.wins ?? 0, 'победа', 'победы', 'побед') : (r.sr ?? r.score ?? 0) + ' SR',
      extra: period === 'week' && typeof r.eloDelta === 'number' ? (r.eloDelta >= 0 ? '+' : '') + r.eloDelta + ' ELO' : r.games ? r.games + ' ' + plural(r.games, 'бой', 'боя', 'боёв') : undefined,
    }))
  }
  if (kit === 'all') {
    if (!top) return null
    return top.map((e) => ({ pos: e.pos, name: e.name, sub: e.title, kits: sortedTiers(e.tiers, order).slice(0, 5), value: points(e.points) }))
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
        <div className="tl-podium skel" />
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
  const podium = lines.slice(0, 3)
  return (
    <div className="stack tb-list tl-list">
      <div className="tl-podium">
        {[podium[1], podium[0], podium[2]].map((l, i) =>
          l ? <PodiumCard key={l.name} l={l} place={l.pos} kit={props.kit} mine={l.name.toLowerCase() === me} slot={i} /> : <span key={'gap' + i} />,
        )}
      </div>
      {lines.slice(3).map((l) => (
        <Row key={l.pos + l.name} l={l} kit={props.kit} modes={props.modes} mine={l.name.toLowerCase() === me} />
      ))}
    </div>
  )
}

function PodiumCard({ l, place, kit, mine, slot }: { l: Line; place: number; kit: string; mine: boolean; slot: number }) {
  return (
    <div className={'tl-pod p' + Math.min(place, 3) + (mine ? ' mine' : '')} style={{ '--slot': slot } as CSSProperties}>
      <img
        className="tl-pod-body"
        src={bodyUrl(l.name, 220)}
        alt=""
        draggable={false}
        loading="lazy"
        // Скин не прошёл фильтр — ставим Стива, а не пустое место на пьедестале.
        onError={(e) => {
          const img = e.currentTarget
          if (!img.dataset.fallback) {
            img.dataset.fallback = '1'
            img.src = bodyUrl('Steve', 220)
          }
        }}
      />
      <span className="tl-pod-plate">
        <i className="tl-pod-place">{place}</i>
        <b className="tl-pod-nick">{l.name}</b>
        <span className="tl-pod-meta">
          {l.badge ? <TierBadge tier={l.badge} /> : null}
          {kit === 'all' && l.kits?.[0] ? (
            <>
              <KitIcon slug={l.kits[0].mode} size={18} />
              <TierBadge tier={l.kits[0].tier} />
            </>
          ) : null}
          <em>{l.value}</em>
        </span>
      </span>
    </div>
  )
}

function Row({ l, kit, modes, mine }: { l: Line; kit: string; modes: TierModeInfo[]; mine: boolean }) {
  return (
    <div className={'tb-row tl-row' + (mine ? ' me' : '')}>
      <span className="tb-rank" style={{ '--digits': String(l.pos).length } as CSSProperties}>
        {l.pos}
      </span>
      <Head nick={l.name} size={56} className="tb-head" src={avatarUrl(l.name)} />
      <span className="fr-body">
        <span className="fr-nick">{l.name}</span>
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
        </span>
      ) : null}
      {l.badge && kit !== 'all' ? <TierBadge tier={l.badge} big /> : null}
      <span className="tl-row-val">
        <b className="tb-val">{l.value}</b>
        {l.extra ? <i>{l.extra}</i> : null}
      </span>
    </div>
  )
}
