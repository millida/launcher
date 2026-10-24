import { useEffect, useMemo, useRef, useState } from 'react'
import { backdropClose } from '../lib/dismiss'
import { isPaletteShortcut, rankItems, type PaletteItem, type PaletteKind } from '../lib/palette'
import { realLaunch } from '../lib/launch'
import { openSettings, setScreen, type ScreenId, type SettingsTab } from '../state/ui'
import { useProfiles } from '../state/profiles'
import { useServers } from '../state/servers'
import { openServerDetail } from '../state/serverDetail'
import { openChat, useFriends } from '../state/friends'
import { openBuildSettings } from '../state/instance'
import { openMcNews } from './McNews'
import { t, useT } from '../i18n'
import '../styles/pixel/cmdk.css'

function screens(): PaletteItem[] {
  const list: Array<[ScreenId, string, string]> = [
    ['play', t('Играть'), t('лобби главная')],
    ['playhub', t('Мои сборки'), t('библиотека каталог режимы')],
    ['servers', t('Серверы'), t('рейтинг мультиплеер')],
    ['skins', t('Скины'), t('плащ гардероб косметика')],
    ['rubies', t('Магазин'), t('рубины покупки')],
    ['top', t('Топ'), t('рейтинг игроков')],
    ['friends', t('Друзья'), t('чат сообщения')],
    ['hosting', t('Мой сервер'), t('хостинг')],
  ]
  const items: PaletteItem[] = list.map(([id, title, words]) => ({ id: 'screen:' + id, kind: 'screen', title, words, run: () => setScreen(id) }))
  items.push({ id: 'screen:mc-news', kind: 'screen', title: t('Новости Minecraft'), words: t('mojang обновления игры снапшоты'), run: openMcNews })
  return items
}

function settings(): PaletteItem[] {
  const list: Array<[SettingsTab, string, string]> = [
    ['look', t('Вид'), t('тема цвет фон язык анимация')],
    ['sound', t('Звук'), t('музыка микрофон уведомления')],
    ['game', t('Игра'), t('память окно java')],
    ['files', t('Файлы'), t('папка кэш бэкапы')],
    ['privacy', t('Аккаунт'), t('приватность статистика')],
    ['about', t('Лаунчер'), t('версия обновление')],
  ]
  return list.map(([id, title, words]) => ({
    id: 'settings:' + id,
    kind: 'settings',
    title: t('Настройки: {section}', { section: title }),
    words,
    run: () => openSettings(id),
  }))
}

const KIND_LABEL: Record<PaletteKind, () => string> = {
  screen: () => t('Раздел'),
  settings: () => t('Настройки'),
  build: () => t('Сборка'),
  server: () => t('Сервер'),
  friend: () => t('Друг'),
}

export function CommandPalette() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const profiles = useProfiles((s) => s.profiles)
  const servers = useServers((s) => s.list)
  const friends = useFriends((s) => s.friends)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    requestAnimationFrame(() => input.current?.focus())
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return []
    const builds: PaletteItem[] = profiles.flatMap((p) => [
      { id: 'play:' + p.name, kind: 'build', title: t('Играть: {name}', { name: p.name }), words: p.version, run: () => realLaunch(p.name) },
      { id: 'build:' + p.name, kind: 'build', title: t('Сборка: {name}', { name: p.name }), words: p.version, run: () => openBuildSettings(p.name) },
    ])
    const svs: PaletteItem[] = servers.map((sv) => ({ id: 'server:' + sv.slug, kind: 'server', title: sv.name, run: () => openServerDetail(sv) }))
    const fr: PaletteItem[] = friends.map((f) => ({
      id: 'friend:' + f.userId,
      kind: 'friend',
      title: f.nickname || f.gameNick || '',
      words: f.gameNick || '',
      run: () => {
        setScreen('friends')
        void openChat(f.userId, f.nickname || '')
      },
    }))
    return [...builds, ...screens(), ...fr.filter((x) => x.title), ...svs, ...settings()]
  }, [open, profiles, servers, friends, t])

  const shown = useMemo(() => rankItems(items, query), [items, query])

  if (!open) return null

  const close = () => setOpen(false)
  const run = (item: PaletteItem | undefined) => {
    if (!item) return
    close()
    item.run()
  }

  return (
    <div className="modal-bg open vis cmdk-bg" style={{ zIndex: 970 }} {...backdropClose(close)}>
      <div className="modal mw-sm cmdk" role="dialog" aria-modal="true" aria-label={t('Быстрый поиск')}>
        <input
          ref={input}
          className="input cmdk-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="cmdkList"
          aria-activedescendant={shown[active] ? 'cmdk-' + active : undefined}
          placeholder={t('Сборка, раздел, друг или настройка')}
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(i + 1, Math.max(0, shown.length - 1)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(shown[active])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              close()
            }
          }}
        />
        <div className="cmdk-list" id="cmdkList" role="listbox">
          {shown.length ? (
            shown.map((item, i) => (
              <button
                key={item.id}
                id={'cmdk-' + i}
                role="option"
                aria-selected={i === active}
                className={'cmdk-row' + (i === active ? ' on' : '')}
                onMouseMove={() => setActive(i)}
                onClick={() => run(item)}
              >
                <span className="cmdk-title">{item.title}</span>
                <span className="cmdk-kind">{KIND_LABEL[item.kind]()}</span>
              </button>
            ))
          ) : (
            <div className="cmdk-empty">{t('Ничего не нашлось')}</div>
          )}
        </div>
      </div>
    </div>
  )
}
