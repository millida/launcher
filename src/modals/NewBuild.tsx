import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Select } from '../components/Select'
import { BuildIcon, IconPicker } from '../components/playhub/BuildIcon'
import { hasTauri } from '../ipc/tauri'
import { createProfile, setFpsBoost } from '../ipc/commands'
import type { McVersion } from '../ipc/commands'
import { track, trackFailure } from '../lib/telemetry'
import { BUILD_NAME_MAX } from '../lib/format'
import { DEFAULT_ICON } from '../lib/buildIcon'
import { useProfiles } from '../state/profiles'
import { autoBuildName, takeNewBuildPreset } from '../state/newBuild'
import { ensureMcVersionList, useMcVersionList } from '../state/mcVersionList'
import type { JoinIntent } from '../state/newBuild'
import { quickJoin } from '../lib/joinServer'
import { closeModal, showToast, useUi } from '../state/ui'
import { backdropClose } from '../lib/dismiss'
import { pickVersionForServer } from '../lib/mcVersion'
import { AUTO_LOADER_VERSION, hasLoaderVersions, useLoaderBuilds } from '../lib/loaderBuilds'
import { useLoaderBlocks, versionTag } from '../lib/loaderSupport'
import type { LoaderId } from '../lib/loaderSupport'
import '../styles/pixel/newbuild.css'
import { showReward } from '../components/reward/RewardReveal'

/**
 * «Новая сборка» (правки владельца 23.09.2026, 19:40): иконка сборки как в
 * Modrinth, загрузчик с официальным знаком, версия — сеткой без горизонтальной
 * прокрутки, «Снапшоты, бета, ванила» — переключателем. Загрузчик, который ядро не
 * поставит на выбранную версию, неактивен и говорит почему.
 */
const LOADERS: { id: LoaderId; label: string; logo: string; sub?: string }[] = [
  { id: 'vanilla', label: 'Vanilla', logo: '/loaders/vanilla.png', sub: 'без модов' },
  { id: 'fabric', label: 'Fabric', logo: '/loaders/fabric.png', sub: 'косметика' },
  { id: 'quilt', label: 'Quilt', logo: '/loaders/quilt.svg' },
  { id: 'forge', label: 'Forge', logo: '/loaders/forge.svg' },
  { id: 'neoforge', label: 'NeoForge', logo: '/loaders/neoforge.png' },
]
const DEFAULT_LOADER: LoaderId = 'fabric'
/** Буст FPS ставит ядро (engine/game/fpsboost.rs) — моды есть под Fabric и Forge. */
const FPS_LOADERS: LoaderId[] = ['fabric', 'forge']

const asLoader = (v?: string | null): LoaderId =>
  v === 'vanilla' || v === 'fabric' || v === 'quilt' || v === 'forge' || v === 'neoforge' ? v : DEFAULT_LOADER

export function NewBuildModal() {
  const modal = useUi((s) => s.modals.nbModal)
  const profiles = useProfiles((s) => s.profiles)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [ver, setVer] = useState('')
  const [loader, setLoader] = useState<LoaderId>(DEFAULT_LOADER)
  const [loaderVer, setLoaderVer] = useState(AUTO_LOADER_VERSION)
  const [icon, setIcon] = useState<string>(DEFAULT_ICON)
  const [pickIcon, setPickIcon] = useState(false)
  const [fps, setFps] = useState(true)
  const [busy, setBusy] = useState(false)
  const [join, setJoin] = useState<JoinIntent | null>(null)
  const [query, setQuery] = useState('')
  const [vanillaAsk, setVanillaAsk] = useState(false)
  const mcList = useMcVersionList((s) => s.list)
  const mcListError = useMcVersionList((s) => s.error)
  const showAll = useMcVersionList((s) => s.show)
  const [verLoading, setVerLoading] = useState(false)

  const kindOf = useMemo(() => new Map(mcList.map((v) => [v.id, v.kind])), [mcList])
  const verKind = kindOf.get(ver) || 'release'
  const blocks = useLoaderBlocks(ver, verKind, modal.open)
  const lb = useLoaderBuilds(loader, ver, modal.open && !blocks[loader])

  // По умолчанию — только релизы; «Снапшоты и беты» добавляет снапшоты,
  // pre-release, rc и старые beta/alpha из того же манифеста Mojang.
  const shown = useMemo<McVersion[]>(() => {
    const q = query.trim().toLowerCase()
    return mcList.filter((v) => (showAll || v.kind === 'release') && (!q || v.id.toLowerCase().includes(q)))
  }, [mcList, showAll, query])

  const autoName = useMemo(
    () =>
      autoBuildName(
        ver,
        profiles.map((p) => p.name),
      ),
    [ver, profiles],
  )
  const shownName = nameTouched ? name : autoName

  const loadVersions = (preferred?: string) => {
    setVerLoading(true)
    ensureMcVersionList()
      .then(() => {
        const rel = useMcVersionList
          .getState()
          .list.filter((v) => v.kind === 'release')
          .map((v) => v.id)
        const wanted = preferred ? pickVersionForServer(rel, [preferred]) : ''
        setVer((cur) => wanted || cur || rel[0] || '')
      })
      .catch((e) => {
        console.error('mc version list', e)
        trackFailure('build_create', e, { step: 'versions' })
        showToast('Версии Minecraft не загрузились', 'error')
      })
      .finally(() => setVerLoading(false))
  }

  useEffect(() => {
    if (!modal.open) return
    const pre = takeNewBuildPreset()
    setName(pre?.name || '')
    setNameTouched(!!pre?.name)
    setLoader(asLoader(pre?.loader))
    setJoin(pre?.join || null)
    setIcon(DEFAULT_ICON)
    setPickIcon(false)
    setFps(true)
    setBusy(false)
    setQuery('')
    setVanillaAsk(false)
    setLoaderVer(AUTO_LOADER_VERSION)
    loadVersions(pre?.version)
  }, [modal.open])

  // Загрузчик стал недоступен на новой версии — берём Fabric, иначе Vanilla.
  useEffect(() => {
    if (!blocks[loader]) return
    setLoader(blocks.fabric ? 'vanilla' : 'fabric')
    setLoaderVer(AUTO_LOADER_VERSION)
  }, [blocks, loader])

  // Vanilla — только вместе со «Снапшоты, бета, ванила» (владелец 24.09.2026,
  // 19:41): по умолчанию четыре загрузчика. Выключили — Vanilla меняем на Fabric.
  const snapOff = !showAll
  useEffect(() => {
    if (!modal.open || !snapOff || loader !== 'vanilla' || blocks.fabric) return
    setLoader('fabric')
    setLoaderVer(AUTO_LOADER_VERSION)
  }, [modal.open, snapOff, loader, blocks.fabric])
  const loaders = LOADERS.filter((l) => l.id !== 'vanilla' || showAll || loader === 'vanilla')

  if (!modal.open) return null
  const close = () => closeModal('nbModal')

  const create = () => {
    if (busy || !ver || blocks[loader]) return
    const nm = name.trim() || autoName
    const withFps = fps && FPS_LOADERS.includes(loader)
    if (!hasTauri()) {
      showReward({ level: 'mid', items: [{ name: nm, art: <BuildIcon icon={icon} size={60} /> }], title: 'Сборка создана', sub: nm })
      useProfiles.setState((s) => ({
        profiles: [...s.profiles, { name: nm, version: ver, fabric: loader === 'fabric', loader, icon }],
      }))
      close()
      return
    }
    setBusy(true)
    createProfile(nm, ver, loader === 'fabric', loader, icon, loaderVer || null)
      .then(async (p) => {
        track('build_create', { mc: ver, loader, loaderVersion: loaderVer || 'auto', fps: withFps ? 1 : 0 })
        if (withFps) await setFpsBoost(p.name, true).catch((e) => console.error('[new-build] fps', e))
        await useProfiles.getState().refresh()
        showReward({ level: 'mid', items: [{ name: p.name, art: <BuildIcon icon={icon} size={60} /> }], title: 'Сборка создана', sub: p.name })
        close()
        if (!join) return
        useProfiles.getState().setSelected(p.name)
        void quickJoin(join.ip, join.name, join.licensed, [ver]).catch(() => {})
      })
      .catch((e) => {
        setBusy(false)
        trackFailure('build_create', nm.length >= 2 ? String(e).split(nm).join('<build>') : e, { step: 'create', mc: ver, loader })
        showToast('Не удалось создать сборку: ' + e, 'error')
      })
  }

  const withLoaderVer = hasLoaderVersions(loader)
  const verFailed = !mcList.length && !verLoading && !!mcListError

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="nbModal"
      {...backdropClose(close)}
    >
      <div className="modal nb-modal nb2">
        <h3>Новая сборка</h3>
        {vanillaAsk ? (
          // Vanilla без Millida (владелец 24.09.2026, 19:42): предупреждаем сразу.
          <div className="nb2-ask" role="alertdialog" aria-label="Внимание">
            <div className="nb2-ask-box">
              <Icon id="i-alert" />
              <b>Внимание</b>
              <ul>
                <li>Не будет косметики Millida</li>
                <li>Не будет оптимизации и буста FPS</li>
                <li>Не поставить моды</li>
              </ul>
              <div className="nb2-ask-foot">
                <button type="button" className="btn md primary" data-track="vanilla_keep_fabric" onClick={() => setVanillaAsk(false)}>
                  Оставить {loader === 'fabric' ? 'Fabric' : LOADERS.find((x) => x.id === loader)?.label}
                </button>
                <button
                  type="button"
                  className="btn md secondary"
                  data-track="vanilla_confirm"
                  onClick={() => {
                    setVanillaAsk(false)
                    setLoader('vanilla')
                    setLoaderVer(AUTO_LOADER_VERSION)
                  }}
                >
                  Всё равно Vanilla
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="nb2-head">
          <button type="button" className="bi-edit" aria-label="Изменить иконку" data-sound="open" onClick={() => setPickIcon(true)}>
            <BuildIcon icon={icon} size={72} />
            <span className="bi-edit-lab" aria-hidden="true">
              <Icon id="i-edit" />
              Изменить
            </span>
          </button>
          <div className="field nb-field nb2-name">
            <label htmlFor="nbName">Название</label>
            <div className="input">
              <input
                id="nbName"
                placeholder={autoName}
                maxLength={BUILD_NAME_MAX}
                value={shownName}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameTouched(true)
                }}
              />
            </div>
          </div>
        </div>

        <div className="field nb-field">
          <label>Загрузчик</label>
          <div className="nb2-loaders" style={{ gridTemplateColumns: 'repeat(' + loaders.length + ', minmax(0, 1fr))' }}>
            {loaders.map((l) => {
              const why = blocks[l.id]
              return (
                <button
                  key={l.id}
                  type="button"
                  className={'nb2-lt' + (loader === l.id ? ' on' : '')}
                  data-nbl={l.id}
                  aria-pressed={loader === l.id}
                  disabled={!!why}
                  onClick={() => {
                    if (l.id === 'vanilla' && loader !== 'vanilla') return setVanillaAsk(true)
                    setLoader(l.id)
                    setLoaderVer(AUTO_LOADER_VERSION)
                  }}
                >
                  <img src={l.logo} alt="" draggable={false} />
                  <b>{l.label}</b>
                  <span>{why || l.sub || ''}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="field nb-field">
          <label className="nb2-vhead">
            <span>Версия Minecraft</span>
            <span className="input nb2-search">
              <Icon id="i-search" />
              <input placeholder="Найти" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Найти версию" />
            </span>
            <span
              className={'tgl sm' + (showAll ? ' on' : '')}
              role="switch"
              aria-checked={showAll}
              aria-labelledby="nbSnapLab"
              id="nbSnapshots"
              onClick={() => useMcVersionList.getState().setShow(!showAll)}
            ></span>
            <span id="nbSnapLab" className="nb2-tgl-lab" onClick={() => useMcVersionList.getState().setShow(!showAll)}>
              Снапшоты, бета, ванила
            </span>
          </label>
          {verFailed ? (
            <button type="button" className="nb-retry" onClick={() => loadVersions()}>
              <Icon id="i-alert" />
              <span>Нет списка версий</span>
              <Icon id="i-restart" />
            </button>
          ) : verLoading && !mcList.length ? (
            <div className="nb2-vgrid" aria-label="Загрузка">
              {Array.from({ length: 18 }, (_, i) => (
                <span key={i} className="skel nb2-ver-skel" />
              ))}
            </div>
          ) : (
            <div className="nb2-vgrid" role="listbox" aria-label="Версия Minecraft">
              {shown.map((v) => {
                const tag = versionTag(v.id, v.kind)
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="option"
                    aria-selected={ver === v.id}
                    className={'nb2-ver' + (ver === v.id ? ' on' : '') + (tag ? ' pre' : '')}
                    onClick={() => {
                      setVer(v.id)
                      setLoaderVer(AUTO_LOADER_VERSION)
                    }}
                  >
                    <b>{v.id}</b>
                    {tag ? <span>{tag}</span> : null}
                  </button>
                )
              })}
              {!shown.length ? <span className="nb2-none">Нет такой версии</span> : null}
            </div>
          )}
        </div>

        <div className="nb2-opts">
          <div className="field nb-field">
            <label>
              <span>Версия загрузчика</span>
            </label>
            {withLoaderVer && lb.loading ? (
              <span className="skel nb-skel" aria-label="Загрузка" />
            ) : (
              <Select
                width="100%"
                search
                value={withLoaderVer ? loaderVer : ''}
                options={withLoaderVer ? lb.options : []}
                disabled={!withLoaderVer}
                placeholder={withLoaderVer ? 'Рекомендуемая' : 'Не нужна'}
                onChange={setLoaderVer}
              />
            )}
          </div>
          <div className={'nb2-fps' + (FPS_LOADERS.includes(loader) ? '' : ' off')}>
            <Icon id="i-zap" />
            <b>Буст FPS</b>
            <span
              className={'tgl' + (fps && FPS_LOADERS.includes(loader) ? ' on' : '')}
              role="switch"
              aria-checked={fps && FPS_LOADERS.includes(loader)}
              aria-label="Буст FPS"
              aria-disabled={!FPS_LOADERS.includes(loader)}
              onClick={() => FPS_LOADERS.includes(loader) && setFps(!fps)}
            ></span>
          </div>
        </div>

        <div className="nb-foot">
          <button className="btn md secondary" id="nbCancel" data-sound="close" onClick={close}>
            Отмена
          </button>
          <button
            className={'btn md primary nb-create' + (busy ? ' busy' : '')}
            id="nbCreate"
            disabled={busy || !ver || !!blocks[loader]}
            aria-busy={busy}
            onClick={create}
          >
            <span className="nb-create-lab">Создать</span>
            {busy ? <span className="spin nb-create-spin" /> : null}
          </button>
        </div>
      </div>
      {pickIcon ? <IconPicker icon={icon} onPick={setIcon} onClose={() => setPickIcon(false)} /> : null}
    </div>
  )
}
