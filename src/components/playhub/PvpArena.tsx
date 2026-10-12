import { useEffect, useState, type CSSProperties } from 'react'
import { Icon } from '../Icon'
import { api } from '../../lib/api'
import { quickJoin } from '../../lib/joinServer'
import { openTop } from '../../state/boards'
import { plural } from '../../lib/format'
import { showToast } from '../../state/ui'
import { TierBadge, tierNick } from '../top/TierBoard'
import { isLeader, usePartyStore } from '../../state/party'
import type { LobbyMode } from '../../state/lobbyMode'
import { TIER_SERVER, kitIcon, modeTitle, tierRank, useTiers, type TierMode } from '../../state/tiers'
import '../../styles/pixel/arena.css'

/**
 * PvP-арена Millida (владелец 11.10.2026: «как в Dawn — выбор класса, сразу
 * поиск и тебя сразу на сервер»). Карточки китов каруселью: в покое серые,
 * выбранная оживает. «Играть» запускает игру прямо на Millida SMP и просит
 * сервер поставить в очередь выбранного кита. Живёт в разделе PvP хаба —
 * игрокам не из PvP не мешает.
 */

/** Цвет карточки и риг-арт режима (рендеры героев сайта). */
const KIT_LOOK: Record<string, { c: string; rig: string }> = {
  vanilla: { c: '#6b3fb8', rig: 'vanilla' },
  sword: { c: '#2b63c4', rig: 'sword' },
  pot: { c: '#b8324a', rig: 'pot' },
  nethop: { c: '#4b3a55', rig: 'nethop' },
  uhc: { c: '#b8901f', rig: 'uhc' },
  smp: { c: '#3a7a4b', rig: 'smp' },
  axe: { c: '#7a4a2a', rig: 'axe' },
  mace: { c: '#565c69', rig: 'mace' },
  op: { c: '#b4472c', rig: 'op' },
  diasmp: { c: '#1f9bb5', rig: 'diasmp' },
  spear: { c: '#8a6a2a', rig: 'spear' },
  cart: { c: '#9e3a2a', rig: 'cart' },
  bow: { c: '#5f8722', rig: 'bow' },
  sumo: { c: '#2f9c55', rig: 'sumo' },
}
const look = (kit: string) => KIT_LOOK[kit] ?? { c: '#4a5560', rig: 'sword' }
const rigUrl = (kit: string) => '/mode-art/kit-rigs/' + look(kit).rig + '.webp'

const KIT_KEY = 'm-pvp-kit'
function savedKit(): string {
  try {
    return localStorage.getItem(KIT_KEY) || 'sword'
  } catch {
    return 'sword'
  }
}

/** Где игрок на сервере (/v2/tiers/state): лобби, очередь, бой, ожидание напарника. */
interface ArenaState {
  state: string
  kit?: string
  ranked?: boolean
  since?: number
  partySize?: number | string
  partyJoined?: number
  mode?: string
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

/**
 * Полоса статуса как очередь у Dawn: «ищем соперника» с таймером, «ждём
 * напарника», «бой идёт». Сервер отдаёт состояние раз в 2 с; пока игрок не на
 * сервере — ничего не показываем, сразу после «Играть» — «запускаем игру».
 */
function ArenaStatus({ uuid, launching, modes }: { uuid: string | null; launching: boolean; modes: { slug: string; title: string; first_to: number }[] }) {
  const [st, setSt] = useState<ArenaState | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!uuid) return
    let alive = true
    const tick = () => {
      if (document.hidden) return
      api<ArenaState>('/tiers/state/' + encodeURIComponent(uuid))
        .then((r) => alive && setSt(r && typeof r.state === 'string' ? { ...r, since: typeof r.since === 'number' ? Date.now() - r.since : undefined } : null))
        .catch(() => alive && setSt(null))
    }
    tick()
    const id = window.setInterval(tick, 2500)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [uuid])
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const kitName = st?.kit ? modeTitle(modes, st.kit) : ''
  const timer = st?.since ? clock(now - st.since) : ''
  let line: { cls: string; t: string; sub?: string } | null = null
  if (st && st.state === 'queue') line = { cls: 'q', t: st.mode === '2v2' ? 'Ищем пару соперников' : 'Ищем соперника', sub: [kitName, st.ranked ? 'рейтинговый' : '', timer].filter(Boolean).join(' · ') }
  else if (st && st.state === 'party')
    line = { cls: 'q', t: 'Ждём напарника', sub: [kitName, typeof st.partyJoined === 'number' && st.partySize ? st.partyJoined + ' из ' + st.partySize : ''].filter(Boolean).join(' · ') }
  else if (st && st.state === 'match') line = { cls: 'm', t: st.mode === '2v2' ? 'Бой 2 на 2' : 'Бой идёт', sub: [kitName, timer].filter(Boolean).join(' · ') }
  else if (st && st.state === 'bot') line = { cls: 'm', t: 'Бой с ботом', sub: timer }
  else if (st && st.state === 'spectating') line = { cls: 'l', t: 'Смотришь бой' }
  else if (st && st.state !== 'offline') line = { cls: 'l', t: 'Ты на Millida SMP', sub: 'лобби' }
  else if (launching) line = { cls: 'l', t: 'Запускаем Minecraft', sub: 'очередь начнётся при входе' }
  if (!line) return null
  return (
    <div className={'ar-status ' + line.cls} role="status">
      <i className="ar-status-dot" aria-hidden="true" />
      <b>{line.t}</b>
      {line.sub ? <span>{line.sub}</span> : null}
    </div>
  )
}

const winRate = (w: number, l: number) => (w + l > 0 ? Math.round((100 * w) / (w + l)) + '%' : '—')

export function PvpArena() {
  const nick = tierNick()
  const me = useTiers((s) => (s.nick === nick ? s.me : undefined))
  const modes = useTiers((s) => s.modes)
  const stats = useTiers((s) => s.stats)
  const [kit, setKit] = useState(savedKit)
  const top = useTiers((s) => s.kitRows[kit] ?? null)
  const [busy, setBusy] = useState(false)
  // «Запускаем Minecraft» держим 3 минуты после «Играть» — столько живёт заявка в очередь.
  const [launchAt, setLaunchAt] = useState(0)

  useEffect(() => {
    const t = useTiers.getState()
    void t.load(nick)
    void t.loadLive()
    const id = window.setInterval(() => void useTiers.getState().loadLive(), 30_000)
    return () => window.clearInterval(id)
  }, [nick])

  useEffect(() => {
    void useTiers.getState().loadKit(kit)
    try {
      localStorage.setItem(KIT_KEY, kit)
    } catch {}
  }, [kit])

  const kits = modes.length ? modes : Object.keys(KIT_LOOK).map((slug) => ({ slug, title: slug.toUpperCase(), first_to: 1 }))
  const mine: TierMode | null = me?.modes?.[kit] ?? null
  const myTier = mine && tierRank(mine.tier) !== null ? mine.tier.toUpperCase() : null
  const st = stats?.[kit]
  const title = modeTitle(modes, kit)

  const party = usePartyStore((p) => p.party)
  const partyMe = usePartyStore((p) => p.me)
  // 2 на 2 — пати ровно из двух, жмёт лидер (сервер проверяет то же самое).
  const duo = !!party && party.members.length === 2 && isLeader(party, partyMe)

  /**
   * 2 на 2 из пати лаунчера: заявка на обоих (по id аккаунтов Millida), затем
   * обычный запуск пати на сервер — напарнику достаточно нажать «Готов».
   */
  const playDuo = async () => {
    if (!party) return
    setBusy(true)
    try {
      await api('/tiers/intent', { method: 'POST', body: JSON.stringify({ kit, ranked: true, party: party.members.map((m) => m.userId) }) })
    } catch (e) {
      const msg = String(e)
      showToast(/403/.test(msg) ? 'Позвать в 2 на 2 может только лидер пати' : /404/.test(msg) ? 'У напарника ещё нет игрового профиля Millida' : 'Сервер не принял заявку 2 на 2 — попробуй ещё раз', 'error')
      setBusy(false)
      return
    }
    const mode: LobbyMode = { kind: 'server', slug: 'millida-smp', name: TIER_SERVER.name, ip: TIER_SERVER.ip, logo: null, banner: null, versions: TIER_SERVER.versions, licensed: false }
    setLaunchAt(Date.now())
    const { partyPlayPressed } = await import('../../lib/partyPlay')
    await partyPlayPressed(mode).catch(() => {})
    setBusy(false)
  }

  const play = async (k: string = kit) => {
    const name = modeTitle(modes, k)
    setBusy(true)
    // Заявка до запуска игры: при входе плагин спрашивает её (живёт 3 минуты) и сразу
    // ставит в очередь кита. Не ответил за 3 с — игрок просто окажется в лобби сервера.
    const intent = api('/tiers/intent', { method: 'POST', body: JSON.stringify({ kit: k, ranked: true }) }).catch(() => {})
    await Promise.race([intent, new Promise((r) => setTimeout(r, 3000))])
    showToast('Заходим на Millida SMP · ' + name)
    setLaunchAt(Date.now())
    quickJoin(TIER_SERVER.ip, TIER_SERVER.name, false, TIER_SERVER.versions)
      .catch(() => {})
      .finally(() => setBusy(false))
  }

  return (
    <section className="ar" data-section="pvp_arena">
      <header className="ar-head">
        <span className="ar-head-t">
          <h1>PvP-арена</h1>
          <span className="ar-sub">
            Millida SMP · дуэли по тир-листу
            {me ? ' · ' + me.title + ' · ' + me.points + ' ' + plural(me.points, 'очко', 'очка', 'очков') : ''}
          </span>
        </span>
        <button className="btn sm secondary" data-track="arena_open_top" onClick={() => openTop('tiers')}>
          <Icon id="i-trophy" />
          Тир-лист
        </button>
      </header>

      <ArenaStatus uuid={me?.uuid ?? null} launching={launchAt > 0 && Date.now() - launchAt < 180_000} modes={modes} />

      <div className="ar-cards" role="listbox" aria-label="Режим">
        {kits.map((m, i) => {
          const t = me?.modes?.[m.slug]
          const tier = t && tierRank(t.tier) !== null ? t.tier.toUpperCase() : null
          const live = stats?.[m.slug] ? stats[m.slug]!.fighting + stats[m.slug]!.queued : 0
          return (
            <button
              key={m.slug}
              role="option"
              aria-selected={kit === m.slug}
              className={'ar-card' + (kit === m.slug ? ' on' : '')}
              style={{ '--kc': look(m.slug).c, '--i': i } as CSSProperties}
              data-track={'arena_kit_' + m.slug}
              onClick={() => setKit(m.slug)}
              onDoubleClick={() => {
                setKit(m.slug)
                void play(m.slug)
              }}
            >
              <span className="ar-card-bg" />
              <img className="ar-card-rig" src={rigUrl(m.slug)} alt="" draggable={false} loading="lazy" />
              {tier ? (
                <span className="ar-card-tier">
                  <TierBadge tier={tier} />
                </span>
              ) : null}
              {live > 0 ? (
                <span className="ar-card-live">
                  <i />
                  {live}
                </span>
              ) : null}
              <span className="ar-card-ribbon">
                <img src={kitIcon(m.slug)} alt="" width={26} height={26} draggable={false} />
                <b>{m.title}</b>
              </span>
            </button>
          )
        })}
      </div>

      <div className="ar-panel" style={{ '--kc': look(kit).c } as CSSProperties}>
        <div className="ar-me">
          <span className="ar-me-cap">{title}</span>
          {myTier && mine ? (
            <>
              <span className="ar-me-tier">
                <TierBadge tier={myTier} big />
                {mine.peak && mine.peak !== mine.tier && tierRank(mine.peak) !== null ? <i>пик {mine.peak}</i> : null}
              </span>
              <span className="ar-me-nums">
                <b>{mine.elo}</b> ELO · <b>{mine.wins}</b>–<b>{mine.losses}</b> · {winRate(mine.wins, mine.losses)}
              </span>
            </>
          ) : (
            <>
              <span className="ar-me-tier">
                <b className="ar-me-none">Без тира</b>
              </span>
              <span className="ar-me-nums">Первый вход — экзамен против ботов, тир сразу</span>
            </>
          )}
          {st ? (
            <span className="ar-me-live">
              {st.players} {plural(st.players, 'игрок', 'игрока', 'игроков')} с тиром
              {st.fighting ? ' · ' + st.fighting + ' в бою' : ''}
              {st.queued ? ' · ' + st.queued + ' в очереди' : ''}
            </span>
          ) : null}
        </div>

        <ol className="ar-top">
          {(top ?? []).slice(0, 3).map((r) => (
            <li key={r.name}>
              <i>{r.pos}</i>
              <span className="ar-top-name">{r.name}</span>
              <TierBadge tier={r.tier} />
            </li>
          ))}
          {top && !top.length ? <li className="ar-top-empty">Пока никого — стань первым</li> : null}
        </ol>

        <div className="ar-go-col">
          <button className="btn lg primary ar-go" data-sound="open" data-track="arena_play" data-id={kit} disabled={busy} onClick={() => void play()}>
            <Icon id="i-play" />
            <span>
              Играть
              <em>{title}</em>
            </span>
          </button>
          {duo ? (
            <button className="btn secondary ar-duo" data-sound="open" data-track="arena_play_2v2" data-id={kit} disabled={busy} onClick={() => void playDuo()}>
              <Icon id="i-users" />
              2 на 2 с пати
            </button>
          ) : null}
        </div>
      </div>
    </section>
  )
}
