import { useState } from 'react'
import { CatalogRow } from './catalog/CatalogRow'
import { PackKeyModal } from './PackKeyModal'
import { hasTauri } from '../ipc/tauri'
import {
  PACK_ACCESS_PREFIX,
  cfInstallModpack,
  cfInstallWorld,
  installCatalogPack,
  installModpack,
  installModpackVersion,
  installPackCandidate,
} from '../ipc/commands'
import { catalogInstallTracker, installContentFlow, resolveTargetBuild } from '../lib/install'
import { keyCatalogPack, keyCfModpack, keyContent, keyMillida, keyMillidaModpack, keyMrModpack, pickTargetName } from '../lib/installKeys'
import { installFromCatalog } from '../lib/catalogInstall'
import { runInstall, useInstalls } from '../state/installs'
import { trackTimed } from '../lib/telemetry'
import { useProfiles } from '../state/profiles'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import { useMods } from '../state/mods'
import { isInstalledInBuild } from '../lib/catalogInstalled'
import type { ModHit } from '../state/mods'
import { openCfProject, openMillidaProject, openProject } from '../state/project'
import { DEMO_USER } from '../lib/demo'
import { loadPackView } from './premium/packView'
import { modpackVersionFor } from '../lib/modpackVersion'
import { t, useT } from '../i18n'

/** Версия сборки на проверке — одна установка для строки каталога и страницы сборки. */
export function installReviewCandidate(slug: string, title: string, version: string) {
  runInstall({
    // Ключ тот же, что у обычной установки: события прогресса ядро шлёт
    // по адресу сборки, и свой ключ оставил бы полоску неподвижной.
    key: keyCatalogPack(slug),
    title: title + ' ' + version,
    running: t('Скачивание…'),
    run: () => installPackCandidate(slug),
    onError: (e) => showToast(String(e), 'error'),
    onDone: (p) => {
      useProfiles.getState().setSelected(p.name)
      void useProfiles.getState().refresh()
      showToast(t('Версия на проверке установлена — запусти её, и мы запишем результат'), 'ok')
    },
  })
}

/**
 * Всё, что делает вещь каталога: подпись и состояние главной кнопки, установка
 * из нужного источника, открытие карточки и окно ключа платной сборки. Одно на
 * строку и на плитку — иначе они разошлись бы в том, что считать «установлено».
 */
export function useModAction(h: ModHit, game?: string | null, kind?: string) {
  // Вид берётся у карточки, когда он известен: в ленте «Все» каталога рядом
  // стоят мод, шейдер и карта, и общий modTab положил бы шейдер в папку модов.
  const t = useT()
  const storeTab = useMods((s) => s.modTab)
  const modTab = kind || storeTab
  const installedIds = useMods((s) => s.installedIds)
  const installed = isInstalledInBuild(h, installedIds)
  // The same build the install itself will use, so a finished install shows on
  // this very row instead of under a key nobody reads.
  const scoped = useMods((s) => s.targetBuild)
  const profiles = useProfiles((s) => s.profiles)
  const selected = useProfiles((s) => s.selected)
  const target = pickTargetName(scoped, profiles.map((p) => p.name), selected || '')
  const key = h.packSlug
    ? keyCatalogPack(h.packSlug)
    : h.section
      ? modTab === 'modpack'
        ? keyMillidaModpack(h.slug || '')
        : keyMillida(target || '', modTab, h.slug || '')
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
  const idle = done ? t('Установлено') : modTab === 'modpack' || h.packSlug ? t('Установить') : t('Добавить')
  const running = task && task.state === 'run'
  const text = running ? (task.pct > 0 ? task.label + ' ' + Math.round(task.pct) + '%' : task.label) : idle

  const installWorld = (prof: string, force: boolean): void => {
    const startedAt = performance.now()
    const installed = catalogInstallTracker('world', h.cfid, 'maps')
    runInstall({
      key: keyContent('cf', prof, 'world', h.cfid!),
      title: h.title || String(h.cfid),
      running: force ? t('Ставим всё равно…') : t('Скачивание…'),
      run: () => cfInstallWorld(h.cfid!, prof, force),
      keepOpen: (r) => !r.folder,
      onDone: (r) => {
        if (!r.folder) {
          const pr = useProfiles.getState().profiles.find((x) => x.name === prof)
          void uiConfirm(
            t('Карта «{map}» рассчитана на {wanted}, а у сборки «{pack}» версия {version}. Мир может не открыться или сломаться. Поставить всё равно?', {
              map: h.title,
              wanted: r.mismatch || t('другие версии'),
              pack: prof,
              version: (pr && pr.version) || '—',
            }),
            { title: t('Версия не совпадает'), confirmLabel: t('Поставить'), danger: false },
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
        showToast(t('Карта «{map}» → «{pack}»: заходи в одиночную игру', { map: r.folder ?? '', pack: prof }), 'ok', 'install')
      },
    })
  }

  /// Нажатие на «Установлено» раньше молча качало файл заново: состояние не
  /// менялось, и выглядело это как сломанная кнопка. Теперь оно объясняет себя.
  const sayInstalled = (): boolean => {
    if (!done) return false
    showToast(
      modTab === 'modpack'
        ? t('Сборка уже установлена — открой карточку, чтобы выбрать другую версию')
        : target
          ? t('Уже в сборке «{pack}» — версию можно сменить в карточке', { pack: target })
          : t('Уже в сборке — версию можно сменить в карточке'),
      'ok',
      false,
    )
    return true
  }

  const onCf = () => {
    if (sayInstalled()) return
    if (!hasTauri()) {
      showToast(t('CurseForge доступен в приложении'))
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
          showToast(t('Сборка «{name}» готова — жми «Играть»', { name: p.name }), 'ok', 'achievement')
        },
      })
      return
    }
    void installContentFlow({ source: 'curseforge', cfid: h.cfid }, modTab, h.title)
  }

  const onInst = () => {
    if (sayInstalled()) return
    // Своя сборка ставится своим путём: у неё есть право доступа, свой архив и
    // свой запуск, и ни Modrinth, ни CurseForge про неё ничего не знают. Первой:
    // во «Покупках» сборка стоит рядом с модами, и вкладка каталога её не опишет.
    if (h.packSlug && hasTauri()) {
      startPackInstall()
      return
    }
    if (h.section && h.slug) {
      void installFromCatalog(h.section, h.slug)
      return
    }
    if (h.slug && hasTauri() && ['mod', 'resourcepack', 'datapack', 'shader'].includes(modTab)) {
      void installContentFlow({ source: 'modrinth', slug: h.slug }, modTab, h.title)
      return
    }
    // Демо в браузере (dev, ?preview=user): ставить нечем, поэтому платная
    // сборка сразу показывает то, что увидит человек без доступа, — баннер.
    if (h.packSlug && DEMO_USER) {
      void loadPackView(h.packSlug)
        .then((v) => (v && v.accessRequired ? setKeyFor('') : showToast(t('Установка доступна в приложении'))))
        .catch(() => showToast(t('Установка доступна в приложении')))
      return
    }
    if (h.slug && hasTauri() && modTab === 'modpack') {
      const modpackStartedAt = performance.now()
      const installed = catalogInstallTracker('modpack', h.slug, 'modpacks')
      runInstall({
        key: keyMrModpack(h.slug),
        title: h.title || h.slug,
        running: t('Скачивание…'),
        run: () => (game ? modpackVersionFor(h.slug!, game).then((id) => installModpackVersion(h.slug!, id)) : installModpack(h.slug!)),
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
          showToast(t('Сборка «{name}» готова к запуску', { name: p.name }), 'ok', 'achievement')
        },
      })
      return
    }
    showToast(t('Установка доступна в приложении'))
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
      running: t('Скачивание…'),
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
        showToast(t('Сборка «{name}» готова к запуску', { name: p.name }), 'ok', 'achievement')
      },
    })
  }

  const startCandidateInstall = () => {
    if (!h.packSlug || !h.packCandidate) return
    installReviewCandidate(h.packSlug, h.title || h.packSlug, h.packCandidate.version)
  }

  const onRow = (e: React.MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (h.section && h.slug) {
      void openMillidaProject(h.slug, h.section, modTab, h.title)
      return
    }
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
  const t = useT()
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
          {t('Проверить {version}', { version: h.packCandidate.version })}
        </button>
      ) : null}
    </>
  )
}
