import { CatalogRow } from './catalog/CatalogRow'
import { PackKeyModal } from './PackKeyModal'
import { hasTauri } from '../ipc/tauri'
import {
  PACK_ACCESS_PREFIX,
  cfInstallModpack,
  cfInstallWorld,
  installCatalogPack,
  installModpack,
  installPackCandidate,
} from '../ipc/commands'
import { catalogInstallTracker, installContentFlow, resolveTargetBuild } from '../lib/install'
import { keyCatalogPack, keyCfModpack, keyContent, keyMrModpack, pickTargetName } from '../lib/installKeys'
import { runInstall, useInstalls } from '../state/installs'
import { trackTimed } from '../lib/telemetry'
import { useProfiles } from '../state/profiles'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import { useState } from 'react'
import { useMods } from '../state/mods'
import type { ModHit } from '../state/mods'
import { openCfProject, openProject } from '../state/project'
import { DEMO_USER } from '../lib/demo'
import { loadPackView } from './premium/packView'

/**
 * Всё, что делает вещь каталога: подпись и состояние главной кнопки, установка
 * из нужного источника, открытие карточки и окно ключа платной сборки. Одно на
 * строку и на плитку — иначе они разошлись бы в том, что считать «установлено».
 */
export function useModAction(h: ModHit) {
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
    h.packSlug
      ? keyCatalogPack(h.packSlug)
      : h.cfid !== undefined
        ? modTab === 'modpack'
          ? keyCfModpack(h.cfid)
          : keyContent('cf', target || '', modTab, h.cfid)
        : modTab === 'modpack'
          ? keyMrModpack(h.slug || '')
          : keyContent('mr', target || '', modTab, h.slug || '')
  const task = useInstalls((s) => s.tasks[key])
  const doneKeys = useInstalls((s) => s.done)
  const done = installed || !!doneKeys[key]
  // Сборку ставят, а не добавляют: «Добавить» — про мод, который кладут в
  // существующую сборку, и на готовой сборке читается как другое действие.
  const idle = done ? 'Установлено' : modTab === 'modpack' || h.packSlug ? 'Установить' : 'Добавить'
  const running = task && task.state === 'run'
  const text = running ? (task.pct > 0 ? task.label + ' ' + Math.round(task.pct) + '%' : task.label) : idle

  const installWorld = (prof: string, force: boolean): void => {
    const startedAt = performance.now()
    const installed = catalogInstallTracker('world', h.cfid, 'maps')
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
        installed()
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
        ? 'Сборка уже установлена — открой карточку, чтобы выбрать другую версию'
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
      const installed = catalogInstallTracker('modpack', h.cfid, 'modpacks')
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
          installed()
          useProfiles.getState().setSelected(p.name)
          void useProfiles.getState().refresh()
          showToast('Сборка «' + p.name + '» готова — жми «Играть»', 'ok', 'achievement')
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
    // Своя сборка ставится своим путём: у неё есть право доступа, свой архив и
    // свой запуск, и ни Modrinth, ни CurseForge про неё ничего не знают.
    if (h.packSlug && hasTauri()) {
      startPackInstall()
      return
    }
    // Демо в браузере (dev, ?preview=user): ставить нечем, поэтому платная
    // сборка сразу показывает то, что увидит человек без доступа, — баннер.
    if (h.packSlug && DEMO_USER) {
      void loadPackView(h.packSlug)
        .then((v) => (v && v.accessRequired ? setKeyFor('') : showToast('Установка доступна в приложении')))
        .catch(() => showToast('Установка доступна в приложении'))
      return
    }
    if (h.slug && hasTauri() && modTab === 'modpack') {
      const modpackStartedAt = performance.now()
      const installed = catalogInstallTracker('modpack', h.slug, 'modpacks')
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
          installed()
          useProfiles.getState().setSelected(p.name)
          void useProfiles.getState().refresh()
          showToast('Сборка «' + p.name + '» готова к запуску', 'ok', 'achievement')
        },
      })
      return
    }
    showToast('Установка доступна в приложении')
  }

  const [keyFor, setKeyFor] = useState<string | null>(null)

  // Установка своей сборки. Вынесена отдельно, потому что к ней возвращаются:
  // платная упирается в доступ, и после активации ключа установку нужно
  // продолжить тем же путём, а не просить человека нажать кнопку заново.
  const startPackInstall = () => {
    if (!h.packSlug) return
    const startedAt = performance.now()
    const installed = catalogInstallTracker(h.packPaid ? 'premium' : 'modpack', h.packSlug, 'modpacks')
    runInstall({
      key: keyCatalogPack(h.packSlug),
      title: h.title || h.packSlug,
      running: 'Скачивание…',
      run: () => installCatalogPack(h.packSlug!),
      onError: (e) => {
        const text = String(e)
        if (text.startsWith(PACK_ACCESS_PREFIX)) {
          setKeyFor(text.slice(PACK_ACCESS_PREFIX.length))
          return
        }
        showToast(text, 'error')
      },
      onDone: (p) => {
        trackTimed('modpack_install', startedAt, {
          name: h.packSlug!,
          kind: 'modpack',
          mc: p.version,
          loader: p.loader || (p.fabric ? 'fabric' : 'vanilla'),
          source: 'millida',
        })
        installed()
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        showToast('Сборка «' + p.name + '» готова к запуску', 'ok', 'achievement')
      },
    })
  }

  const startCandidateInstall = () => {
    if (!h.packSlug || !h.packCandidate) return
    runInstall({
      // Ключ тот же, что у обычной установки: события прогресса ядро шлёт
      // по адресу сборки, и свой ключ оставил бы полоску неподвижной.
      key: keyCatalogPack(h.packSlug),
      title: (h.title || h.packSlug) + ' ' + h.packCandidate.version,
      running: 'Скачивание…',
      run: () => installPackCandidate(h.packSlug!),
      onError: (e) => showToast(String(e), 'error'),
      onDone: (p) => {
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        showToast('Версия на проверке установлена — запусти её, и мы запишем результат', 'ok')
      },
    })
  }

  const onRow = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (h.cfid !== undefined) {
      void openCfProject(h.cfid, modTab, h.title)
      return
    }
    // Своя сборка не живёт на Modrinth: открытая по её адресу карточка чужого
    // каталога показывала «Не удалось загрузить» и кнопку «Открыть на Modrinth».
    if (h.packSlug) return
    if (h.slug) void openProject(h.slug, modTab)
  }

  const modal =
    keyFor !== null ? (
      <PackKeyModal
        slug={h.packSlug || ''}
        title={h.title}
        reason={keyFor}
        onClose={() => setKeyFor(null)}
        onUnlocked={startPackInstall}
      />
    ) : null

  return {
    modTab,
    text,
    done,
    running: !!running,
    onClick: h.cfid !== undefined ? onCf : onInst,
    onOpen: onRow,
    modal,
    candidate: h.packSlug && h.packCandidate ? startCandidateInstall : undefined,
  }
}

export function ModRow({ h }: { h: ModHit }) {
  const a = useModAction(h)
  return (
    <>
      {a.modal}
      <CatalogRow
        icon={h.icon}
        title={h.title}
        author={h.author}
        desc={h.desc}
        downloads={h.dl}
        onOpen={a.onOpen}
        action={{ label: a.text, done: a.done, onClick: a.onClick }}
      />
      {a.candidate && h.packCandidate ? (
        // Версия на проверке — только у проверяющих (ветка main, ef1c98f).
        <button className="btn sm secondary" onClick={a.candidate}>
          Проверить {h.packCandidate.version}
        </button>
      ) : null}
    </>
  )
}
