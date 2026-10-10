import { useEffect } from 'react'
import { Icon } from './Icon'
import { LOADER_NAME } from '../lib/format'
import { BuildIcon } from './playhub/BuildIcon'
import { useBuildPicker } from '../state/buildPicker'
import { useProfiles } from '../state/profiles'
import { openModal } from '../state/ui'
import { setNewBuildPreset } from '../state/newBuild'
import { backdropClose } from '../lib/dismiss'
import { versionFits } from '../lib/mcVersion'

export function BuildPicker() {
  const { open, kindLabel, choose, title, sub, wanted, only, preset } = useBuildPicker()
  const all = useProfiles((s) => s.profiles)
  const profiles = only ? all.filter((p) => only.includes(p.name)) : all
  const list = wanted.length
    ? [...profiles].sort((a, b) => Number(versionFits(b.version, wanted)) - Number(versionFits(a.version, wanted)))
    : profiles

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && choose(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, choose])

  if (!open) return null

  return (
    <div
      className="modal-bg open vis"
      style={{ zIndex: 470 }}
      {...backdropClose(() => choose(null))}
    >
      <div className="modal mw-xs">
        <h3>{title || 'Куда добавить ' + kindLabel + '?'}</h3>
        {sub ? <div className="sub">{sub}</div> : null}

        {list.length ? (
          <div className="bp-list">
            {list.map((p) => {
              const off = wanted.length > 0 && !versionFits(p.version, wanted)
              return (
                <button key={p.name} className="bp-item" onClick={() => choose(p.name)}>
                  <span className="bp-cover">
                    <BuildIcon icon={p.icon} name={p.name} size={44} />
                  </span>
                  <span className="bp-meta">
                    <b>{p.name}</b>
                    <span>{LOADER_NAME(p) + ' · ' + p.version + (off ? ' · не та версия' : '')}</span>
                  </span>
                  <Icon id="i-chev-r" />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="bx-mini-empty">
            <Icon id="i-box2" />
            <b>{only && all.length ? 'Подходящей сборки нет' : 'Сборок пока нет'}</b>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
          <button
            className={'btn md ' + (list.length ? 'secondary' : 'primary')}
            style={{ flex: 1 }}
            onClick={() => {
              choose(null)
              if (preset) setNewBuildPreset(preset)
              openModal('nbModal')
            }}
          >
            <Icon id="i-plus" /> Новая сборка
          </button>
          <button className="btn md ghost" onClick={() => choose(null)}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}
