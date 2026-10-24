import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { hasTauri } from '../ipc/tauri'
import { importInstance, importPackFile, importPackwiz, pickImportDir, scanImports } from '../ipc/commands'
import { apiErrorText } from '../lib/apiError'
import '../styles/pixel/build-extras.css'
import { FtbBrowser } from '../components/build/FtbBrowser'
import type { FoundInstance } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { closeModal, openModal, showToast, useUi } from '../state/ui'
import { track } from '../lib/telemetry'
import { foundKey } from '../lib/imports'
import { backdropClose } from '../lib/dismiss'
import { usePackCode } from '../state/packCode'
import { showReward } from '../components/reward/RewardReveal'
import { BuildIcon } from '../components/playhub/BuildIcon'
import { trackImportFailure } from '../lib/importTrack'
import { t, useT } from '../i18n'
import { isPickCancelled } from '../lib/coreErrors'

const imported = (p: { name: string; icon?: string | null }) =>
  showReward({ level: 'mid', items: [{ name: p.name, art: <BuildIcon icon={p.icon} name={p.name} size={60} /> }], title: t('Сборка импортирована'), sub: p.name })

/// Где ищем сборки — показываем значками вместо абзаца со списком.
const SOURCES = ['Prism', 'MultiMC', 'CurseForge', 'GDLauncher', 'ATLauncher', 'Modrinth App', 'TLauncher']

type RowState = 'idle' | 'busy' | 'done'

export function ImportModal() {
  const t = useT()
  const modal = useUi((s) => s.modals.impModal)
  const profiles = useProfiles((s) => s.profiles)
  const [list, setList] = useState<FoundInstance[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [rows, setRows] = useState<Record<number, RowState>>({})
  const [fileBusy, setFileBusy] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)
  const [ftbOpen, setFtbOpen] = useState(false)

  const fromLink = () => {
    const url = link.trim()
    if (!url || linkBusy) return
    if (!hasTauri()) {
      showToast(t('Доступно в приложении'), 'error')
      return
    }
    setLinkBusy(true)
    importPackwiz(url)
      .then((r) => {
        track('build_import', { source: 'packwiz' })
        useProfiles.getState().setSelected(r.profile)
        void useProfiles.getState().refresh()
        imported({ name: r.profile })
        if (r.skipped.length) showToast(t('Не скачались: {list}', { list: r.skipped.join(', ') }), 'error')
        close()
      })
      .catch((e) => {
        trackImportFailure('packwiz', e)
        showToast(apiErrorText(e, t('Не удалось поставить пак по ссылке')), 'error')
      })
      .finally(() => setLinkBusy(false))
  }

  const fromFile = () => {
    if (fileBusy) return
    if (!hasTauri()) {
      showToast(t('Импорт файлом доступен в приложении лаунчера'), 'error')
      return
    }
    setFileBusy(true)
    importPackFile()
      .then((p) => {
        track('build_import', { source: 'file', mc: p.version, loader: p.loader || (p.fabric ? 'fabric' : 'vanilla') })
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        imported(p)
        close()
      })
      .catch((err) => {
        if (isPickCancelled(err)) return
        trackImportFailure('file', err)
        showToast('' + err, 'error')
      })
      .finally(() => setFileBusy(false))
  }

  // Сам ничего не нашёл — человек показывает папку (правка владельца 22:03):
  // .minecraft, папка экземпляров другого лаунчера или одна сборка.
  const fromDir = () => {
    if (!hasTauri()) {
      showToast(t('Доступно в приложении лаунчера'), 'error')
      return
    }
    pickImportDir()
      .then((l) => {
        if (!l) return
        if (!l.length) {
          showToast(t('В этой папке сборок нет'), 'error')
          return
        }
        setFailed(false)
        setList((cur) => [...(cur || []), ...l.filter((x) => !(cur || []).some((c) => c.path === x.path))])
      })
      .catch((e) => showToast(t('Папка не открылась: {error}', { error: String(e) }), 'error'))
  }

  const scan = () => {
    setList(null)
    setFailed(false)
    setRows({})
    ;(hasTauri() ? scanImports() : Promise.resolve([] as FoundInstance[]))
      .then((l) => setList(l))
      .catch((e) => {
        console.error('scanImports', e)
        setFailed(true)
      })
  }

  useEffect(() => {
    if (!modal.open) return
    scan()
  }, [modal.open])

  const existing = new Set(profiles.map((p) => p.name))
  const toMove = (list || []).filter((it) => it.movable && !existing.has(it.name))
  const toCopy = (list || []).filter((it) => !it.movable)

  if (!modal.open) return null
  const close = () => closeModal('impModal')

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="impModal"
      {...backdropClose(close)}
    >
      <div className="modal mw-md">
        <h3>{t('Импорт сборок')}</h3>
        <div id="impList" className="imp-list">
          {failed ? (
            <div className="bx-mini-empty">
              <Icon id="i-alert" />
              <b>{t('Не получилось поискать')}</b>
              <button className="btn sm secondary" onClick={scan}>
                <Icon id="i-restart" /> {t('Повторить')}
              </button>
            </div>
          ) : list === null ? (
            <div className="bx-skel-list" aria-busy="true">
              <span className="skel" />
              <span className="skel" />
              <span className="skel" />
            </div>
          ) : toMove.length || toCopy.length ? (
            <>
            {toMove.length ? (
              <div className="mod-line">
                <span className="mod-mini">
                  <Icon id="i-download" />
                </span>
                <b>{t('Перенести в Millida целиком')}</b>
                <span className="pill" style={{ marginRight: '6px' }}>
                  Prism · Modrinth App
                </span>
                <span className="pill">{toMove.length}</span>
                <button
                  className="btn sm primary"
                  style={{ marginLeft: '8px' }}
                  data-sound="open"
                  onClick={() => {
                    close()
                    openModal('mvModal')
                  }}
                >
                  {t('Перенести')}
                </button>
              </div>
            ) : null}
            {toCopy.map((it, i) => {
              const state = rows[i] || 'idle'
              const already = state === 'done' || existing.has(it.name)
              return (
                <div className="mod-line" key={foundKey(it)}>
                  <span className="mod-mini">
                    <Icon id="i-box2" />
                  </span>
                  <b>{it.name}</b>
                  <span className="pill" style={{ marginRight: '6px' }}>
                    {it.source}
                  </span>
                  <span className="pill">{it.loader + ' · ' + it.version}</span>
                  <button
                    className={'btn sm imp-go ' + (already ? 'ghost' : 'primary')}
                    data-i={i}
                    style={{ marginLeft: '8px' }}
                    disabled={state !== 'idle' || already}
                    onClick={() => {
                      setRows((r) => ({ ...r, [i]: 'busy' }))
                      importInstance(it.path, it.name, it.version, it.loader)
                        .then((p) => {
                          track('build_import', { source: it.source, mc: it.version, loader: it.loader })
                          setRows((r) => ({ ...r, [i]: 'done' }))
                          useProfiles.getState().setSelected(p.name)
                          void useProfiles.getState().refresh()
                          imported(p)
                        })
                        .catch((err) => {
                          trackImportFailure(it.source, err, it)
                          setRows((r) => ({ ...r, [i]: 'idle' }))
                          showToast('' + err, 'error')
                        })
                    }}
                  >
                    {state === 'busy' ? t('Добавляем…') : already ? <><Icon id="i-check" /> {t('Уже есть')}</> : t('Добавить')}
                  </button>
                </div>
              )
            })}
            </>
          ) : (
            <div className="bx-mini-empty">
              <b>{t('Других лаунчеров не нашли')}</b>
              <div className="bx-chips">
                {SOURCES.map((x) => (
                  <span className="pill" key={x}>
                    {x}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Три других входа — одной строкой, одинаковыми плитками: файл,
            код от друга. Раньше «По коду» висел отдельной кнопкой на экране
            «Сборки», а форматы файла объяснял абзац под кнопками. */}
        <div className="imp-ways">
          <button className="imp-way" onClick={fromDir}>
            <Icon id="i-folder" />
            <b>{t('Из папки')}</b>
            <span>{t('Другой лаунчер')}</span>
          </button>
          <button className="imp-way" onClick={fromFile} disabled={fileBusy}>
            <Icon id="i-upload" />
            <b>{fileBusy ? t('Добавляем…') : t('Из файла')}</b>
            <span>.mrpack · .zip</span>
          </button>
          <button
            className="imp-way"
            data-sound="open"
            onClick={() => {
              close()
              usePackCode.getState().show()
            }}
          >
            <Icon id="i-link" />
            <b>{t('По коду')}</b>
            <span>AB23-CD45</span>
          </button>
          <button className={'imp-way' + (linkOpen ? ' on' : '')} onClick={() => setLinkOpen((v) => !v)}>
            <Icon id="i-globe" />
            <b>{t('По ссылке')}</b>
            <span>packwiz</span>
          </button>
          <button className="imp-way" onClick={() => setFtbOpen(true)}>
            <Icon id="i-box" />
            <b>FTB</b>
            <span>Feed The Beast</span>
          </button>
        </div>
        {ftbOpen ? (
          <FtbBrowser
            onClose={() => setFtbOpen(false)}
            onInstalled={(p) => {
              track('build_import', { source: 'ftb', mc: p.version, loader: p.loader || 'vanilla' })
              useProfiles.getState().setSelected(p.name)
              void useProfiles.getState().refresh()
              imported(p)
              setFtbOpen(false)
              close()
            }}
          />
        ) : null}
        {linkOpen ? (
          <div className="bx-link-row">
            <div className="input sm" style={{ flex: 1 }}>
              <input
                autoFocus
                value={link}
                spellCheck={false}
                placeholder="https://…/pack.toml"
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fromLink()}
              />
            </div>
            <button className="btn sm primary" disabled={!link.trim() || linkBusy} onClick={fromLink}>
              {linkBusy ? t('Ставим…') : t('Поставить')}
            </button>
          </div>
        ) : null}
        <div style={{ display: 'flex', marginTop: '14px', justifyContent: 'flex-end' }}>
          <button className="btn md secondary" id="impClose" data-sound="close" onClick={close}>
            {t('Закрыть')}
          </button>
        </div>
      </div>
    </div>
  )
}
