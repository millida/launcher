import { Icon } from './Icon'
import { fmt, RU_LOADER } from '../lib/format'
import { hasTauri } from '../ipc/tauri'
import { cfInstallModpack, cfInstallWorld, installModpack } from '../ipc/commands'
import { installContentFlow, resolveTargetBuild } from '../lib/install'
import { keyCfModpack, keyContent, keyMrModpack, pickTargetName } from '../lib/installKeys'
import { runInstall, useInstalls } from '../state/installs'
import { trackTimed } from '../lib/telemetry'
import { useProfiles } from '../state/profiles'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import { useMods } from '../state/mods'
import type { ModHit } from '../state/mods'
import { openCfProject, openProject } from '../state/project'

const DONE_STYLE = { background: 'var(--m-accent-soft)', color: 'var(--m-accent)' }

export function ModRow({ h }: { h: ModHit }) {
  const modTab = useMods((s) => s.modTab)
  const installedIds = useMods((s) => s.installedIds)
  const installed = !!(h.pid && installedIds.has(h.pid))
  // The same build the install itself will use, so a finished install shows on
  // this very row instead of under a key nobody reads.
  const scoped = useMods((s) => s.targetBuild)
  const profiles = useProfiles((s) => s.profiles)
  const selected = useProfiles((s) => s.selected)
  const target = pickTargetName(scoped, profiles.map((p) => p.name), selected || '')
  const key =
    h.cfid !== undefined
      ? modTab === 'modpack'
        ? keyCfModpack(h.cfid)
        : keyContent('cf', target || '', modTab, h.cfid)
      : modTab === 'modpack'
        ? keyMrModpack(h.slug || '')
        : keyContent('mr', target || '', modTab, h.slug || '')
  const task = useInstalls((s) => s.tasks[key])
  const doneKeys = useInstalls((s) => s.done)
  const done = installed || !!doneKeys[key]
  const idle = done ? 'Установлено' : modTab === 'modpack' ? 'Установить' : 'Добавить'
  const running = task && task.state === 'run'
  const text = running ? (task.pct > 0 ? task.label + ' ' + Math.round(task.pct) + '%' : task.label) : idle

  const installWorld = (prof: string, force: boolean): void => {
    const startedAt = performance.now()
    runInstall({
      key: keyContent('cf', prof, 'world', h.cfid!),
      title: h.title || String(h.cfid),
      running: force ? 'Ставим всё равно…' : 'Скачивание…',
      run: () => cfInstallWorld(h.cfid!, prof, force),
      keepOpen: (r) => !r.folder,
      onDone: (r) => {
        if (!r.folder) {
          const pr = useProfiles.getState().profiles.find((x) => x.name === prof)
          void uiConfirm(
            'Карта «' +
              h.title +
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
        trackTimed('content_install', startedAt, {
          name: h.title || String(h.cfid),
          kind: 'world',
          source: 'curseforge',
        })
        showToast('Карта «' + r.folder + '» → «' + prof + '»: заходи в одиночную игру', 'ok', 'install')
      },
    })
  }

  /// Нажатие на «Установлено» раньше молча качало файл заново: состояние не
  /// менялось, и выглядело это как сломанная кнопка. Теперь оно объясняет себя.
  const sayInstalled = (): boolean => {
    if (!done) return false
    showToast(
      modTab === 'modpack'
        ? 'Модпак уже установлен — открой карточку, чтобы выбрать другую версию'
        : 'Уже в сборке' + (target ? ' «' + target + '»' : '') + ' — версию можно сменить в карточке',
      'ok',
      false,
    )
    return true
  }

  const onCf = () => {
    if (sayInstalled()) return
    if (!hasTauri()) {
      showToast('CurseForge доступен в приложении')
      return
    }
    if (modTab === 'world') {
      void resolveTargetBuild('world').then((prof) => {
        if (!prof) return
        installWorld(prof, false)
      })
      return
    }
    if (modTab === 'modpack') {
      const cfStartedAt = performance.now()
      runInstall({
        key: keyCfModpack(h.cfid!),
        title: h.title || String(h.cfid),
        run: () => cfInstallModpack(h.cfid!),
        onDone: (p) => {
          trackTimed('modpack_install', cfStartedAt, {
            name: h.title || String(h.cfid),
            kind: 'modpack',
            mc: p.version,
            loader: p.loader || (p.fabric ? 'fabric' : 'vanilla'),
            source: 'curseforge',
          })
          useProfiles.getState().setSelected(p.name)
          void useProfiles.getState().refresh()
          showToast('Модпак «' + p.name + '» готов — жми «Играть»', 'ok', 'achievement')
        },
      })
      return
    }
    void installContentFlow({ source: 'curseforge', cfid: h.cfid }, modTab, h.title)
  }

  const onInst = () => {
    if (sayInstalled()) return
    if (h.slug && hasTauri() && ['mod', 'resourcepack', 'datapack', 'shader'].includes(modTab)) {
      void installContentFlow({ source: 'modrinth', slug: h.slug }, modTab, h.title)
      return
    }
    if (h.slug && hasTauri() && modTab === 'modpack') {
      const modpackStartedAt = performance.now()
      runInstall({
        key: keyMrModpack(h.slug),
        title: h.title || h.slug,
        running: 'Скачивание…',
        run: () => installModpack(h.slug!),
        onDone: (p) => {
          trackTimed('modpack_install', modpackStartedAt, {
            name: h.slug!,
            kind: 'modpack',
            mc: p.version,
            loader: p.loader || (p.fabric ? 'fabric' : 'vanilla'),
            source: 'modrinth',
          })
          useProfiles.getState().setSelected(p.name)
          void useProfiles.getState().refresh()
          showToast('Сборка «' + p.name + '» готова к запуску', 'ok', 'achievement')
        },
      })
      return
    }
    showToast('Установка доступна в приложении')
  }

  const onRow = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (h.cfid !== undefined) {
      void openCfProject(h.cfid, modTab, h.title)
      return
    }
    if (h.slug) void openProject(h.slug, modTab)
  }

  return (
    <div className="mod-row" data-cfweb={h.cfid !== undefined ? h.website || '' : undefined} onClick={onRow}>
      <span className="mod-icon">
        {h.icon ? (
          <img src={h.icon} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />
        ) : (
          <Icon id="i-box2" />
        )}
      </span>
      <span className="mod-body">
        <span className="mod-name">
          <b>{h.title}</b>
          <span>от {h.author}</span>
        </span>
        <span className="mod-desc">{h.desc || ''}</span>
        <span className="mod-meta">
          <b>{fmt(h.dl)}</b> скачиваний
          {h.cats && h.cats.length ? ' · ' + h.cats.map(RU_LOADER).join(' · ') : ''}
        </span>
      </span>
      {h.cfid !== undefined ? (
        <button
          className={'btn sm secondary cfinst' + (done ? ' done' : '')}
          data-cf={h.cfid}
          style={done ? DONE_STYLE : undefined}
          onClick={onCf}
        >
          {text}
        </button>
      ) : (
        <button
          className={'btn sm secondary inst' + (done ? ' done' : '')}
          data-slug={h.slug || ''}
          style={done ? DONE_STYLE : undefined}
          onClick={onInst}
        >
          {text}
        </button>
      )}
    </div>
  )
}
