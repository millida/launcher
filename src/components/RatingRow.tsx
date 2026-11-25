import { Icon } from './Icon'
import { Logo, useServerJoin, versionRange } from './ServerRow'
import { fmtN, motdParts } from '../lib/format'
import { onlineHonestMode } from '../lib/onlineHonest'
import { openServerDetail } from '../state/serverDetail'
import type { SnapshotServer } from '../lib/snapshot'
import { useT } from '../i18n'
import '../styles/pixel/rating-rows.css'

/** Честный онлайн, как на millida.net/rating: заявленное зачёркнуто, рядом оценка; проверенный — с галочкой. */
export function HonestOnline({ sv }: { sv: SnapshotServer }) {
  const t = useT()
  if (!sv.isOnline) return <span className="rt-on off">{t('офлайн')}</span>
  const mode = onlineHonestMode({ online: sv.online, real: sv.onlineReal, suspect: sv.onlineSuspect, verified: sv.onlineVerified, approx: sv.onlineApprox })
  if (mode === 'suspect')
    return (
      <span className="rt-on" title={t('Заявлено {n}, по оценке Millida играют меньше', { n: fmtN(sv.online) })}>
        <s>{fmtN(sv.online)}</s>
        <b>{fmtN(sv.onlineReal || 0)}</b>
      </span>
    )
  return (
    <span className="rt-on" title={mode === 'verified' ? t('Онлайн проверен Millida') : undefined}>
      <b>
        {sv.onlineApprox ? '~' : ''}
        {fmtN(sv.online)}
      </b>
      {mode === 'verified' ? <Icon id="i-check" /> : null}
    </span>
  )
}

/** Строка рейтинга: место, логотип, имя, онлайн, версия, теги, голоса, «Играть». */
export function RatingRow({ sv, place, src = 'rating' }: { sv: SnapshotServer; place: number; src?: string }) {
  const t = useT()
  const { join, label, wakes, busy } = useServerJoin(sv)
  const on = sv.isOnline
  const ver = versionRange(sv.versions)
  return (
    <div
      className="srv-row srv-row-click rt-row"
      data-kind="server"
      data-id={sv.slug || sv.ip || undefined}
      data-pos={place - 1}
      data-src={src}
      data-track="server_open"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        openServerDetail(sv)
      }}
    >
      <span className={'rt-place' + (place <= 3 ? ' top' : '')}>{place}</span>
      <Logo sv={sv} />
      <span className="rt-name">
        <b className="rt-title">
          <span className="rt-title-t">{sv.name}</span>
          {sv.boost ? (
            <span className="rt-boost" title={t('Баллы продвижения')}>
              <Icon id="i-rocket" />
              {fmtN(sv.boost)}
            </span>
          ) : null}
        </b>
        {sv.tags && sv.tags.length ? (
          <span className="rt-tags">
            {sv.tags.map((x) => (
              <span key={x} className="rt-tag">
                {x}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="rt-motd" aria-hidden="true">
        {sv.motdLine
          ? motdParts(sv.motdLine).map((p, i) => (
              <span key={i} style={{ color: p.color, ...(p.bold ? { fontWeight: 700 } : {}) }}>
                {p.text}
              </span>
            ))
          : null}
      </span>
      <HonestOnline sv={sv} />
      <span className="rt-ver">{ver}</span>
      <span className="rt-votes" title={t('Голосов за 30 дней')}>
        <Icon id="i-heart" />
        {fmtN(sv.votes || 0)}
      </span>
      {sv.ip ? (
        <button className="btn sm primary srv-join" disabled={(!on && !wakes) || busy} data-track={wakes ? 'join_wake' : 'join'} onClick={join}>
          {wakes && label === 'Играть' ? t('Включить и зайти') : t(label)}
        </button>
      ) : (
        <span className="rt-apply">{t('По заявке')}</span>
      )}
    </div>
  )
}

export function RatingRowSkel({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="srv-row rt-row skel" aria-hidden="true" style={{ height: 68 }} />
      ))}
    </>
  )
}
