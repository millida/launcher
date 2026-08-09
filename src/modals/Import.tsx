import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { hasTauri } from '../ipc/tauri'
import { importInstance, importPackFile, scanImports } from '../ipc/commands'
import type { FoundInstance } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { closeModal, showToast, useUi } from '../state/ui'
import { track } from '../lib/telemetry'
import { foundKey } from '../lib/imports'
import { backdropClose } from '../lib/dismiss'

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
        showToast('Импортировано: ' + p.name)
        close()
      })
      .catch((err) => {
        if (String(err).includes('Отменено')) return
        showToast('' + err, 'error')
      })
      .finally(() => setFileBusy(false))
  }

  useEffect(() => {
    if (!modal.open) return
    setList(null)
    setFailed(false)
    setRows({})
    ;(hasTauri() ? scanImports() : Promise.resolve([] as FoundInstance[]))
      .then((l) => setList(l))
      .catch(() => setFailed(true))
  }, [modal.open])

  const existing = new Set(profiles.map((p) => p.name))

  if (!modal.open) return null
  const close = () => closeModal('impModal')

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="impModal"
      {...backdropClose(close)}
    >
      <div className="modal" style={{ width: '560px' }}>
        <h3>Импорт сборок</h3>
        <div className="sub">Сборки других лаунчеров на всех дисках — или свой файл сборки</div>
        <div id="impList" style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {failed ? (
            <p className="faint-note">Не удалось просканировать</p>
          ) : list === null ? (
            <p className="faint-note">Ищем сборки…</p>
          ) : list.length ? (
            list.map((it, i) => {
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
                    className="btn sm secondary imp-go"
                    data-i={i}
                    style={{ marginLeft: '8px' }}
                    disabled={state !== 'idle' || already}
                    title={already ? 'Такая сборка уже есть в лаунчере' : undefined}
                    onClick={() => {
                      setRows((r) => ({ ...r, [i]: 'busy' }))
                      importInstance(it.path, it.name, it.version, it.loader)
                        .then((p) => {
                          track('build_import', { source: it.source, mc: it.version, loader: it.loader })
                          setRows((r) => ({ ...r, [i]: 'done' }))
                          useProfiles.getState().setSelected(p.name)
                          void useProfiles.getState().refresh()
                          showToast('Импортировано: ' + p.name)
                        })
                        .catch((err) => {
                          setRows((r) => ({ ...r, [i]: 'idle' }))
                          showToast('' + err, 'error')
                        })
                    }}
                  >
                    {state === 'busy' ? 'Импорт…' : already ? 'Уже в лаунчере' : 'Импортировать'}
                  </button>
                </div>
              )
            })
          ) : (
            <p className="faint-note">
              Сборок в других лаунчерах не нашли. Поддерживаем Prism, MultiMC, CurseForge, GDLauncher, ATLauncher,
              Modrinth App и общую .minecraft (TLauncher, официальный). Если сборка лежит файлом — жми «Импорт из
              файла».
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '18px', justifyContent: 'space-between' }}>
          <button className="btn md primary" onClick={fromFile} disabled={fileBusy}>
            <Icon id="i-box2" /> {fileBusy ? 'Импортируем…' : 'Импорт из файла'}
          </button>
          <button className="btn md secondary" id="impClose" data-sound="close" onClick={close}>
            Закрыть
          </button>
        </div>
        <p className="faint-note" style={{ marginTop: '10px' }}>
          Подходит .mrpack (Modrinth), zip модпака CurseForge и zip готового клиента с папками mods/config.
        </p>
      </div>
    </div>
  )
}
