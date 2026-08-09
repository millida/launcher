import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { fmtN, motdParts } from '../lib/format'
import { useProfiles } from '../state/profiles'
import { setNewBuildPreset } from '../state/newBuild'
import { quickJoin } from '../lib/joinServer'
import { openModal, showToast } from '../state/ui'
import { useServerDetail } from '../state/serverDetail'
import { copyText } from '../lib/clipboard'
import { backdropClose } from '../lib/dismiss'

export function ServerDetail() {
  const { sv, close } = useServerDetail()
  const [label, setLabel] = useState('Играть')
  const busy = useRef(false)

  useEffect(() => {
    if (!sv) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sv, close])

  if (!sv) return null
  const on = (sv.online ?? 0) > 0

  const copyIp = async () => {
    if (!sv.ip) return
    showToast((await copyText(sv.ip)) ? 'Адрес скопирован: ' + sv.ip : 'Скопируй адрес вручную: ' + sv.ip)
  }

  const join = () => {
    if (busy.current) return
    busy.current = true
    setLabel('Подготовка…')
    quickJoin(sv.ip || '', sv.name || 'Сервер', sv.lic !== 'CRACKED')
      .then(() => close())
      .catch(() => {})
      .finally(() => {
        setLabel('Играть')
        busy.current = false
      })
  }

  const serverVersion = (sv.versions || [])[0] || ''
  const hasBuildForServer = useProfiles
    .getState()
    .profiles.some((p) => !serverVersion || p.version === serverVersion)

  const makeBuild = () => {
    setNewBuildPreset({ version: serverVersion, name: (sv.name || 'Сервер').slice(0, 24) })
    close()
    openModal('nbModal')
  }

  return (
    <div
      className="modal-bg open vis"
      style={{ zIndex: 190 }}
      {...backdropClose(close)}
    >
      <div className="modal srv-detail" style={{ width: '560px', maxWidth: '92vw', padding: 0, overflow: 'hidden' }}>
        <div className="srv-detail-banner">
          {sv.banner ? (
            <img src={sv.banner} alt="" onError={(e) => e.currentTarget.remove()} />
          ) : sv.motd ? (
            <span className="motd">
              {motdParts(sv.motd).map((p, i) => (
                <span key={i} style={{ color: p.color, ...(p.bold ? { fontWeight: 700 } : {}) }}>
                  {p.text}
                </span>
              ))}
            </span>
          ) : null}
          <button className="srv-detail-close" data-sound="close" onClick={close} title="Закрыть">
            <Icon id="i-x" />
          </button>
        </div>

        <div className="srv-detail-body">
          <div className="srv-detail-head">
            <span className="srv-detail-logo">
              {sv.logo ? (
                <img src={sv.logo} alt="" onError={(e) => ((e.currentTarget.parentNode as HTMLElement).textContent = sv.name[0] || '?')} />
              ) : (
                sv.name[0] || '?'
              )}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ marginBottom: '4px' }}>{sv.name}</h3>
              <div className="srv-detail-tags">
                {sv.cat ? <span className="pill">{sv.cat}</span> : null}
                {sv.lic === 'CRACKED' ? <span className="pill">Без лицензии</span> : null}
                {on ? (
                  <span className="pill acc">
                    <span className="dot"></span> {fmtN(sv.online)} онлайн
                  </span>
                ) : (
                  <span className="pill">офлайн</span>
                )}
              </div>
            </div>
          </div>

          {sv.desc ? <p className="srv-detail-desc">{sv.desc}</p> : null}

          <div className="srv-detail-facts">
            {sv.versions && sv.versions.length ? (
              <div className="srv-detail-fact">
                <Icon id="i-blocks" />
                <span>Версии</span>
                <b>{sv.versions.join(', ')}</b>
              </div>
            ) : null}
            {sv.ip ? (
              <button className="srv-detail-fact as-btn" onClick={copyIp} title="Скопировать адрес">
                <Icon id="i-copy" />
                <span>Адрес</span>
                <b>{sv.ip}</b>
              </button>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '18px', flexWrap: 'wrap' }}>
            {sv.ip ? (
              <button className="btn md primary" style={{ flex: 1 }} disabled={!on || busy.current} onClick={join}>
                <Icon id="i-play" /> {label}
              </button>
            ) : (
              <span className="pill" style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center' }}>
                Владелец не указал адрес
              </span>
            )}
            <button
              className="btn md secondary"
              onClick={makeBuild}
              title={serverVersion ? 'Создать сборку ' + serverVersion : 'Создать сборку'}
            >
              <Icon id="i-plus" />
              {hasBuildForServer ? 'Ещё сборка' : 'Сборка под сервер'}
            </button>
            <button className="btn md secondary" onClick={close}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
