import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { LOADER_NAME } from '../../lib/format'
import { deleteProfile, importInstance, importPackFile, openProfileFolder, scanImports, setProfileIcon } from '../../ipc/commands'
import { uiConfirm } from '../../state/confirm'
import { openBuildSettings } from '../../state/instance'
import { parseIcon } from '../../lib/buildIcon'
import type { CSSProperties } from 'react'
import type { FoundInstance, Profile } from '../../ipc/commands'
import { DEMO_USER } from '../../lib/demo'
import { track } from '../../lib/telemetry'
import { plural } from '../../lib/format'
import { presetName } from '../../lib/versionBuild'
import type { PopularVersion } from '../../lib/versionBuild'
import { hasTauri } from '../../ipc/tauri'
import { usePlayStats } from '../../state/playStats'
import { useProfiles } from '../../state/profiles'
import { openModal, showToast } from '../../state/ui'
import { DEFAULT_ICON } from '../../lib/buildIcon'
import { BuildIcon, IconPicker } from './BuildIcon'
import { hoursText } from './Hours'
import '../../styles/pixel/playhub.css'
import { trackImportFailure } from '../../lib/importTrack'

/**
 * «Мои сборки» — первой полкой «Во что играем» (правки владельца 23.09.2026,
 * 19:23 и 19:40). Карточка — квадратная иконка сборки на тёмной подложке,
 * как в Modrinth; наведение на иконку — «Изменить». Клик по карточке выбирает
 * сборку в лобби, «Играть» — сразу запуск. Первые две карточки полки —
 * «Новая сборка» и «Забрать всё», они есть и без единой сборки.
 */

/** Иконку сохраняем в данных сборки (поле `icon` профиля). */
export async function saveIcon(name: string, icon: string): Promise<void> {
  if (hasTauri()) {
    const list = await setProfileIcon(name, icon)
    if (Array.isArray(list)) useProfiles.setState({ profiles: list })
    else await useProfiles.getState().refresh()
    return
  }
  // Демо в браузере: ядра нет — меняем только список на экране.
  useProfiles.setState((s) => ({ profiles: s.profiles.map((p) => (p.name === name ? { ...p, icon } : p)) }))
}

/** Удалить свою сборку — с подтверждением; `after` — что сделать после удаления. */
export function removeBuild(name: string, after?: () => void) {
  void uiConfirm('Сборка «' + name + '» удалится с модами и мирами. Вернуть нельзя.', {
    title: 'Удалить сборку',
    confirmLabel: 'Удалить',
  }).then((ok) => {
    if (!ok) return
    if (!hasTauri()) {
      useProfiles.setState((s) => ({ profiles: s.profiles.filter((x) => x.name !== name) }))
      after?.()
      return
    }
    deleteProfile(name)
      .then(() => {
        if (useProfiles.getState().selected === name) useProfiles.getState().setSelected(null)
        void useProfiles.getState().refresh()
        showToast('Сборка удалена', 'ok', 'delete')
        after?.()
      })
      .catch((e) => {
        void useProfiles.getState().refresh()
        showToast('Не удалось удалить: ' + e, 'error')
      })
  })
}

/** Меню закрывается кликом мимо него и Escape. */
export function useMenuDismiss(open: boolean, close: () => void, keep: string) {
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (!t?.closest(keep)) close()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('pointerdown', off)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', off)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
}

/**
 * Пункты «⋯» своей сборки — одни на карточке и на странице сборки (правка
 * владельца 24.09.2026, 18:35: клик по карточке ведёт на страницу, изменения —
 * только через «⋯»).
 */
export function BuildMenuItems({
  name,
  onClose,
  onIcon,
  onRemoved,
  onTab,
}: {
  name: string
  onClose: () => void
  onIcon: () => void
  onRemoved?: () => void
  /** Страница сборки уже открыта — переключаем её вкладку, а не открываем заново. */
  onTab?: (tab: 'opts', rename: boolean) => void
}) {
  const go = (rename: boolean) => (onTab ? onTab('opts', rename) : openBuildSettings(name, 'opts', rename))
  return (
    <>
      <button role="menuitem" data-track="build_rename" onClick={() => (onClose(), go(true))}>
        <Icon id="i-mo-pencil" />
        Переименовать
      </button>
      <button role="menuitem" data-track="build_icon" onClick={() => (onClose(), onIcon())}>
        <Icon id="i-mo-image" />
        Иконка
      </button>
      <button role="menuitem" data-track="build_settings" onClick={() => (onClose(), go(false))}>
        <Icon id="i-mo-gear" />
        Настройки
      </button>
      {hasTauri() ? (
        <button role="menuitem" data-track="build_folder" onClick={() => (onClose(), void openProfileFolder(name).catch(() => {}))}>
          <Icon id="i-mo-folder" />
          Папка
        </button>
      ) : null}
      <button role="menuitem" className="danger" data-track="build_delete" onClick={() => (onClose(), removeBuild(name, onRemoved))}>
        <Icon id="i-mo-trash" />
        Удалить
      </button>
    </>
  )
}

/** Выбор иконки своей сборки — окно поверх всего. */
export function BuildIconPicker({ name, icon, onClose }: { name: string; icon?: string | null; onClose: () => void }) {
  return (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <IconPicker
        icon={icon || DEFAULT_ICON}
        onClose={onClose}
        onPick={(v) => void saveIcon(name, v).catch((e) => showToast('Иконка не сохранилась: ' + e, 'error'))}
      />
    </span>
  )
}

/**
 * Карточка своей сборки. Клик — страница сборки (иконка, «Играть», моды,
 * миры, скриншоты); изменения — только через «⋯» (правка владельца
 * 24.09.2026, 18:35: «клик должен переходить на страницу, а не сразу
 * предлагать изменения»).
 */
export function MyBuildCard({
  p,
  on,
  pos,
  onPick,
}: {
  p: Profile
  on: boolean
  /** Место карточки в ряду — для аналитики. */
  pos?: number
  onPick: () => void
  /** Запуск — только большой «Играть» в лобби (правка владельца 21:20). */
  onPlay?: () => void
}) {
  const seconds = usePlayStats((s) => s.stats.builds.find((b) => b.key === p.name)?.seconds || 0)
  const [edit, setEdit] = useState(false)
  const [menu, setMenu] = useState(false)
  useMenuDismiss(menu, () => setMenu(false), '.ph-mine-menu, .ph-mine-more')
  const art = parseIcon(p.icon)
  return (
    <div
      className={'ph-card ph-mine' + (on ? ' on' : '') + (menu ? ' menu-open' : '')}
      role="button"
      tabIndex={0}
      data-sound="open"
      data-track="build_open"
      data-kind="build"
      data-id={p.name}
      data-pos={pos}
      data-private
      onClick={onPick}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onPick()}
    >
      <span className="ph-card-art ph-mine-art" style={{ '--mine-bg': art.bg } as CSSProperties}>
        <button
          type="button"
          className="ph-mine-more"
          aria-label="Управление сборкой"
          data-track="build_menu"
          aria-expanded={menu}
          onClick={(e) => {
            e.stopPropagation()
            setMenu((v) => !v)
          }}
        >
          <Icon id={menu ? 'i-x' : 'i-dots'} />
        </button>
        <BuildIcon icon={p.icon} size={112} />
        {/* Наведение — «Редактировать»: страница сборки (владелец 24.09.2026, 19:08). */}
        <button
          type="button"
          className="ph-mine-edit"
          data-track="build_edit"
          onClick={(e) => {
            e.stopPropagation()
            openBuildSettings(p.name, 'content')
          }}
        >
          <Icon id="i-edit" /> Редактировать
        </button>
      </span>
      <span className="ph-card-body">
        <b>{p.name}</b>
        <span className="ph-card-meta">
          {LOADER_NAME(p) + ' · ' + p.version}
          {seconds >= 60 ? (
            <span className="ph-mine-h">
              <Icon id="i-clock" />
              {hoursText(seconds)}
            </span>
          ) : null}
        </span>
      </span>
      {menu ? (
        <span className="ph-mine-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <b className="ph-mine-menu-t">{p.name}</b>
          <BuildMenuItems name={p.name} onClose={() => setMenu(false)} onIcon={() => setEdit(true)} />
        </span>
      ) : null}
      {edit ? <BuildIconPicker name={p.name} icon={p.icon} onClose={() => setEdit(false)} /> : null}
    </div>
  )
}

/** Плитка-действие полки: «Новая сборка», «Забрать всё». */
export function ActCard({
  icon,
  title,
  meta,
  busy,
  track,
  onClick,
}: {
  icon: string
  title: string
  meta: ReactNode
  busy?: boolean
  /** Имя для аналитики кликов (data-track). */
  track?: string
  onClick: () => void
}) {
  return (
    <button className={'ph-card act' + (busy ? ' busy' : '')} data-sound="open" data-track={track} disabled={busy} onClick={onClick}>
      <span className="ph-card-art ph-mine-art">
        <span className="ph-act-ic">{busy ? <span className="spin" /> : <Icon id={icon} />}</span>
      </span>
      <span className="ph-card-body">
        <b>{title}</b>
        <span className="ph-card-meta">{meta}</span>
      </span>
    </button>
  )
}

export const NewBuildCard = () => (
  <ActCard icon="i-plus" title="Новая сборка" meta="Версия, загрузчик, моды" track="new_build" onClick={() => openModal('nbModal')} />
)

/** Демо в браузере: ядра нет, «нашли» две сборки TLauncher. */
const DEMO_FOUND: FoundInstance[] = [
  { name: 'Industrial 1.12.2', version: '1.12.2', loader: 'forge', path: '/demo/1', source: 'TLauncher' },
  { name: 'Fabric 1.21.1', version: '1.21.1', loader: 'fabric', path: '/demo/2', source: 'TLauncher' },
]

/** «Нашли 3 сборки в Prism» / «… в Prism и TLauncher» / «… в 3 лаунчерах». */
function foundText(list: FoundInstance[]): string {
  const src = [...new Set(list.map((x) => x.source))]
  const n = list.length + ' ' + plural(list.length, 'сборку', 'сборки', 'сборок')
  const where = src.length === 1 ? src[0] : src.length === 2 ? src[0] + ' и ' + src[1] : src.length + ' лаунчерах'
  return 'Нашли ' + n + ' в ' + where
}

/**
 * «Забрать всё» (правка владельца 23.09.2026, 20:05): лаунчер сам ищет
 * сборки других лаунчеров (TLauncher, Prism, MultiMC, CurseForge,
 * Modrinth App, официальный .minecraft — scan_imports ядра) и забирает все
 * одним кликом. Не нашёл — «Импорт»: файл сборки.
 */
export function TakeAllCard({ have, bar }: { have: string[]; bar?: boolean }) {
  const [found, setFound] = useState<FoundInstance[] | null>(null)
  const [done, setDone] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const ask = hasTauri() ? scanImports() : Promise.resolve(DEMO_USER ? DEMO_FOUND : [])
    ask.then((l) => alive && setFound(l)).catch(() => alive && setFound([]))
    return () => {
      alive = false
    }
  }, [])
  const taken = new Set(have)
  const rest = (found || []).filter((x) => !taken.has(x.name))
  const movable = rest.filter((x) => x.movable)

  const takeAll = async (list: FoundInstance[]) => {
    setBusy(true)
    setDone(0)
    let ok = 0
    for (const it of list) {
      try {
        if (hasTauri()) await importInstance(it.path, it.name, it.version, it.loader)
        else
          useProfiles.setState((s) => ({
            profiles: [...s.profiles, { name: it.name, version: it.version, fabric: it.loader === 'fabric', loader: it.loader, icon: null }],
          }))
        track('build_import', { source: it.source, mc: it.version, loader: it.loader })
        ok++
      } catch (e) {
        console.error('[take-all]', it.name, e)
        trackImportFailure(it.source, e, it)
      }
      setDone((d) => d + 1)
    }
    if (hasTauri()) await useProfiles.getState().refresh()
    setBusy(false)
    if (ok) showToast('Забрали ' + ok + ' ' + plural(ok, 'сборку', 'сборки', 'сборок'), 'ok', 'achievement')
    else showToast('Не получилось забрать сборки', 'error')
  }

  // «Импорт» — файл сборки (.mrpack, CurseForge .zip и др.) сразу в «Мои
  // сборки». Правка владельца 20:37: не «Указать папку», а импорт.
  const importFile = () => {
    if (!hasTauri()) {
      showToast('Доступно в приложении')
      return
    }
    setBusy(true)
    importPackFile()
      .then((p) => {
        track('build_import', { source: 'file', mc: p.version, loader: p.loader || (p.fabric ? 'fabric' : 'vanilla') })
        void useProfiles.getState().refresh()
        showToast('Импортировано: ' + p.name, 'ok')
      })
      .catch((err) => {
        trackImportFailure('file', err)
        if (!String(err).includes('Отменено')) showToast('' + err, 'error')
      })
      .finally(() => setBusy(false))
  }

  // В верхней полосе экрана — обычной кнопкой рядом с «Новой сборкой».
  if (bar) {
    if (busy)
      return (
        <button className="btn md secondary" disabled>
          <span className="spin" /> {rest.length ? 'Забираем ' + done + ' из ' + rest.length : 'Импорт…'}
        </button>
      )
    if (movable.length)
      return (
        <button className="btn md secondary" data-sound="open" data-track="move_found" title={foundText(movable)} onClick={() => openModal('mvModal')}>
          <Icon id="i-download" /> Перенести в Millida · {movable.length}
        </button>
      )
    if (rest.length)
      return (
        <button className="btn md secondary" data-sound="open" data-track="import_found" title={foundText(rest)} onClick={() => openModal('impModal')}>
          <Icon id="i-download" /> Импорт · нашли {rest.length}
        </button>
      )
    // «Импорт» — окно, которое само ищет сборки других лаунчеров, а если
    // не нашло — «Из папки» / «Из файла» / «По коду» (правка владельца 22:03).
    return (
      <button className="btn md secondary" data-sound="open" data-track="import" onClick={() => openModal('impModal')}>
        <Icon id="i-upload" /> Импорт
      </button>
    )
  }
  if (found === null)
    return (
      <span className="ph-card skel-card" aria-hidden="true">
        <span className="ph-card-art skel"></span>
        <span className="ph-card-body">
          <span className="skel skel-line" style={{ width: '60%' }}></span>
          <span className="skel skel-line" style={{ width: '35%', height: 9 }}></span>
        </span>
      </span>
    )
  if (busy)
    return <ActCard icon="i-download" title="Забираем" meta={rest.length ? done + ' из ' + rest.length : 'Файл сборки'} busy onClick={() => {}} />
  if (movable.length)
    return <ActCard icon="i-download" title="Перенести в Millida" meta={foundText(movable)} track="move_found" onClick={() => openModal('mvModal')} />
  if (rest.length)
    return <ActCard icon="i-download" title="Забрать всё" meta={foundText(rest)} track="import_take_all" onClick={() => void takeAll(rest)} />
  return <ActCard icon="i-upload" title="Импорт" meta="Файл сборки" track="import" onClick={importFile} />
}

/**
 * Сборка-заготовка: выглядит как обычная, но на диске её ещё нет — она
 * заводится при первом «Играть» (или выборе в лобби).
 */
export function PresetCard({
  v,
  on,
  onPick,
  onPlay,
}: {
  v: PopularVersion
  on: boolean
  onPick: () => void
  onPlay: () => void
}) {
  const loader = { vanilla: 'Vanilla', fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }[v.loader]
  return (
    <div
      className={'ph-card ph-mine' + (on ? ' on' : '')}
      role="button"
      tabIndex={0}
      data-sound="nav"
      data-kind="preset"
      data-id={v.loader + '-' + v.mc}
      data-src="hub_card"
      onClick={onPick}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onPick()}
    >
      <span className="ph-card-art ph-mine-art">
        <BuildIcon icon={DEFAULT_ICON} size={72} />
        <button
          className="btn sm primary ph-mine-play"
          data-sound="open"
          data-track="play"
          onClick={(e) => {
            e.stopPropagation()
            onPlay()
          }}
        >
          <Icon id="i-play" /> Играть
        </button>
      </span>
      <span className="ph-card-body">
        <b>{presetName(v)}</b>
        <span className="ph-card-meta">{loader + ' · ' + v.mc}</span>
      </span>
    </div>
  )
}

/** Порядок: сначала те, в которые играли последними, потом — как в списке сборок. */
export function useMyBuilds(profiles: Profile[]): Profile[] {
  const builds = usePlayStats((s) => s.stats.builds)
  const loaded = usePlayStats((s) => s.loaded)
  useEffect(() => {
    if (!loaded) void usePlayStats.getState().refresh()
  }, [loaded])
  const last = new Map(builds.map((b) => [b.key, b.last]))
  return profiles
    .map((p, i) => ({ p, i, t: last.get(p.name) || 0 }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.p)
}

/**
 * Верхняя полоса экрана «Во что играем». «Новая сборка» и «Импорт» живут
 * карточками во вкладке «Мои сборки» (владелец 24.09.2026: «убрать дубли»),
 * поэтому полоса пустая. Компонент оставлен: его ставит Sidebar.
 */
/** «Импорт» и «Новая сборка» — всегда справа в верхней полосе хаба, напротив
 *  «Лобби» (владелец 24.09.2026, 15:24: «пусть везде висит, всегда»). */
export function PlayhubBar() {
  const have = useProfiles((s) => s.profiles.map((p) => p.name).join('\n'))
  return (
    <span className="ph-bar">
      {/* «Импорт» мельче «Новой сборки» — не перетягивает внимание (17:24). */}
      <span className="ph-bar-imp">
        <TakeAllCard have={have ? have.split('\n') : []} bar />
      </span>
      <button className="btn md primary" data-sound="open" data-track="new_build" onClick={() => openModal('nbModal')}>
        <Icon id="i-plus" /> Новая сборка
      </button>
    </span>
  )
}
