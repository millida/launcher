import { useEffect } from 'react'
import { Icon } from './Icon'
import { LOADER_NAME } from '../lib/format'
import { Cover } from './Cover'
import { useBuildPicker } from '../state/buildPicker'
import { useProfiles } from '../state/profiles'
import { openModal } from '../state/ui'
import { backdropClose } from '../lib/dismiss'

export function BuildPicker() {
  const { open, kindLabel, choose } = useBuildPicker()
  const profiles = useProfiles((s) => s.profiles)

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
        <h3>Куда добавить {kindLabel}?</h3>
        <div className="sub">Выбери сборку — установим {kindLabel} именно в неё.</div>

        {profiles.length ? (
          <div className="bp-list">
            {profiles.map((p) => (
              <button key={p.name} className="bp-item" onClick={() => choose(p.name)}>
                <span className="bp-cover">
                  <Cover url={p.icon} />
                </span>
                <span className="bp-meta">
                  <b>{p.name}</b>
                  <span>{LOADER_NAME(p) + ' · ' + p.version}</span>
                </span>
                <Icon id="i-chev-r" />
              </button>
            ))}
          </div>
        ) : (
          <p className="faint-note" style={{ marginTop: '14px' }}>
            Сборок пока нет — создай первую, и мы добавим {kindLabel} в неё.
          </p>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '18px' }}>
          <button
            className="btn md secondary"
            style={{ flex: 1 }}
            onClick={() => {
              choose(null)
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
