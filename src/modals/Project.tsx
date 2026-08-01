import { hasTauri } from '../ipc/tauri'
import { cfInstall, cfInstallModpack, cfInstallWorld, installModpack, installVersion, openUrl } from '../ipc/commands'
import { RU_LOADER, fmtSize } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import { installContentFlow, resolveTargetBuild } from '../lib/install'
import { keyCfModpack, keyContent, keyMrModpack } from '../lib/installKeys'
import { runInstall, useInstalls } from '../state/installs'
import { trackTimed } from '../lib/telemetry'
import { uiConfirm } from '../state/confirm'
import { useProfiles } from '../state/profiles'
import { useProject } from '../state/project'
import type { ProjectVersion } from '../state/project'
import { closeModal, showToast, useUi } from '../state/ui'

const PANE_STYLE = { maxHeight: '340px', overflowY: 'auto' as const }

export function ProjectModal() {
  const modal = useUi((s) => s.modals.pjModal)
  const pj = useProject()
  const tasks = useInstalls((s) => s.tasks)
  const doneKeys = useInstalls((s) => s.done)
  const selectedBuild = useProfiles((s) => s.selected)
  const isCf = pj.source === 'curseforge'
  const src = isCf ? 'cf' : 'mr'
  const project: string | number = isCf ? pj.cfid : pj.slug
  const packKey =
    pj.kind === 'modpack'
      ? isCf
        ? keyCfModpack(pj.cfid)
        : keyMrModpack(pj.slug)
      : keyContent(src, selectedBuild || '', pj.kind, project)
  const label = (key: string, idle: string): string => {
    const t = tasks[key]
    if (t && t.state === 'run') return t.pct > 0 ? t.label + ' ' + Math.round(t.pct) + '%' : t.label
    return doneKeys[key] ? 'Установлено' : idle
  }

  if (!modal.open) return null
  const close = () => closeModal('pjModal')

  const installWorld = (prof: string, force: boolean): void => {
    runInstall({
      key: keyContent('cf', prof, 'world', pj.cfid),
      title: pj.title,
      running: force ? 'Ставим всё равно…' : 'Скачивание…',
      run: () => cfInstallWorld(pj.cfid, prof, force),
      keepOpen: (r) => !r.folder,
      onDone: (r) => {
        if (!r.folder) {
          const pr = useProfiles.getState().profiles.find((x) => x.name === prof)
          void uiConfirm(
            'Карта «' +
              pj.title +
              '» рассчитана на ' +
              (r.mismatch || 'другие версии') +
              ', а у сборки «' +
              prof +
              '» версия ' +
              ((pr && pr.version) || '—') +
              '. Мир может не открыться или сломаться. Поставить всё равно?',
            { title: 'Версия не совпадает', confirmLabel: 'Поставить', danger: false },
          ).then((ok) => {
            if (ok) installWorld(prof, true)
          })
          return
        }
        showToast('Карта «' + r.folder + '» → «' + prof + '»: заходи в одиночную игру', 'ok', 'install')
      },
    })
  }

  const installPack = (fileId?: number) => {
    const startedAt = performance.now()
    runInstall({
      key: packKey,
      title: pj.title || pj.slug,
      running: 'Скачивание…',
      run: () => (isCf ? cfInstallModpack(pj.cfid, fileId) : installModpack(pj.slug)),
      onDone: (p) => {
        trackTimed('modpack_install', startedAt, {
          name: pj.title || pj.slug,
          kind: 'modpack',
          mc: p.version,
          loader: p.loader || (p.fabric ? 'fabric' : 'vanilla'),
          source: isCf ? 'curseforge' : 'modrinth',
        })
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        showToast('Сборка «' + p.name + '» готова — жми «Играть»', 'ok', 'achievement')
      },
      onError: (err) => {
        trackTimed(
          'modpack_install',
          startedAt,
          {
            name: pj.title || pj.slug,
            kind: 'modpack',
            source: isCf ? 'curseforge' : 'modrinth',
            code: String(err).slice(0, 120),
          },
          false,
        )
        showToast('' + err, 'error')
      },
    })
  }

  // fileId pins a concrete CurseForge file; Modrinth uses its own version id.
  const install = (fileId?: number) => {
    if (!hasTauri()) {
      showToast('Установка доступна в приложении')
      return
    }
    if (pj.kind === 'modpack') {
      installPack(fileId)
      return
    }
    if (pj.kind === 'world') {
      void resolveTargetBuild('world').then((prof) => {
        if (prof) installWorld(prof, false)
      })
      return
    }
    if (!isCf) {
      void installContentFlow(pj.slug, pj.kind, pj.title)
      return
    }
    void resolveTargetBuild(pj.kind).then((prof) => {
      if (!prof) return
      const pr = useProfiles.getState().profiles.find((x) => x.name === prof)
      runInstall({
        key: keyContent('cf', prof, pj.kind, pj.cfid),
        title: pj.title,
        running: 'Скачивание…',
        run: () => cfInstall(pj.cfid, (pr && pr.version) || '', prof, pj.kind, fileId),
        onDone: (f) => showToast('CurseForge → «' + prof + '»: ' + f, 'ok', 'install'),
      })
    })
  }

  const installVer = (v: ProjectVersion) => {
    if (!hasTauri()) {
      showToast('Доступно в приложении')
      return
    }
    if (isCf) {
      install(v.cfFileId)
      return
    }
    if (pj.kind === 'modpack') {
      installPack()
      return
    }
    const { selected, profiles } = useProfiles.getState()
    const prof = selected || (profiles[0] || { name: '' }).name || 'default'
    runInstall({
      key: keyContent('mr', prof, pj.kind, pj.slug),
      title: pj.title || pj.slug,
      running: 'Скачивание…',
      run: () => installVersion(pj.slug, v.id, prof, pj.kind),
      onDone: (f) => showToast('В «' + prof + '»: ' + f, 'ok', 'install'),
    })
  }

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="pjModal"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal" style={{ width: '760px', maxHeight: '88%' }}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '14px' }}>
          <img
            id="pjIcon"
            src={pj.icon || undefined}
            style={{ width: '64px', height: '64px', borderRadius: '12px', objectFit: 'cover', background: 'var(--m-inset)' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 id="pjTitle">{pj.title}</h3>
            <div className="sub" id="pjSub" style={{ marginBottom: 0 }}>
              {pj.sub}
            </div>
            <div id="pjTags" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
              <span className="pill">{isCf ? 'CurseForge' : 'Modrinth'}</span>
              {pj.tags.map((c) => (
                <span className="pill" key={c}>
                  {RU_LOADER(c)}
                </span>
              ))}
            </div>
          </div>
          <button className="btn md primary" id="pjInstall" onClick={() => install()}>
            {label(packKey, pj.kind === 'modpack' ? 'Установить' : 'Добавить в сборку')}
          </button>
        </div>
        <div className="segs" style={{ marginBottom: '14px' }}>
          {[
            ['desc', 'Описание'],
            ['gallery', 'Галерея'],
            ['versions', 'Версии'],
          ].map(([k, text]) => (
            <button
              key={k}
              className={'seg' + (pj.tab === k ? ' on' : '')}
              data-pjtab={k}
              onClick={() => pj.set({ tab: k })}
            >
              {text}
            </button>
          ))}
        </div>
        <div id="pjDesc" className="pj-body" style={{ ...PANE_STYLE, display: pj.tab === 'desc' ? '' : 'none' }}>
          {pj.loading ? (
            <p className="faint-note">Загружаем описание…</p>
          ) : pj.body ? (
            renderMarkdown(pj.body)
          ) : (
            <p className="faint-note">Без описания</p>
          )}
        </div>
        <div id="pjGallery" style={{ ...PANE_STYLE, display: pj.tab === 'gallery' ? '' : 'none' }}>
          {pj.gallery.length ? (
            pj.gallery.map((x, i) => (
              <figure style={{ marginBottom: '12px' }} key={i}>
                <img src={x.url} style={{ width: '100%', borderRadius: '12px' }} loading="lazy" />
                <figcaption style={{ fontSize: '12px', color: 'var(--m-fg-subtle)', marginTop: '6px' }}>
                  {x.title || ''}
                </figcaption>
              </figure>
            ))
          ) : (
            <p className="faint-note">Галереи нет</p>
          )}
        </div>
        <div id="pjVersions" style={{ ...PANE_STYLE, display: pj.tab === 'versions' ? '' : 'none' }}>
          {pj.versions.length ? (
            pj.versions.map((v) => (
              <div className="mod-line" key={v.id}>
                <b>{v.name}</b>
                {v.game_versions && v.game_versions.length ? (
                  <span className="pill" style={{ marginRight: '6px' }}>
                    {v.game_versions.slice(0, 2).join(', ')}
                  </span>
                ) : null}
                {v.loaders && v.loaders.length ? <span className="pill">{v.loaders.join(', ')}</span> : null}
                {v.size ? <span className="mod-ver">{fmtSize(v.size)}</span> : null}
                <button
                  className="btn sm secondary pj-ver"
                  data-vid={v.id}
                  style={{ marginLeft: '8px' }}
                  onClick={() => installVer(v)}
                >
                  {label(packKey, 'Установить')}
                </button>
              </div>
            ))
          ) : (
            <p className="faint-note">{pj.loading ? 'Загружаем версии…' : 'Версий нет'}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '10px', marginTop: '18px', justifyContent: 'space-between' }}>
          <button
            className="btn sm ghost"
            id="pjOpen"
            disabled={!pj.website}
            onClick={() => {
              if (!pj.website) return
              if (hasTauri()) openUrl(pj.website)
              else window.open(pj.website, '_blank')
            }}
          >
            {isCf ? 'Открыть на CurseForge' : 'Открыть на Modrinth'}
          </button>
          <button className="btn md secondary" id="pjClose" data-sound="close" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
