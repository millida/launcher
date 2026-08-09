import { convertFileSrc, installModpackVersion, openScreenshots, updateModpack } from '../ipc/commands'
import { keyMrModpack } from '../lib/installKeys'
import { runInstall } from '../state/installs'
import { closeModal, showToast, useUi } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { useScreens } from '../state/screens'
import { useModpackVersions } from '../state/modpack'
import { useProfiles } from '../state/profiles'
import { openImage } from '../components/ImageLightbox'
import { backdropClose } from '../lib/dismiss'

export function ScreenshotsOverlay() {
  const modal = useUi((s) => s.modals.shotOverlay)
  const { profile, paths } = useScreens()
  if (!modal.open) return null
  const close = () => closeModal('shotOverlay')
  return (
      <div
        id="shotOverlay"
        className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
        {...backdropClose(close)}
      >
        <div className="modal" style={{ width: '780px', maxHeight: '88%' }}>
          <h3>{'Скриншоты · ' + paths.length}</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3,1fr)',
              gap: '8px',
              maxHeight: '60vh',
              overflow: 'auto',
              margin: '12px 0',
            }}
          >
            {paths.map((p) => (
              <img
                key={p}
                loading="lazy"
                src={convertFileSrc(p)}
                style={{
                  width: '100%',
                  aspectRatio: '16/9',
                  objectFit: 'cover',
                  borderRadius: '8px',
                  cursor: 'zoom-in',
                  background: 'var(--m-inset)',
                }}
                onClick={() => openImage(convertFileSrc(p))}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between' }}>
            <button className="btn sm secondary" id="shotFolder" onClick={() => openScreenshots(profile)}>
              Открыть папку
            </button>
            <button className="btn md secondary" id="shotClose" data-sound="close" onClick={close}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
  )
}

export function ModpackVersionsOverlay() {
  const modal = useUi((s) => s.modals.mpOverlay)
  const { profile, slug, title, mode, curId, list, labels, setLabel } = useModpackVersions()
  const install = mode === 'install'
  if (!modal.open) return null
  const close = () => closeModal('mpOverlay')
  return (
    <div
      id="mpOverlay"
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      {...backdropClose(close)}
    >
      <div className="modal" style={{ width: '640px', maxHeight: '88%' }}>
        <h3>{install ? 'Установить «' + title + '»' : 'Версии модпака'}</h3>
        <div className="sub">
          {install
            ? 'Выбери версию сборки — Minecraft, загрузчик и моды поставим сами. Запускать сразу не будем.'
            : 'Обнови до новой или откатись на старую — моды переустановятся, миры и конфиги останутся'}
        </div>
        <div style={{ maxHeight: '56vh', overflow: 'auto', margin: '12px 0' }}>
          {list.length ? (
            list.map((v) => {
              const cur = v.id === curId
              const ch = (v.changelog || '').slice(0, 240)
              return (
                <div
                  key={v.id}
                  className="mod-line"
                  style={{ alignItems: 'flex-start', flexDirection: 'column', gap: '4px', padding: '10px 12px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                    <b>{v.name || v.version_number || v.id}</b>
                    <span className="pill">{v.version_number || ''}</span>
                    <span className="pill">{v.type || ''}</span>
                    {cur ? <span className="pill acc">текущая</span> : null}
                    <span style={{ flex: 1 }}></span>
                    {cur ? null : (
                      <button
                        className="btn sm secondary mp-apply"
                        data-vid={v.id}
                        onClick={async () => {
                          if (install) {
                            const started = runInstall({
                              key: keyMrModpack(slug),
                              title: title || slug,
                              run: () => installModpackVersion(slug, v.id),
                              onDone: (p) => {
                                close()
                                useProfiles.getState().setSelected(p.name)
                                void useProfiles.getState().refresh()
                                showToast('«' + p.name + '» установлена — жми «Играть»', 'ok', 'achievement')
                              },
                              onError: (er) => {
                                setLabel(v.id, 'Установить')
                                showToast('Не вышло поставить: ' + er, 'error')
                              },
                            })
                            if (started) setLabel(v.id, 'Ставим…')
                            return
                          }
                          if (!(await uiConfirm('Переустановить модпак на эту версию? Моды сборки заменятся.', { confirmLabel: 'Переустановить' })))
                            return
                          const upd = runInstall({
                            key: keyMrModpack(slug, profile),
                            title: profile,
                            run: () => updateModpack(profile, v.id),
                            onDone: () => {
                              close()
                              void useProfiles.getState().refresh()
                              showToast('Модпак обновлён')
                            },
                            onError: (er) => {
                              setLabel(v.id, 'Поставить')
                              showToast('' + er, 'error')
                            },
                          })
                          if (upd) setLabel(v.id, 'Ставим…')
                        }}
                      >
                        {labels[v.id] || (install ? 'Установить' : 'Поставить')}
                      </button>
                    )}
                  </div>
                  {ch ? (
                    <div style={{ fontSize: '12px', color: 'var(--m-fg-subtle)', lineHeight: 1.5 }}>{ch}</div>
                  ) : null}
                </div>
              )
            })
          ) : (
            <p className="faint-note">Версий не найдено</p>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn md secondary" id="mpClose" data-sound="close" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
