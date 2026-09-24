import { useRef, useState } from 'react'
import type { SnapshotServer } from '../lib/snapshot'
import { fmtN, motdParts } from '../lib/format'
import { quickJoin } from '../lib/joinServer'
import { serverMode, useLobby } from '../state/lobbyMode'
import { openServerDetail } from '../state/serverDetail'
import { Icon } from './Icon'

/// Список версий сервера одной строкой-диапазоном: «1.8–26.3» вместо двадцати
/// чисел через запятую. Нечисловые метки (если сервер пишет «1.8.x» или
/// «Java») остаются как есть — диапазон из них не построить.
export function versionRange(list?: string[] | null): string {
  const raw = (list || []).map((v) => (v || '').trim()).filter(Boolean)
  const nums = [...new Set(raw.filter((v) => /^\d+(\.\d+)*$/.test(v)))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )
  if (nums.length === 0) return raw.slice(0, 2).join(', ')
  if (nums.length === 1) return nums[0]
  return nums[0] + '–' + nums[nums.length - 1]
}

function Banner({ sv }: { sv: SnapshotServer }) {
  if (sv.banner)
    return (
      <span className="srv-banner">
        <img
          src={sv.banner}
          alt=""
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          loading="lazy"
          onError={(e) => e.currentTarget.remove()}
        />
      </span>
    )
  if (sv.motd)
    return (
      <span className="srv-banner">
        <span className="motd">
          {motdParts(sv.motd).map((p, i) => (
            <span key={i} style={{ color: p.color, ...(p.bold ? { fontWeight: 700 } : {}) }}>
              {p.text}
            </span>
          ))}
        </span>
      </span>
    )
  // Пустое место вместо надписи, когда сервер отвечает, но MOTD не отдал
  // (у карточек на хартбите плагина SLP молчит). «Сервер не в сети» рядом с
  // зелёной точкой и числом онлайна читалось как поломка каталога.
  return (
    <span className="srv-banner">
      {sv.isOnline ? null : (
        <span className="motd" style={{ color: 'var(--m-fg-faint)' }}>
          <span style={{ color: 'var(--m-fg-subtle)' }}>Сервер не в сети</span>
        </span>
      )}
    </span>
  )
}

function Logo({ sv }: { sv: SnapshotServer }) {
  if (sv.logo)
    return (
      <span className="srv-ava">
        <img
          src={sv.logo}
          alt=""
          style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '8px' }}
          loading="lazy"
          onError={(e) => {
            const p = e.currentTarget.parentNode as HTMLElement
            if (p) p.textContent = sv.name[0] || '?'
          }}
        />
      </span>
    )
  return <span className="srv-ava">{sv.name[0] || '?'}</span>
}

export function ServerRow({ sv, hidden, pos }: { sv: SnapshotServer; hidden?: boolean; pos?: number }) {
  const on = sv.isOnline
  const [label, setLabel] = useState('Играть')
  const busy = useRef(false)
  const range = versionRange(sv.versions)

  const join = () => {
    if (busy.current) return
    busy.current = true
    // Вход на сервер — тоже выбор режима: лобби вернёт на этот сервер.
    useLobby.getState().pick(serverMode(sv))
    setLabel('Подготовка…')
    quickJoin(sv.ip || '', sv.name || 'Сервер', sv.lic !== 'CRACKED', sv.versions)
      .catch(() => {})
      .finally(() => {
        setLabel('Играть')
        busy.current = false
      })
  }

  return (
    <div
      className="srv-row srv-row-click"
      data-slug={sv.slug}
      data-ip={sv.ip || ''}
      data-ver={(sv.versions && sv.versions[0]) || ''}
      data-track="server_open"
      data-kind="server"
      data-id={sv.slug || sv.ip || undefined}
      data-pos={pos}
      style={hidden ? { display: 'none' } : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        openServerDetail(sv)
      }}
    >
      {/* Номер места снят: на сайте рейтинг тоже без номеров мест. */}
      <Logo sv={sv} />
      <Banner sv={sv} />
      <span className="srv-body">
        <span className="srv-name">
          <b>{sv.name}</b>
          {on ? <span className="dot"></span> : null}
          <span className="pill">{sv.cat}</span>
          {sv.lic === 'CRACKED' ? <span className="pill lic-cracked">Без лицензии</span> : null}
        </span>
        <span className="srv-meta cat-srv-meta">
          {range ? (
            <span className="cat-srv-fact">
              <Icon id="i-blocks" />
              <b>{range}</b>
            </span>
          ) : null}
          {sv.ip ? (
            <span className="cat-srv-fact">
              <Icon id="i-link" />
              <b>{sv.ip}</b>
            </span>
          ) : null}
        </span>
      </span>
      <span className="srv-right">
        <span className={'srv-online cat-srv-online' + (on ? '' : ' off')}>
          {on ? (
            <>
              <Icon id="i-users" />
              <b>
                {sv.onlineApprox ? '~' : ''}
                {fmtN(sv.online)}
              </b>
            </>
          ) : (
            'офлайн'
          )}
        </span>
        {sv.ip ? (
          <button className="btn sm primary srv-join" disabled={!on || busy.current} data-track="join" onClick={join}>
            {label}
          </button>
        ) : (
          <span className="pill">Вход по заявке</span>
        )}
      </span>
    </div>
  )
}
