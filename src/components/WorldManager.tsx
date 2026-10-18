import { useCallback, useEffect, useState } from 'react'
import type * as React from 'react'
import { Icon } from './Icon'
import { agoText, fmtSize } from '../lib/format'
import { hasTauri } from '../ipc/tauri'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import {
  backupWorld,
  deleteWorld,
  deleteWorldBackup,
  duplicateWorld,
  exportWorld,
  importWorld,
  listBackups,
  openWorldFolder,
  renameWorld,
  restoreWorldBackup,
  worldDetails,
  type WorldInfo,
} from '../ipc/commands'
import { t, useT } from '../i18n'

const MODE_NAMES: Record<string, string> = {
  get survival() {
    return t('Выживание')
  },
  get creative() {
    return t('Творческий')
  },
  get adventure() {
    return t('Приключение')
  },
  get spectator() {
    return t('Наблюдатель')
  },
}

const DIFFICULTY_NAMES: Record<string, string> = {
  get peaceful() {
    return t('Мирная')
  },
  get easy() {
    return t('Лёгкая')
  },
  get normal() {
    return t('Обычная')
  },
  get hard() {
    return t('Сложная')
  },
}

interface Props {
  profile: string
  onPlay: (folder: string, name: string) => void
  /** Меняется — список перечитывается (мир внесли кнопкой вне списка). */
  reloadKey?: number
  /** Пусто — что показать вместо строки «Миров пока нет». */
  empty?: React.ReactNode
  /** Кнопку «Мир из архива» рисует страница сама. */
  hideImport?: boolean
  /** Сколько миров — для заголовка раздела на странице. */
  onCount?: (n: number) => void
}

export function WorldManager({ profile, onPlay, reloadKey = 0, empty, hideImport, onCount }: Props) {
  const t = useT()
  const [worlds, setWorlds] = useState<WorldInfo[]>([])
  const [backups, setBackups] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState('')
  const [rename, setRename] = useState('')

  const load = useCallback(() => {
    if (!hasTauri()) {
      setLoading(false)
      return
    }
    setLoading(true)
    Promise.all([worldDetails(profile), listBackups(profile)])
      .then(([w, b]) => {
        setWorlds(w)
        setBackups(b)
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setLoading(false))
  }, [profile])

  useEffect(load, [load, reloadKey])
  useEffect(() => {
    if (!loading) onCount?.(worlds.length)
  }, [loading, worlds.length])

  // The button that started the work stays disabled until it finishes, so a
  // second click cannot start a copy of a copy.
  const run = (key: string, task: Promise<unknown>, done: string) => {
    setBusy(key)
    task
      .then((r) => {
        if (r !== null) showToast(done, 'ok')
        load()
      })
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => setBusy(''))
  }

  const backupsOf = (folder: string) => backups.filter((b) => b.startsWith(folder + '-'))

  if (loading)
    return (
      <div className="bx-skel-list" aria-busy="true">
        <span className="skel" />
        <span className="skel" />
      </div>
    )

  return (
    <>
      {worlds.length === 0 ? empty ?? <p className="faint-note">{t('Миров пока нет')}</p> : null}
      <div className="wm-list">
        {worlds.map((w) => {
          const mine = backupsOf(w.folder)
          const expanded = open === w.folder
          return (
            <div className={'wm-card' + (expanded ? ' on' : '')} key={w.folder}>
              <div className="wm-head">
                <span className="wm-icon">
                  {w.icon ? <img src={w.icon} alt="" /> : <Icon id="i-box2" />}
                </span>
                <span className="wm-title">
                  <b>
                    {w.name}
                    {w.hardcore ? <span className="wm-tag danger">{t('Хардкор')}</span> : null}
                    {w.cheats ? <span className="wm-tag">{t('Читы')}</span> : null}
                    {w.unreadable ? <span className="wm-tag danger">{t('Файл мира повреждён')}</span> : null}
                  </b>
                  <span className="wm-meta">
                    {[
                      MODE_NAMES[w.mode],
                      DIFFICULTY_NAMES[w.difficulty],
                      w.version,
                      fmtSize(w.sizeBytes),
                      agoText(w.lastPlayed),
                      mine.length ? t('{n} бэкапов', { n: mine.length }) : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <button
                  className="btn sm primary"
                  disabled={w.unreadable}
                  onClick={() => onPlay(w.folder, w.name)}
                >
                  <Icon id="i-play" /> {t('Играть')}
                </button>
                <button
                  className="icon-btn"
                  aria-label={t('Ещё')}
                  aria-expanded={expanded}
                  onClick={() => {
                    setOpen(expanded ? '' : w.folder)
                    setRename(w.name)
                  }}
                >
                  <Icon id={expanded ? 'i-chev-d' : 'i-chev-r'} />
                </button>
              </div>
              {expanded ? (
                <div className="wm-body">
                  <div className="wm-row">
                    <div className="input sm" style={{ flex: 1 }}>
                      <input
                        value={rename}
                        maxLength={64}
                        placeholder={t('Название мира')}
                        onChange={(e) => setRename(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn sm secondary"
                      disabled={busy === w.folder || !rename.trim() || rename.trim() === w.name || w.unreadable}
                      onClick={() => run(w.folder, renameWorld(profile, w.folder, rename.trim()), t('Мир переименован'))}
                    >
                      {t('Переименовать')}
                    </button>
                  </div>
                  {w.seed ? (
                    <div className="wm-row">
                      <span className="set-val">{t('Сид: {seed}', { seed: w.seed })}</span>
                      <button
                        className="btn sm ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(w.seed).catch(() => {})
                          showToast(t('Сид скопирован'), 'ok')
                        }}
                      >
                        {t('Скопировать')}
                      </button>
                    </div>
                  ) : null}
                  <div className="wm-actions">
                    <button
                      className="btn sm secondary"
                      disabled={busy === w.folder}
                      onClick={() => run(w.folder, backupWorld(profile, w.folder), t('Бэкап готов'))}
                    >
                      <Icon id="i-download" /> {t('Бэкап')}
                    </button>
                    <button
                      className="btn sm secondary"
                      disabled={busy === w.folder}
                      onClick={() => run(w.folder, exportWorld(profile, w.folder), t('Мир сохранён в архив'))}
                    >
                      <Icon id="i-box2" /> {t('В архив')}
                    </button>
                    <button
                      className="btn sm secondary"
                      disabled={busy === w.folder}
                      onClick={() => run(w.folder, duplicateWorld(profile, w.folder), t('Копия мира создана'))}
                    >
                      <Icon id="i-copy" /> {t('Копия')}
                    </button>
                    <button className="btn sm ghost" onClick={() => void openWorldFolder(profile, w.folder)}>
                      <Icon id="i-folder" /> {t('Папка')}
                    </button>
                    <button
                      className="btn sm danger"
                      disabled={busy === w.folder}
                      onClick={() => {
                        void uiConfirm(
                          t('Удалить мир «{name}» вместе со всем прогрессом? Отменить будет нельзя.', { name: w.name }),
                          { title: t('Удаление мира'), confirmLabel: t('Удалить') },
                        ).then((ok) => {
                          if (ok) run(w.folder, deleteWorld(profile, w.folder), t('Мир удалён'))
                        })
                      }}
                    >
                      <Icon id="i-trash" /> {t('Удалить')}
                    </button>
                  </div>
                  {mine.length ? (
                    <div className="wm-backups">
                      <span className="cap">{t('Бэкапы')}</span>
                      {mine.map((b) => (
                        <div className="wm-row" key={b}>
                          <span className="set-val" style={{ flex: 1 }}>
                            {b}
                          </span>
                          <button
                            className="btn sm secondary"
                            disabled={busy === b}
                            onClick={() =>
                              run(b, restoreWorldBackup(profile, b), t('Бэкап восстановлен отдельным миром'))
                            }
                          >
                            {t('Восстановить')}
                          </button>
                          <button
                            className="icon-btn del"
                            aria-label={t('Удалить бэкап')}
                            onClick={() => run(b, deleteWorldBackup(profile, b), t('Бэкап удалён'))}
                          >
                            <Icon id="i-trash" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {hideImport ? null : (
        <button
          className="btn sm secondary"
          style={{ width: '100%', marginTop: '8px' }}
          disabled={busy === 'import'}
          onClick={() => run('import', importWorld(profile), t('Мир внесён в сборку'))}
        >
          <Icon id="i-upload" /> {t('Мир из архива')}
        </button>
      )}
    </>
  )
}
