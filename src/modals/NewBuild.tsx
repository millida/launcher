import { useEffect, useState } from 'react'
import { IconGrid } from '../components/IconGrid'
import { Select } from '../components/Select'
import { hasTauri } from '../ipc/tauri'
import { createProfile, listVersions } from '../ipc/commands'
import { track } from '../lib/telemetry'
import { BLOCK_ICONS } from '../lib/icons'
import { useProfiles } from '../state/profiles'
import { takeNewBuildPreset } from '../state/newBuild'
import { closeModal, showToast, useUi } from '../state/ui'

const LOADERS: [string, string][] = [
  ['vanilla', 'Ванилла'],
  ['fabric', 'Fabric'],
  ['quilt', 'Quilt'],
  ['forge', 'Forge'],
  ['neoforge', 'NeoForge'],
]

export function NewBuildModal() {
  const modal = useUi((s) => s.modals.nbModal)
  const [name, setName] = useState('')
  const [vers, setVers] = useState<string[]>([])
  const [ver, setVer] = useState('')
  const [loader, setLoader] = useState('vanilla')
  const [icon, setIcon] = useState<string | null>(BLOCK_ICONS[0] || null)

  useEffect(() => {
    if (!modal.open) return
    const pre = takeNewBuildPreset()
    if (pre?.name) setName(pre.name)
    if (pre?.loader) setLoader(pre.loader)
    ;(hasTauri() ? listVersions() : Promise.resolve(['1.21.4', '1.21.1', '1.20.1'])).then((v) => {
      setVers(v)
      const wanted = pre?.version && v.includes(pre.version) ? pre.version : ''
      setVer((cur) => wanted || cur || v[0] || '')
    })
  }, [modal.open])

  if (!modal.open) return null
  const close = () => closeModal('nbModal')

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="nbModal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal" style={{ width: '460px' }}>
        <h3>Новая сборка</h3>
        <div className="sub">Версия и загрузчик — остальное сделаем сами</div>
        <div className="field" style={{ marginBottom: '14px' }}>
          <label>Название</label>
          <div className="input">
            <input id="nbName" placeholder="Моя сборка" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: '14px' }}>
          <label>Иконка сборки</label>
          <IconGrid id="nbIcons" current={icon} onPick={(v) => setIcon(v)} />
        </div>
        <div className="field" style={{ marginBottom: '14px' }}>
          <label>Версия Minecraft</label>
          <Select
            width="100%"
            value={ver}
            options={vers.map((v) => ({ value: v, label: v }))}
            onChange={(v) => setVer(v)}
          />
        </div>
        <div className="field">
          <label>Загрузчик</label>
          <div className="segs">
            {LOADERS.map(([k, label]) => (
              <button
                key={k}
                className={'seg' + (loader === k ? ' on' : '')}
                data-nbl={k}
                onClick={() => setLoader(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="faint-note" style={{ marginTop: '8px' }}>
            Загрузчик нужен для модов. Forge и NeoForge ставятся дольше — их официальный инсталлер патчит клиент.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '22px', justifyContent: 'flex-end' }}>
          <button className="btn md secondary" id="nbCancel" data-sound="close" onClick={close}>
            Отмена
          </button>
          <button
            className="btn md primary"
            id="nbCreate"
            onClick={() => {
              const nm = name.trim() || 'Моя сборка'
              if (hasTauri()) {
                createProfile(nm, ver, loader === 'fabric', loader, icon).then(() => {
                  track('build_create', { mc: ver, loader })
                  void useProfiles.getState().refresh()
                  showToast('Сборка «' + nm + '» создана', 'ok', 'achievement')
                })
              } else {
                showToast('Сборка «' + nm + '» создана (демо)')
              }
              close()
            }}
          >
            Создать
          </button>
        </div>
      </div>
    </div>
  )
}
