import { useEffect, useState } from 'react'
import { IconGrid } from '../components/IconGrid'
import { Select } from '../components/Select'
import { hasTauri } from '../ipc/tauri'
import { createProfile, listVersions } from '../ipc/commands'
import { track } from '../lib/telemetry'
import { BLOCK_ICONS } from '../lib/icons'
import { useProfiles } from '../state/profiles'
import { takeNewBuildPreset } from '../state/newBuild'
import type { JoinIntent } from '../state/newBuild'
import { quickJoin } from '../lib/joinServer'
import { closeModal, showToast, useUi } from '../state/ui'
import { backdropClose } from '../lib/dismiss'
import { pickVersionForServer } from '../lib/mcVersion'
import { AUTO_LOADER_VERSION, hasLoaderVersions, useLoaderBuilds } from '../lib/loaderBuilds'

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
  const [loaderVer, setLoaderVer] = useState(AUTO_LOADER_VERSION)
  const [icon, setIcon] = useState<string | null>(BLOCK_ICONS[0] || null)
  const [join, setJoin] = useState<JoinIntent | null>(null)
  const lb = useLoaderBuilds(loader, ver, modal.open)

  useEffect(() => {
    if (!modal.open) return
    const pre = takeNewBuildPreset()
    if (pre?.name) setName(pre.name)
    if (pre?.loader) setLoader(pre.loader)
    setJoin(pre?.join || null)
    setLoaderVer(AUTO_LOADER_VERSION)
    ;(hasTauri() ? listVersions() : Promise.resolve(['1.21.4', '1.21.1', '1.20.1'])).then((v) => {
      setVers(v)
      const wanted = pre?.version ? pickVersionForServer(v, [pre.version]) : ''
      setVer((cur) => wanted || cur || v[0] || '')
    })
  }, [modal.open])

  if (!modal.open) return null
  const close = () => closeModal('nbModal')

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="nbModal"
      {...backdropClose(close)}
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
            onChange={(v) => {
              setVer(v)
              setLoaderVer(AUTO_LOADER_VERSION)
            }}
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
                onClick={() => {
                  setLoader(k)
                  setLoaderVer(AUTO_LOADER_VERSION)
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="faint-note" style={{ marginTop: '8px' }}>
            Загрузчик нужен для модов. Forge и NeoForge ставятся дольше — их официальный инсталлер патчит клиент.
          </p>
        </div>
        {hasLoaderVersions(loader) ? (
          <div className="field" style={{ marginTop: '14px' }}>
            <label>Версия загрузчика</label>
            <Select
              width="100%"
              value={loaderVer}
              options={lb.options}
              disabled={lb.loading}
              placeholder={lb.loading ? 'Загружаем список…' : 'Рекомендуемая'}
              onChange={setLoaderVer}
            />
            <p className="faint-note" style={{ marginTop: '8px' }}>
              {lb.error
                ? 'Список версий загрузчика недоступен — поставим рекомендуемую.'
                : 'Оставь «Рекомендуемую», если моды не просят конкретную сборку.'}
            </p>
          </div>
        ) : null}
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
                createProfile(nm, ver, loader === 'fabric', loader, icon, loaderVer || null)
                  .then(async (p) => {
                    track('build_create', { mc: ver, loader, loaderVersion: loaderVer || 'auto' })
                    await useProfiles.getState().refresh()
                    showToast('Сборка «' + p.name + '» создана', 'ok', 'achievement')
                    if (!join) return
                    useProfiles.getState().setSelected(p.name)
                    void quickJoin(join.ip, join.name, join.licensed, [ver]).catch(() => {})
                  })
                  .catch((e) => showToast('Не удалось создать сборку: ' + e, 'error'))
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
