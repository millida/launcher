import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { hasTauri } from '../../ipc/tauri'
import { hostDownload, hostUpload } from '../../ipc/commands'
import { Empty, Loading, sizeLabel } from './kit'
import { host, errText } from './api'
import type { HostingFileEntry } from './api'

const TEXT_EXT = /\.(txt|yml|yaml|json|json5|properties|conf|cfg|toml|ini|log|md|csv|snbt|mcmeta|xml|lang)$/i
// jar stays out: it is a ready plugin or core, unpacking it yields loose classes.
const ARCHIVE_EXT = /\.(zip|tar|gz|tgz|rar|7z)$/i

const parentOf = (path: string) => {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

const joinPath = (dir: string, name: string) => (dir ? dir + '/' + name : name)

export function TabFiles({ serverId }: { serverId: string }) {
  const [dir, setDir] = useState('')
  const [entries, setEntries] = useState<HostingFileEntry[] | null>(null)
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [ask, setAsk] = useState<{ kind: 'mkdir' | 'rename'; from: string; value: string } | null>(null)

  const load = (path = dir) => {
    setEntries(null)
    void host
      .files(serverId, path)
      .then((r) => setEntries(Array.isArray(r) ? r : []))
      .catch((e) => {
        showToast(errText(e), 'error')
        setEntries([])
      })
  }
  useEffect(() => load(dir), [serverId, dir])

  const open = async (e: HostingFileEntry) => {
    if (e.dir) {
      setDir(joinPath(dir, e.name))
      return
    }
    if (!TEXT_EXT.test(e.name)) {
      showToast('Это не текстовый файл — его можно скачать или заменить', 'error')
      return
    }
    setBusy(e.name)
    try {
      const r = await host.readFile(serverId, joinPath(dir, e.name))
      setEditing({ path: r.path || joinPath(dir, e.name), content: r.content || '' })
      setDraft(r.content || '')
    } catch (err) {
      showToast(errText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const saveFile = async () => {
    if (!editing) return
    setBusy('save')
    try {
      await host.writeFile(serverId, editing.path, draft)
      showToast('Сохранено — применится после перезапуска')
      setEditing({ ...editing, content: draft })
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (e: HostingFileEntry) => {
    if (!(await uiConfirm('Удалить «' + e.name + '»' + (e.dir ? ' со всем содержимым' : '') + '?', { confirmLabel: 'Удалить' })))
      return
    try {
      await host.deleteFile(serverId, joinPath(dir, e.name))
      setEntries((list) => (list || []).filter((x) => x.name !== e.name))
    } catch (err) {
      showToast(errText(err), 'error')
    }
  }

  const rename = async (from: string, next: string) => {
    if (!next || next === from) return
    try {
      await host.renameFile(serverId, joinPath(dir, from), joinPath(dir, next))
      load()
    } catch (err) {
      showToast(errText(err), 'error')
    }
  }

  const extract = async (e: HostingFileEntry) => {
    if (!(await uiConfirm('Распаковать «' + e.name + '» в текущую папку?', { confirmLabel: 'Распаковать', danger: false }))) return
    setBusy(e.name)
    try {
      await host.extractFile(serverId, joinPath(dir, e.name), dir || '.')
      showToast('Распаковано')
      load()
    } catch (err) {
      showToast(errText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const download = async (e: HostingFileEntry) => {
    if (!hasTauri()) {
      showToast('Скачивание — в приложении', 'error')
      return
    }
    setBusy(e.name)
    try {
      const path = await hostDownload(serverId, joinPath(dir, e.name))
      showToast(path ? 'Сохранено: ' + path : 'Отменено')
    } catch (err) {
      showToast(errText(err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const upload = async () => {
    if (!hasTauri()) {
      showToast('Загрузка файлов — в приложении', 'error')
      return
    }
    setBusy('upload')
    showToast('Заливаем файл…')
    try {
      const target = await hostUpload(serverId, dir)
      showToast(target ? 'Загружено: ' + target : 'Отменено')
      load()
    } catch (e) {
      showToast('Не удалось загрузить: ' + errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const mkdir = async (name: string) => {
    if (!name.trim()) return
    try {
      await host.mkdir(serverId, joinPath(dir, name.trim()))
      load()
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  if (editing) {
    return (
      <div className="card" style={{ padding: '18px' }}>
        <div className="host-files-head">
          <button className="inst-back" onClick={() => setEditing(null)}>
            <Icon id="i-chev-l" /> К файлам
          </button>
          <span className="host-files-path">{editing.path}</span>
          <span style={{ flex: 1 }}></span>
          <button className="btn sm primary" disabled={busy === 'save' || draft === editing.content} onClick={() => void saveFile()}>
            Сохранить
          </button>
        </div>
        <textarea className="host-file-edit" value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
      </div>
    )
  }

  const crumbs = dir.split('/').filter(Boolean)

  return (
    <div className="card" style={{ padding: '18px' }}>
      <div className="host-files-head">
        <button className="inst-back" disabled={!dir} onClick={() => setDir(parentOf(dir))}>
          <Icon id="i-chev-l" /> Назад
        </button>
        <span className="host-files-path">
          <button className="host-crumb" onClick={() => setDir('')}>
            сервер
          </button>
          {crumbs.map((c, i) => (
            <button key={i} className="host-crumb" onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}>
              {' / ' + c}
            </button>
          ))}
        </span>
        <span style={{ flex: 1 }}></span>
        <button className="btn sm secondary" onClick={() => setAsk({ kind: 'mkdir', from: '', value: '' })}>
          <Icon id="i-plus" /> Папка
        </button>
        <button className="btn sm secondary" disabled={busy === 'upload'} onClick={() => void upload()}>
          <Icon id="i-upload" /> Загрузить
        </button>
      </div>

      {ask ? (
        <div className="host-ask">
          <div className="input sm" style={{ flex: 1 }}>
            <input
              autoFocus
              placeholder={ask.kind === 'mkdir' ? 'Название папки' : 'Новое имя'}
              value={ask.value}
              onChange={(e) => setAsk({ ...ask, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setAsk(null)
                if (e.key !== 'Enter') return
                const v = ask.value
                const kind = ask.kind
                const from = ask.from
                setAsk(null)
                void (kind === 'mkdir' ? mkdir(v) : rename(from, v.trim()))
              }}
            />
          </div>
          <button
            className="btn sm primary"
            disabled={!ask.value.trim()}
            onClick={() => {
              const { kind, from, value } = ask
              setAsk(null)
              void (kind === 'mkdir' ? mkdir(value) : rename(from, value.trim()))
            }}
          >
            {ask.kind === 'mkdir' ? 'Создать' : 'Переименовать'}
          </button>
          <button className="btn sm ghost" onClick={() => setAsk(null)}>
            Отмена
          </button>
        </div>
      ) : null}

      {entries === null ? (
        <Loading />
      ) : entries.length ? (
        <div className="stack">
          {[...entries]
            .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name))
            .map((e) => (
              <div className="fr-row host-file-row" key={e.name}>
                <span className="host-ico" style={{ width: 30, height: 30 }}>
                  <Icon id={e.dir ? 'i-box' : TEXT_EXT.test(e.name) ? 'i-list' : 'i-box2'} />
                </span>
                <button className="host-file-name" onClick={() => void open(e)}>
                  {e.name}
                </button>
                <span className="host-file-meta">{e.dir ? 'папка' : sizeLabel(e.size)}</span>
                {!e.dir && ARCHIVE_EXT.test(e.name) ? (
                  <button className="btn sm secondary" disabled={busy === e.name} onClick={() => void extract(e)}>
                    Распаковать
                  </button>
                ) : null}
                {!e.dir ? (
                  <button className="btn sm ghost" title="Скачать" disabled={busy === e.name} onClick={() => void download(e)}>
                    <Icon id="i-download" />
                  </button>
                ) : null}
                <button
                  className="btn sm ghost"
                  title="Переименовать"
                  onClick={() => setAsk({ kind: 'rename', from: e.name, value: e.name })}
                >
                  <Icon id="i-brush" />
                </button>
                <button className="btn sm ghost" title="Удалить" onClick={() => void remove(e)}>
                  <Icon id="i-trash" />
                </button>
              </div>
            ))}
        </div>
      ) : (
        <Empty icon="i-inbox" text="Папка пуста." />
      )}
    </div>
  )
}
