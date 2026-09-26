import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { hasTauri } from '../ipc/tauri'
import { importInstance, importPackFile, pickImportDir, scanImports } from '../ipc/commands'
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

const imported = (p: { name: string; icon?: string | null }) =>
  showReward({ level: 'mid', items: [{ name: p.name, art: <BuildIcon icon={p.icon} size={60} /> }], title: 'Сборка импортирована', sub: p.name })

/// Где ищем сборки — показываем значками вместо абзаца со списком.
const SOURCES = ['Prism', 'MultiMC', 'CurseForge', 'GDLauncher', 'ATLauncher', 'Modrinth App', 'TLauncher']

type RowState = 'idle' | 'busy' | 'done'

export function ImportModal() {
  const modal = useUi((s) => s.modals.impModal)
  const profiles = useProfiles((s) => s.profiles)
  const [list, setList] = useState<FoundInstance[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [rows, setRows] = useState<Record<number, RowState>>({})
  const [fileBusy, setFileBusy] = useState(false)

  const fromFile = () => {
    if (fileBusy) return
    if (!hasTauri()) {
      showToast('Импорт файлом доступен в приложении лаунчера', 'error')
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
        if (String(err).includes('Отменено')) return
        trackImportFailure('file', err)
        showToast('' + err, 'error')
      })
      .finally(() => setFileBusy(false))
  }

  // Сам ничего не нашёл — человек показывает папку (правка владельца 22:03):
  // .minecraft, папка экземпляров другого лаунчера или одна сборка.
  const fromDir = () => {
    if (!hasTauri()) {
      showToast('Доступно в приложении лаунчера', 'error')
      return
    }
    pickImportDir()
      .then((l) => {
        if (!l) return
        if (!l.length) {
          showToast('В этой папке сборок нет', 'error')
          return
        }
        setFailed(false)
        setList((cur) => [...(cur || []), ...l.filter((x) => !(cur || []).some((c) => c.path === x.path))])
      })
      .catch((e) => showToast('Папка не открылась: ' + e, 'error'))
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
        <h3>Импорт сборок</h3>
        <div id="impList" className="imp-list">
          {failed ? (
            <div className="bx-mini-empty">
              <Icon id="i-alert" />
              <b>Не получилось поискать</b>
              <button className="btn sm secondary" onClick={scan}>
                <Icon id="i-restart" /> Повторить
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
                <b>Перенести в Millida целиком</b>
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
                  Перенести
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
                    {state === 'busy' ? 'Добавляем…' : already ? <><Icon id="i-check" /> Уже есть</> : 'Добавить'}
                  </button>
                </div>
              )
            })}
            </>
          ) : (
            <div className="bx-mini-empty">
              <b>Других лаунчеров не нашли</b>
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
            <b>Из папки</b>
            <span>Другой лаунчер</span>
          </button>
          <button className="imp-way" onClick={fromFile} disabled={fileBusy}>
            <Icon id="i-upload" />
            <b>{fileBusy ? 'Добавляем…' : 'Из файла'}</b>
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
            <b>По коду</b>
            <span>AB23-CD45</span>
          </button>
        </div>
        <div style={{ display: 'flex', marginTop: '14px', justifyContent: 'flex-end' }}>
          <button className="btn md secondary" id="impClose" data-sound="close" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
