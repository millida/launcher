import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { IconGrid } from '../components/IconGrid'
import { IconEditor } from '../components/IconEditor'
import { Select } from '../components/Select'
import { hasTauri } from '../ipc/tauri'
import { createProfile, pickCoverImage } from '../ipc/commands'
import { track } from '../lib/telemetry'
import { BLOCK_ICONS } from '../lib/icons'
import { rememberIconRecipe } from '../lib/iconArt'
import type { IconRecipe } from '../lib/iconArt'
import { BUILD_NAME_MAX } from '../lib/format'
import { useProfiles } from '../state/profiles'
import { takeNewBuildPreset } from '../state/newBuild'
import { ensureMcVersionList, useMcVersionList, versionOptions } from '../state/mcVersionList'
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
  const [ver, setVer] = useState('')
  const [loader, setLoader] = useState('vanilla')
  const [loaderVer, setLoaderVer] = useState(AUTO_LOADER_VERSION)
  const [icon, setIcon] = useState<string | null>(BLOCK_ICONS[0] || null)
  // A custom image arrives as a ready data URL: anything outside the block set
  // is that image, so it needs no state of its own.
  const custom = icon && icon.startsWith('data:') ? icon : null
  const [recipe, setRecipe] = useState<IconRecipe | null>(null)
  const [editor, setEditor] = useState(false)
  const [join, setJoin] = useState<JoinIntent | null>(null)
  const lb = useLoaderBuilds(loader, ver, modal.open)
  const mcList = useMcVersionList((s) => s.list)
  const showSnapshots = useMcVersionList((s) => s.show)
  const verOpts = useMemo(() => versionOptions(mcList, showSnapshots), [mcList, showSnapshots])

  useEffect(() => {
    if (!modal.open) return
    const pre = takeNewBuildPreset()
    if (pre?.name) setName(pre.name)
    if (pre?.loader) setLoader(pre.loader)
    setJoin(pre?.join || null)
    setEditor(false)
    setLoaderVer(AUTO_LOADER_VERSION)
    ensureMcVersionList()
      .then(() => {
        const rel = useMcVersionList
          .getState()
          .list.filter((v) => v.kind === 'release')
          .map((v) => v.id)
        const wanted = pre?.version ? pickVersionForServer(rel, [pre.version]) : ''
        setVer((cur) => wanted || cur || rel[0] || '')
      })
      .catch((e) =>
        showToast('Список версий Minecraft не загрузился: ' + e + '. Проверь интернет и открой окно заново', 'error'),
      )
  }, [modal.open])

  useEffect(() => {
    if (!modal.open || !verOpts.length) return
    if (!verOpts.some((o) => o.value === ver)) setVer(verOpts[0].value)
  }, [modal.open, verOpts, ver])

  if (!modal.open) return null
  const close = () => closeModal('nbModal')

  const chooseImage = () => {
    if (!hasTauri()) {
      showToast('Доступно в приложении')
      return
    }
    pickCoverImage()
      .then((data) => {
        if (!data) return
        setIcon(data)
        setRecipe(null)
      })
      .catch((e) => showToast('Картинка не подошла: ' + e, 'error'))
  }

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="nbModal"
      {...backdropClose(close)}
    >
      <div className="modal mw-sm">
        <h3>Новая сборка</h3>
        <div className="sub">Версия и загрузчик — остальное сделаем сами</div>
        <div className="nb-head">
          <button className="nb-icon" id="nbPickImage" type="button" onClick={chooseImage} title="Поставить свою картинку">
            {icon ? <img src={icon} alt="" /> : <Icon id="i-image" />}
            <span className="nb-icon-hint">Своя картинка</span>
          </button>
          <div className="field" style={{ flex: 1, minWidth: 0, margin: 0 }}>
            <label>Название</label>
            <div className="input">
              <input
                id="nbName"
                placeholder="Моя сборка"
                maxLength={BUILD_NAME_MAX}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <p className="faint-note" style={{ marginTop: '8px' }}>
              Картинку сборки можно поставить прямо сейчас — нажми на квадрат слева.
            </p>
          </div>
        </div>
        <div className="field" style={{ marginBottom: '14px' }}>
          <label>Или выбери блок</label>
          <IconGrid id="nbIcons" current={icon} onPick={(v) => setIcon(v)} />
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
            <button className="btn sm secondary" style={{ flex: 1 }} data-sound="open" onClick={() => setEditor(true)}>
              Собрать свою…
            </button>
            <button className="btn sm secondary" style={{ flex: 1 }} onClick={chooseImage}>
              Своя картинка…
            </button>
            {custom ? (
              <button
                className="btn sm secondary"
                onClick={() => {
                  setIcon(BLOCK_ICONS[0] || null)
                  setRecipe(null)
                }}
              >
                Сбросить
              </button>
            ) : null}
          </div>
        </div>
        <div className="field" style={{ marginBottom: '14px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ flex: 1 }}>Версия Minecraft</span>
            <button
              type="button"
              className={'pill' + (showSnapshots ? ' acc' : '')}
              id="nbSnapshots"
              onClick={() => useMcVersionList.getState().setShow(!showSnapshots)}
            >
              Снапшоты
            </button>
          </label>
          <Select
            width="100%"
            search
            value={ver}
            options={verOpts}
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
              search
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
                    if (recipe) rememberIconRecipe(p.name, recipe)
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
      {editor ? (
        <IconEditor
          current={recipe}
          onCancel={() => setEditor(false)}
          onSave={(data, r) => {
            setIcon(data)
            setRecipe(r)
            setEditor(false)
          }}
        />
      ) : null}
    </div>
  )
}
