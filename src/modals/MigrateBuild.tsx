import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { Select } from '../components/Select'
import { migrateProfile } from '../ipc/commands'
import { keyMigrate } from '../lib/installKeys'
import { BUILD_NAME_MAX } from '../lib/format'
import { backdropClose } from '../lib/dismiss'
import { runInstall } from '../state/installs'
import { useMigrate } from '../state/migrate'
import { useProfiles } from '../state/profiles'
import { ensureMcVersionList, useMcVersionList, versionOptions } from '../state/mcVersionList'
import { closeModal, showToast, useUi } from '../state/ui'

const LOADERS: [string, string][] = [
  ['vanilla', 'Ванилла'],
  ['fabric', 'Fabric'],
  ['quilt', 'Quilt'],
  ['forge', 'Forge'],
  ['neoforge', 'NeoForge'],
]

function PlanSkeleton() {
  return (
    <div className="skel-rows" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="skel-row">
          <div className="skel" style={{ width: '18px', height: '18px', borderRadius: '6px' }}></div>
          <div className="skel skel-line" style={{ width: 40 + ((i * 17) % 45) + '%' }}></div>
        </div>
      ))}
    </div>
  )
}

export function MigrateBuildModal() {
  const modal = useUi((s) => s.modals.mgModal)
  const { profile, version, loader, plan, loading, error, set, load } = useMigrate()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const mcList = useMcVersionList((s) => s.list)
  const showSnapshots = useMcVersionList((s) => s.show)
  const verOpts = useMemo(() => versionOptions(mcList, showSnapshots, version), [mcList, showSnapshots, version])

  useEffect(() => {
    if (!modal.open) return
    setName('')
    setBusy(false)
    ensureMcVersionList().catch(() => {})
  }, [modal.open])

  useEffect(() => {
    if (!modal.open) return
    void load()
  }, [modal.open, profile, version, loader, load])

  if (!modal.open) return null
  const close = () => closeModal('mgModal')
  const target = name.trim() || (plan ? plan.suggested_name : '')

  const start = () => {
    if (!plan || busy) return
    setBusy(true)
    const started = runInstall({
      key: keyMigrate(profile),
      title: target || profile,
      run: () => migrateProfile(profile, version, loader, null, name.trim() || null),
      onDone: (res) => {
        setBusy(false)
        close()
        useProfiles.getState().setSelected(res.profile.name)
        void useProfiles.getState().refresh()
        if (res.failed.length) {
          showToast(
            'Сборка «' + res.profile.name + '»: перенесли ' + res.moved + ', не нашли ' + res.failed.length + ' — их придётся подобрать вручную',
          )
        } else {
          showToast('Сборка «' + res.profile.name + '» готова: перенесли модов — ' + res.moved, 'ok', 'achievement')
        }
      },
      onError: (e) => {
        setBusy(false)
        showToast('Перенести не вышло: ' + e, 'error')
      },
    })
    if (!started) setBusy(false)
  }

  return (
    <div
      id="mgModal"
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      {...backdropClose(close)}
    >
      <div className="modal mw-lg" style={{ maxHeight: '88%' }}>
        <h3>Перенос сборки на другую версию</h3>
        <div className="sub">
          Соберём копию «{profile}» под другую версию Minecraft: миры, конфиги и настройки скопируем, а каждому моду
          подберём файл под новую версию. Исходная сборка останется как есть.
        </div>
        <div style={{ display: 'flex', gap: '12px', margin: '16px 0 6px', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px', margin: 0 }}>
            <label>Новая версия Minecraft</label>
            <Select width="100%" value={version} options={verOpts} onChange={(v) => set({ version: v })} />
          </div>
          <div className="field" style={{ flex: '1 1 260px', margin: 0 }}>
            <label>Название новой сборки</label>
            <div className="input">
              <input
                id="mgName"
                placeholder={plan ? plan.suggested_name : profile + ' ' + version}
                maxLength={BUILD_NAME_MAX}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="field" style={{ marginTop: '12px' }}>
          <label>Загрузчик</label>
          <div className="segs">
            {LOADERS.map(([k, label]) => (
              <button
                key={k}
                className={'seg' + (loader === k ? ' on' : '')}
                data-mgl={k}
                onClick={() => set({ loader: k })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ maxHeight: '40vh', overflow: 'auto', margin: '14px 0' }}>
          {loading ? (
            <PlanSkeleton />
          ) : error ? (
            <p className="faint-note">Не удалось проверить моды: {error}</p>
          ) : plan ? (
            <>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <span className="pill acc">переедут: {plan.ready}</span>
                {plan.missing ? <span className="pill">без версии: {plan.missing}</span> : null}
                {plan.unlinked.length ? <span className="pill">свои файлы: {plan.unlinked.length}</span> : null}
              </div>
              {plan.items.map((it) => (
                <div key={it.file_name} className="mod-line">
                  <span
                    style={{
                      display: 'grid',
                      placeItems: 'center',
                      width: '18px',
                      height: '18px',
                      flex: 'none',
                      color: it.ok ? 'var(--m-accent)' : 'var(--m-fg-faint)',
                    }}
                  >
                    <Icon id={it.ok ? 'i-check' : 'i-alert'} />
                  </span>
                  <b>{it.title}</b>
                  {it.ok ? (
                    <span className="pill">{it.version_number || version}</span>
                  ) : (
                    <span style={{ fontSize: '12px', color: 'var(--m-fg-subtle)' }}>{it.note}</span>
                  )}
                </div>
              ))}
              {plan.unlinked.length ? (
                <p className="faint-note" style={{ marginTop: '10px' }}>
                  Останутся в старой сборке — эти файлы не из каталога, подходящую версию для них взять неоткуда:{' '}
                  {plan.unlinked.join(', ')}
                </p>
              ) : null}
              {!plan.items.length && !plan.unlinked.length ? (
                <p className="faint-note">В сборке нет модов — переедут миры, конфиги и ресурспаки.</p>
              ) : null}
            </>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button className="btn md secondary" id="mgCancel" data-sound="close" onClick={close}>
            Отмена
          </button>
          <button className="btn md primary" id="mgGo" disabled={loading || busy || !plan} onClick={start}>
            {busy ? 'Переносим…' : 'Перенести'}
          </button>
        </div>
      </div>
    </div>
  )
}
