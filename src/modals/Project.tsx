import { Icon } from '../components/Icon'
import { hasTauri } from '../ipc/tauri'
import {
  cfInstall,
  cfInstallModpack,
  cfInstallWorld,
  installModpack,
  installModpackVersion,
  installVersion,
  openUrl,
} from '../ipc/commands'
import { RU_LOADER, fmtSize } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import {
  askPlanForVersion,
  installContentFlow,
  installExtras,
  resolveTargetBuild,
  runPickedVersionInstall,
} from '../lib/install'
import { keyCfModpack, keyContent, keyMrModpack, pickTargetName } from '../lib/installKeys'
import { runInstall, stopInstall, useInstalls } from '../state/installs'
import { trackTimed } from '../lib/telemetry'
import { uiConfirm } from '../state/confirm'
import { useProfiles } from '../state/profiles'
import { useProject } from '../state/project'
import { catalogTargetBuild, useMods } from '../state/mods'
import type { ProjectVersion } from '../state/project'
import { closeModal, showToast, useUi } from '../state/ui'
import { backdropClose } from '../lib/dismiss'
import { mirrorAsset } from '../lib/api'


export function ProjectModal() {
  const modal = useUi((s) => s.modals.pjModal)
  const pj = useProject()
  const tasks = useInstalls((s) => s.tasks)
  const doneKeys = useInstalls((s) => s.done)
  const doneVersion = useInstalls((s) => s.doneVersion)
  // The build this window reports about is the build the install writes into:
  // asking about one and installing into another left the button saying
  // «Установлено» while every press downloaded the mod again.
  const scoped = useMods((s) => s.targetBuild)
  const allProfiles = useProfiles((s) => s.profiles)
  const selected = useProfiles((s) => s.selected)
  const selectedBuild = pickTargetName(scoped, allProfiles.map((p) => p.name), selected || '')
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
  /// «Установлено» — это состояние, а не кнопка: повторное нажатие качало тот же
  /// файл заново и ничего не меняло на экране. Сменить версию можно во вкладке
  /// «Версии», об этом и говорим.
  const alreadyDone = (key: string): boolean => {
    if (!doneKeys[key]) return false
    showToast(
      pj.kind === 'modpack'
        ? 'Модпак уже установлен — во вкладке «Версии» можно поставить другую версию'
        : 'Уже в сборке' + (selectedBuild ? ' «' + selectedBuild + '»' : '') +
          ' — другую версию можно выбрать во вкладке «Версии»',
      'ok',
      false,
    )
    return true
  }
  // The install task key covers the whole project (backend refuses two
  // concurrent jobs writing into the same profile slot), so a single running
  // or finished task must not paint every version row as if it were the one
  // in progress — only the row for the version that task actually targets.
  const versionLabel = (key: string, versionId: string, idle: string): string => {
    const t = tasks[key]
    if (t && t.state === 'run') {
      if (t.versionId !== versionId) return idle
      return t.pct > 0 ? t.label + ' ' + Math.round(t.pct) + '%' : t.label
    }
    return doneVersion[key] === versionId ? 'Установлено' : idle
  }

  if (!modal.open) return null
  const close = () => closeModal('pjModal')
  const task = tasks[packKey]
  const running = !!task && task.state === 'run'

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

  const installPack = (fileId?: number, mrVersionId?: string) => {
    const startedAt = performance.now()
    runInstall({
      key: packKey,
      title: pj.title || pj.slug,
      running: 'Скачивание…',
      versionId: isCf ? (fileId !== undefined ? 'cf' + fileId : undefined) : mrVersionId,
      run: () =>
        isCf
          ? cfInstallModpack(pj.cfid, fileId)
          : mrVersionId
            ? installModpackVersion(pj.slug, mrVersionId)
            : installModpack(pj.slug),
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
    if (fileId === undefined && alreadyDone(packKey)) return
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
      void installContentFlow({ source: 'modrinth', slug: pj.slug }, pj.kind, pj.title)
      return
    }
    if (fileId === undefined) {
      void installContentFlow({ source: 'curseforge', cfid: pj.cfid }, pj.kind, pj.title)
      return
    }
    // a file picked by hand in the versions tab installs as picked
    void resolveTargetBuild(pj.kind).then(async (prof) => {
      if (!prof) return
      const extras = await askPlanForVersion(prof, pj.kind, 'curseforge', String(pj.cfid), String(fileId))
      if (!extras) return
      const pr = useProfiles.getState().profiles.find((x) => x.name === prof)
      runPickedVersionInstall({
        key: keyContent('cf', prof, pj.kind, pj.cfid),
        title: pj.title,
        prof,
        versionId: 'cf' + fileId,
        run: (allowMismatch) =>
          cfInstall(pj.cfid, (pr && pr.version) || '', prof, pj.kind, fileId, allowMismatch),
        onInstalled: (r) => {
          void useMods.getState().refreshInstalled()
          installExtras(prof, pj.kind, extras)
          showToast('CurseForge → «' + prof + '»: ' + r.file, 'ok', 'install')
        },
      })
    })
  }

  const installVer = (v: ProjectVersion) => {
    if (!hasTauri()) {
      showToast('Доступно в приложении')
      return
    }
    // Ставить другую версию поверх — обычное дело; ту же самую — уже стоит.
    if (doneVersion[packKey] === v.id) {
      showToast('Эта версия уже стоит' + (selectedBuild ? ' в «' + selectedBuild + '»' : ''), 'ok', false)
      return
    }
    if (isCf) {
      install(v.cfFileId)
      return
    }
    if (pj.kind === 'modpack') {
      installPack(undefined, v.id)
      return
    }
    const prof = catalogTargetBuild() || (useProfiles.getState().profiles[0] || { name: '' }).name || 'default'
    void askPlanForVersion(prof, pj.kind, 'modrinth', pj.slug, v.id).then((extras) => {
      if (!extras) return
      runPickedVersionInstall({
        key: keyContent('mr', prof, pj.kind, pj.slug),
        title: pj.title || pj.slug,
        prof,
        versionId: v.id,
        run: (allowMismatch) => installVersion(pj.slug, v.id, prof, pj.kind, allowMismatch),
        onInstalled: (r) => {
          void useMods.getState().refreshInstalled()
          installExtras(prof, pj.kind, extras)
          showToast('В «' + prof + '»: ' + r.file + (r.warning ? ' · ' + r.warning : ''), 'ok', 'install')
        },
      })
    })
  }

  return (
    <div
      className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')}
      id="pjModal"
      {...backdropClose(close)}
    >
      <div className="modal mw-xl" style={{ maxHeight: '88%' }}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '14px' }}>
          <img
            id="pjIcon"
            src={mirrorAsset(pj.icon) || undefined}
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
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn md primary" id="pjInstall" onClick={() => install()}>
              {label(packKey, pj.kind === 'modpack' ? 'Установить' : 'Добавить в сборку')}
            </button>
            {/* Отменить установку можно было только из панели загрузок, а её
                закрывает это же окно — игрок оставался с бегущим процентом. */}
            {running ? (
              <button className="btn md ghost" title="Отменить установку" onClick={() => stopInstall(packKey)}>
                <Icon id="i-x" />
              </button>
            ) : null}
          </div>
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
        <div id="pjDesc" className="pj-body pj-pane" style={{ display: pj.tab === 'desc' ? '' : 'none' }}>
          {pj.loading ? (
            <p className="faint-note">Загружаем описание…</p>
          ) : pj.body ? (
            renderMarkdown(pj.body)
          ) : (
            <p className="faint-note">Без описания</p>
          )}
        </div>
        <div id="pjGallery" className="pj-pane" style={{ display: pj.tab === 'gallery' ? '' : 'none' }}>
          {pj.gallery.length ? (
            pj.gallery.map((x, i) => (
              <figure style={{ marginBottom: '12px' }} key={i}>
                <img src={mirrorAsset(x.url)} style={{ width: '100%', borderRadius: '12px' }} loading="lazy" />
                <figcaption style={{ fontSize: '12px', color: 'var(--m-fg-subtle)', marginTop: '6px' }}>
                  {x.title || ''}
                </figcaption>
              </figure>
            ))
          ) : (
            <p className="faint-note">Галереи нет</p>
          )}
        </div>
        <div id="pjVersions" className="pj-pane" style={{ display: pj.tab === 'versions' ? '' : 'none' }}>
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
                  {versionLabel(packKey, v.id, 'Установить')}
                </button>
                {running && task.versionId === v.id ? (
                  <button className="btn sm ghost" title="Отменить установку" onClick={() => stopInstall(packKey)}>
                    <Icon id="i-x" />
                  </button>
                ) : null}
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
