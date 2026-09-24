import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Icon } from '../Icon'
import { LOADER_NAME, plural } from '../../lib/format'
import { listContent, setProfileIcon } from '../../ipc/commands'
import type { Profile } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { openBuildSettings } from '../../state/instance'
import { usePlayStats } from '../../state/playStats'
import { useProfiles } from '../../state/profiles'
import { showToast } from '../../state/ui'
import { DEFAULT_ICON, parseIcon } from '../../lib/buildIcon'
import { BuildIcon, IconPicker } from './BuildIcon'
import { hoursText } from './Hours'

/**
 * «Мои сборки» во вкладке «Собрать» — верстак: крупные карточки своих сборок
 * (иконка, версия, число модов, часы), «Играть» и «Моды». Нажатие на карточку
 * делает сборку целью каталога ниже: «+ В сборку» ставит в неё, выдача —
 * под её версию и загрузчик. Как «Library» в Modrinth App, только сразу
 * с каталогом на том же экране.
 */

/** Число модов сборки — из ядра; в браузере ядра нет, числа нет. */
const modCache = new Map<string, number>()
function useModCount(name: string): number | null {
  const [n, setN] = useState<number | null>(() => modCache.get(name) ?? null)
  useEffect(() => {
    if (!hasTauri()) return
    let alive = true
    listContent(name, 'mod')
      .then((l) => {
        modCache.set(name, l.length)
        if (alive) setN(l.length)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [name])
  return n
}

async function saveIcon(name: string, icon: string): Promise<void> {
  if (hasTauri()) {
    const list = await setProfileIcon(name, icon)
    if (Array.isArray(list)) useProfiles.setState({ profiles: list })
    else await useProfiles.getState().refresh()
    return
  }
  useProfiles.setState((s) => ({ profiles: s.profiles.map((p) => (p.name === name ? { ...p, icon } : p)) }))
}

function DeckCard({
  p,
  target,
  onTarget,
  onPlay,
}: {
  p: Profile
  target: boolean
  onTarget: () => void
  onPlay: () => void
}) {
  const seconds = usePlayStats((s) => s.stats.builds.find((b) => b.key === p.name)?.seconds || 0)
  const mods = useModCount(p.name)
  const [edit, setEdit] = useState(false)
  const art = parseIcon(p.icon)
  return (
    <div
      className={'ph-card bd-card' + (target ? ' on' : '')}
      role="button"
      tabIndex={0}
      aria-pressed={target}
      data-sound="nav"
      onClick={onTarget}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === 'Enter' && onTarget()}
    >
      <span className="bd-art" style={{ '--mine-bg': art.bg } as CSSProperties}>
        <button
          type="button"
          className="bi-edit"
          aria-label="Изменить иконку"
          data-sound="open"
          onClick={(e) => {
            e.stopPropagation()
            setEdit(true)
          }}
        >
          <BuildIcon icon={p.icon} size={88} />
          <span className="bi-edit-lab" aria-hidden="true">
            <Icon id="i-edit" />
          </span>
        </button>
      </span>
      <span className="bd-main">
        <b className="bd-name">{p.name}</b>
        <span className="bd-facts">
          <span className="bd-fact">{LOADER_NAME(p) + ' ' + p.version}</span>
          {mods !== null ? (
            <span className="bd-fact">
              <Icon id="i-blocks" />
              {mods + ' ' + plural(mods, 'мод', 'мода', 'модов')}
            </span>
          ) : null}
          {seconds >= 60 ? (
            <span className="bd-fact">
              <Icon id="i-clock" />
              {hoursText(seconds)}
            </span>
          ) : null}
        </span>
        <span className="bd-acts">
          <button
            className="btn sm primary"
            data-sound="open"
            onClick={(e) => {
              e.stopPropagation()
              onPlay()
            }}
          >
            <Icon id="i-play" /> Играть
          </button>
          <button
            className="btn sm secondary"
            data-sound="open"
            onClick={(e) => {
              e.stopPropagation()
              openBuildSettings(p.name, 'content')
            }}
          >
            <Icon id="i-blocks" /> Моды
          </button>
        </span>
      </span>
      {target ? (
        <span className="ph-card-on" aria-hidden="true">
          <Icon id="i-check" />
        </span>
      ) : null}
      {edit ? (
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <IconPicker
            icon={p.icon || DEFAULT_ICON}
            onClose={() => setEdit(false)}
            onPick={(icon) => void saveIcon(p.name, icon).catch((e) => showToast('Иконка не сохранилась: ' + e, 'error'))}
          />
        </span>
      ) : null}
    </div>
  )
}

/** Сколько карточек видно до «Показать все». */
const SHOWN = 5

export function BuildDeck({
  builds,
  target,
  onTarget,
  onPlay,
}: {
  builds: Profile[]
  /** Сборка, для которой сейчас ищет каталог. */
  target: string | null
  onTarget: (name: string) => void
  onPlay: (name: string) => void
}) {
  const [all, setAll] = useState(false)
  const shown = all ? builds : builds.slice(0, SHOWN)
  return (
    <section className="ph-shelf bd">
      <div className="ph-shelf-head">
        <h2>
          Мои сборки {builds.length ? <span className="ph-count">{builds.length}</span> : null}
        </h2>
        {builds.length > SHOWN ? (
          <button className="btn sm secondary" aria-expanded={all} onClick={() => setAll((v) => !v)}>
            {all ? 'Свернуть' : 'Все'} <Icon id={all ? 'i-chev-u' : 'i-chev-d'} />
          </button>
        ) : null}
      </div>
      <div className="bd-grid">
        {/* «Новая сборка» и «Импорт» живут справа в верхней полосе хаба
            (PlayhubBar, a24a88d) — второй такой же пары здесь нет. */}
        {shown.map((p) => (
          <DeckCard
            key={p.name}
            p={p}
            target={p.name === target}
            onTarget={() => onTarget(p.name)}
            onPlay={() => onPlay(p.name)}
          />
        ))}
      </div>
    </section>
  )
}
