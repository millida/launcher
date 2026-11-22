import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { PlusMark } from '../premium/PlusMark'
import { RewardArt } from '../daily/rewards'
import { useRail } from '../daily/useRail'
import { daysText, friendsText, tierRewardText } from '../../lib/referrals'
import { colFill, trackPos } from './inviteTrackPos'
import type { InviteOverview, InvitePerk, InviteTier } from '../../lib/referrals'
import type { ChestTier } from '../../lib/rubies'
import { useT } from '../../i18n'
import '../../styles/pixel/pass.css'

/** Column width plus the gap: the arrows page by two steps. */
const STEP = 176 + 8

type State = 'claimed' | 'wait' | 'next' | 'future'

interface Art {
  key: string
  node: ReactNode
  label: string
}

const PERK_PX: Record<InvitePerk['kind'], string> = { badge: 'star', title: 'crown', frame: 'shield', icon: 'image' }

/** Every reward of a step as a picture: PLUS days, the chest, the app icon, the badge. */
function tierArts(tier: InviteTier, size: number, t: ReturnType<typeof useT>): Art[] {
  const out: Art[] = []
  if (tier.plusDays > 0)
    out.push({
      key: 'plus',
      label: daysText(tier.plusDays) + ' PLUS',
      node: (
        <span className="ivp-plus" style={{ '--ra-size': size + 'px' } as CSSProperties}>
          <b>{tier.plusDays}</b>
          <PlusMark height={Math.max(12, Math.round(size * 0.22))} />
        </span>
      ),
    })
  if (tier.chest)
    out.push({
      key: 'chest',
      label: tier.chestName || t('Сундук'),
      node: <RewardArt reward={{ kind: 'CHEST', tier: tier.chest as ChestTier }} size={size} />,
    })
  for (const p of tier.perks) {
    // Same files as APP_ICONS (/app-icons/<id>.png); importing that list here would split it out of
    // the startup appIcon chunk and lengthen every preload list.
    const iconId = p.kind === 'icon' && /^icon-[a-z]+$/.test(p.id) ? p.id.slice(5) : null
    out.push({
      key: p.id,
      label: p.kind === 'icon' ? t('Иконка «{name}»', { name: p.name }) : p.name,
      node: iconId ? (
        <img className="ivp-icon" src={'/app-icons/' + iconId + '.png'} alt="" width={size} height={size} draggable={false} />
      ) : (
        <span className={'ivp-perk ' + p.kind} style={{ '--ra-size': size + 'px' } as CSSProperties}>
          <PxIcon name={PERK_PX[p.kind] || 'star'} size={Math.round(size * 0.56)} />
        </span>
      ),
    })
  }
  return out
}

function TierCard({ tier, state, left, top }: { tier: InviteTier; state: State; left: number; top: boolean }) {
  const t = useT()
  const count = tier.perks.length + (tier.chest ? 1 : 0) + (tier.plusDays > 0 ? 1 : 0)
  const arts = tierArts(tier, count >= 4 ? 40 : count === 3 ? 46 : count === 2 ? 60 : 84, t)
  const gold = tier.plusDays > 0
  const cls = 'bp-card ' + (gold ? 'plus' : 'free') + ' ' + state + (top ? ' ms' : '')
  return (
    <span className={'bp-slot ' + (gold ? 'plus ' : '') + state}>
      <span className={cls} role="img" aria-label={friendsText(tier.friends) + ': ' + tierRewardText(tier)}>
        {gold && state !== 'claimed' ? <i className="bp-shine" aria-hidden="true" /> : null}
        <span className={'bp-art' + (arts.length > 1 ? ' many' : '')}>
          {arts.map((a) => (
            <span key={a.key} className="ivp-art" title={a.label}>
              {a.node}
            </span>
          ))}
        </span>
        <span className="ivp-lines">
          {arts.map((a) => (
            <b key={a.key}>{a.label}</b>
          ))}
        </span>
        {state === 'claimed' ? (
          <span className="bp-mark got">
            <Icon id="i-check" />
          </span>
        ) : state === 'wait' ? (
          <span className="bp-mark ivp-wait">
            <Icon id="i-clock" />
          </span>
        ) : state === 'next' ? (
          <b className="ivp-left">{t('Ещё {n}', { n: left })}</b>
        ) : null}
      </span>
    </span>
  )
}

/**
 * The invite ladder as a battle pass track: a column per step with every reward
 * drawn, the friend count on the line, and the line filled by friends counted.
 * Rewards come by themselves (the server grants them), so nothing here is pressed.
 */
export function InviteTrack({ data }: { data: InviteOverview }) {
  const t = useT()
  const tiers = data.tiers
  const top = tiers.length ? tiers[tiers.length - 1].friends : 0
  const q = data.qualified
  const pos = trackPos(q, tiers)
  const nextAt = tiers.findIndex((x) => !x.reached)
  const ms = new Set(tiers.map((x) => x.friends))
  const { ref, edge, page } = useRail(nextAt, STEP * 2, '.bp-col.focus')

  const stateOf = (x: InviteTier, i: number): State => (x.granted ? 'claimed' : x.reached ? 'wait' : i === nextAt ? 'next' : 'future')

  return (
    <div className="card inv-card ivp">
      <div className="inv-head">
        <span className="inv-title">
          <Icon id="i-trophy" />
          {t('Засчитано: {friends}', { friends: friendsText(q) })}
        </span>
        {data.earned.plusDays ? (
          <span className="ivp-earned">
            <b>{'+' + daysText(data.earned.plusDays)}</b>
            <PlusMark height={14} />
          </span>
        ) : null}
      </div>
      {top ? (
        <span className="bp-bar ivp-bar" style={{ ['--n' as string]: top }} aria-hidden="true">
          {Array.from({ length: top }, (_, i) => (
            <i key={i} className={i < q ? 'got' : i < q + data.pending ? 'wait' : ms.has(i + 1) ? 'ms' : ''} />
          ))}
        </span>
      ) : null}
      <div className="bp-view ivp-view">
        <div className="bp-scroll" ref={ref}>
          <div className="bp-track">
            {tiers.map((x, i) => {
              const state = stateOf(x, i)
              const last = i === tiers.length - 1
              return (
                <div key={x.friends} className={'bp-col' + (i === nextAt ? ' focus today' : '') + (x.reached ? ' done' : '') + (last ? ' ms' : '')}>
                  <TierCard tier={x} state={state} left={Math.max(0, x.friends - q)} top={last} />
                  <span className={'bp-node' + (x.reached ? ' done' : '')}>
                    <i className="ivp-line" aria-hidden="true">
                      <i style={{ width: Math.round(colFill(pos, i) * 100) + '%' }} />
                    </i>
                    <b className="bp-day">
                      <PxIcon name="users" size={14} />
                      {x.friends}
                    </b>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <button type="button" className="bp-arrow l" aria-label={t('Раньше')} disabled={!edge.l} onClick={() => page(-1)}>
          <Icon id="i-chev-l" />
        </button>
        <button type="button" className="bp-arrow r" aria-label={t('Дальше')} disabled={!edge.r} onClick={() => page(1)}>
          <Icon id="i-chev-r" />
        </button>
      </div>
    </div>
  )
}
