import { useRef, useState } from 'react'
import type { SnapshotServer } from '../lib/snapshot'
import { fmtN, motdParts } from '../lib/format'
import { quickJoin } from '../lib/joinServer'
import { openServerDetail } from '../state/serverDetail'

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
  return (
    <span className="srv-banner">
      <span className="motd" style={{ color: 'var(--m-fg-faint)' }}>
        <span style={{ color: 'var(--m-fg-subtle)' }}>Сервер не в сети</span>
      </span>
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

export function ServerRow({ sv, hidden }: { sv: SnapshotServer; hidden?: boolean }) {
  const on = (sv.online ?? 0) > 0
  const [label, setLabel] = useState('Играть')
  const busy = useRef(false)

  const join = () => {
    if (busy.current) return
    busy.current = true
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
      style={hidden ? { display: 'none' } : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        openServerDetail(sv)
      }}
    >
      <span className={'srv-rank' + (sv.rank <= 3 ? ' medal' : '')}>{sv.rank}</span>
      <Logo sv={sv} />
      <Banner sv={sv} />
      <span className="srv-body">
        <span className="srv-name">
          <b>{sv.name}</b>
          {on ? <span className="dot"></span> : null}
          <span className="pill">{sv.cat}</span>
          {sv.lic === 'CRACKED' ? <span className="pill lic-cracked">Без лицензии</span> : null}
        </span>
        <span className="srv-desc">{sv.desc || ''}</span>
        <span className="srv-meta">
          {sv.versions && sv.versions.length ? (
            <>
              Версии <b>{sv.versions.join(', ')}</b>
            </>
          ) : null}
          {sv.lic === 'CRACKED' ? ' · вход без лицензии' : ''}
          {sv.ip ? (
            <>
              {' · '}
              <b>{sv.ip}</b>
            </>
          ) : null}
        </span>
      </span>
      <span className="srv-right">
        <span className="srv-online">
          {on ? (
            <>
              <b>{fmtN(sv.online)}</b> онлайн
            </>
          ) : (
            'офлайн'
          )}
        </span>
        {sv.ip ? (
          <button className="btn sm secondary srv-join" disabled={!on || busy.current} onClick={join}>
            {label}
          </button>
        ) : (
          <span className="pill" title="Вход на сервер — по заявке (белый список)">
            Вход по заявке
          </span>
        )}
      </span>
    </div>
  )
}
