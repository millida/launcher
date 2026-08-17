import { useCallback, useEffect, useState } from 'react'
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

const MODE_NAMES: Record<string, string> = {
  survival: 'Выживание',
  creative: 'Творческий',
  adventure: 'Приключение',
  spectator: 'Наблюдатель',
}

const DIFFICULTY_NAMES: Record<string, string> = {
  peaceful: 'Мирная',
  easy: 'Лёгкая',
  normal: 'Обычная',
  hard: 'Сложная',
}

interface Props {
  profile: string
  onPlay: (folder: string, name: string) => void
}

export function WorldManager({ profile, onPlay }: Props) {
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

  useEffect(load, [load])

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

  if (loading) return <p className="faint-note">Читаем миры…</p>

  return (
    <>
      {worlds.length === 0 ? (
        <p className="faint-note">Миров пока нет — они появятся после игры или можно внести архив.</p>
      ) : null}
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
                    {w.hardcore ? <span className="wm-tag danger">Хардкор</span> : null}
                    {w.cheats ? <span className="wm-tag">Читы</span> : null}
                    {w.unreadable ? <span className="wm-tag danger">Файл мира повреждён</span> : null}
                  </b>
                  <span className="wm-meta">
                    {[
                      MODE_NAMES[w.mode],
                      DIFFICULTY_NAMES[w.difficulty],
                      w.version,
                      fmtSize(w.sizeBytes),
                      agoText(w.lastPlayed),
                      mine.length ? mine.length + ' бэкапов' : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <button
                  className="btn sm secondary"
                  disabled={w.unreadable}
                  onClick={() => onPlay(w.folder, w.name)}
                >
                  Играть
                </button>
                <button
                  className="icon-btn"
                  title="Ещё"
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
                        placeholder="Название мира"
                        onChange={(e) => setRename(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn sm secondary"
                      disabled={busy === w.folder || !rename.trim() || rename.trim() === w.name || w.unreadable}
                      onClick={() => run(w.folder, renameWorld(profile, w.folder, rename.trim()), 'Мир переименован')}
                    >
                      Переименовать
                    </button>
                  </div>
                  {w.seed ? (
                    <div className="wm-row">
                      <span className="set-val">Сид: {w.seed}</span>
                      <button
                        className="btn sm ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(w.seed).catch(() => {})
                          showToast('Сид скопирован', 'ok')
                        }}
                      >
                        Скопировать
                      </button>
                    </div>
                  ) : null}
                  <div className="wm-actions">
                    <button
                      className="btn sm secondary"
                      disabled={busy === w.folder}
                      onClick={() => run(w.folder, backupWorld(profile, w.folder), 'Бэкап готов')}
                    >
                      <Icon id="i-download" /> Бэкап
                    </button>
                    <button
                      className="btn sm secondary"
                      disabled={busy === w.folder}
                      onClick={() => run(w.folder, exportWorld(profile, w.folder), 'Мир сохранён в архив')}
                    >
                      <Icon id="i-box2" /> Экспорт в zip
                    </button>
                    <button
                      className="btn sm secondary"
                      disabled={busy === w.folder}
                      onClick={() => run(w.folder, duplicateWorld(profile, w.folder), 'Копия мира создана')}
                    >
                      <Icon id="i-copy" /> Дублировать
                    </button>
                    <button className="btn sm ghost" onClick={() => void openWorldFolder(profile, w.folder)}>
                      Открыть папку
                    </button>
                    <button
                      className="btn sm danger"
                      disabled={busy === w.folder}
                      onClick={() => {
                        void uiConfirm(
                          'Удалить мир «' + w.name + '» вместе со всем прогрессом? Отменить будет нельзя.',
                          { title: 'Удаление мира', confirmLabel: 'Удалить' },
                        ).then((ok) => {
                          if (ok) run(w.folder, deleteWorld(profile, w.folder), 'Мир удалён')
                        })
                      }}
                    >
                      <Icon id="i-trash" /> Удалить
                    </button>
                  </div>
                  {mine.length ? (
                    <div className="wm-backups">
                      <span className="cap">Бэкапы</span>
                      {mine.map((b) => (
                        <div className="wm-row" key={b}>
                          <span className="set-val" style={{ flex: 1 }}>
                            {b}
                          </span>
                          <button
                            className="btn sm secondary"
                            disabled={busy === b}
                            onClick={() =>
                              run(b, restoreWorldBackup(profile, b), 'Бэкап восстановлен отдельным миром')
                            }
                          >
                            Восстановить
                          </button>
                          <button
                            className="icon-btn del"
                            title="Удалить бэкап"
                            onClick={() => run(b, deleteWorldBackup(profile, b), 'Бэкап удалён')}
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
      <button
        className="btn sm secondary"
        style={{ width: '100%', marginTop: '8px' }}
        disabled={busy === 'import'}
        onClick={() => run('import', importWorld(profile), 'Мир внесён в сборку')}
      >
        <Icon id="i-upload" /> Внести мир из архива
      </button>
    </>
  )
}
