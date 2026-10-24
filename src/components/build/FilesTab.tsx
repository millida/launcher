import { useCallback, useEffect, useRef, useState } from 'react'
import { deleteBuildFile, listBuildFiles, revealBuildFile } from '../../ipc/commands'
import type { BuildFile } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import { fmtSize, whenText } from '../../lib/format'
import { uiConfirm } from '../../state/confirm'
import { showToast } from '../../state/ui'
import { Icon } from '../Icon'
import { useT } from '../../i18n'
import '../../styles/pixel/build-extras.css'

const join = (dir: string, name: string) => (dir ? dir + '/' + name : name)

export function FilesTab({ profile, active }: { profile: string; active: boolean }) {
  const t = useT()
  const [dir, setDir] = useState('')
  const [list, setList] = useState<BuildFile[] | null>(null)
  const [error, setError] = useState('')
  const seq = useRef(0)

  const load = useCallback(
    (at: string) => {
      const mine = ++seq.current
      setError('')
      if (!hasTauri()) {
        setList([])
        setError(t('Доступно в приложении'))
        return
      }
      setList(null)
      listBuildFiles(profile, at)
        .then((rows) => mine === seq.current && setList(rows))
        .catch((e) => {
          if (mine !== seq.current) return
          setList([])
          setError(apiErrorText(e, t('Не удалось открыть папку сборки')))
        })
    },
    [profile],
  )

  useEffect(() => setDir(''), [profile])
  useEffect(() => {
    if (active) load(dir)
  }, [active, dir, load])

  const crumbs = dir ? dir.split('/') : []
  const remove = async (f: BuildFile) => {
    const ok = await uiConfirm(f.dir ? t('Папка «{name}» удалится со всем содержимым.', { name: f.name }) : t('Файл «{name}» удалится из сборки.', { name: f.name }), {
      title: t('Удалить?'),
      confirmLabel: t('Удалить'),
    })
    if (!ok) return
    deleteBuildFile(profile, join(dir, f.name))
      .then(() => load(dir))
      .catch((e) => showToast(apiErrorText(e, t('Не удалось удалить')), 'error'))
  }

  return (
    <div className="bx-files">
      <nav className="bx-crumbs" aria-label={t('Путь')}>
        <button type="button" className={'bx-crumb' + (dir ? '' : ' on')} onClick={() => setDir('')}>
          <Icon id="i-folder" /> {t('Сборка')}
        </button>
        {crumbs.map((c, i) => (
          <button type="button" key={i} className={'bx-crumb' + (i === crumbs.length - 1 ? ' on' : '')} onClick={() => setDir(crumbs.slice(0, i + 1).join('/'))}>
            <Icon id="i-chev-r" /> {c}
          </button>
        ))}
        <span className="bpg-grow" />
        <button type="button" className="btn sm secondary" onClick={() => void revealBuildFile(profile, dir).catch((e) => showToast(apiErrorText(e, t('Не удалось открыть папку')), 'error'))}>
          <Icon id="i-ext" /> {t('Открыть папку')}
        </button>
      </nav>
      {error ? <p className="faint-note">{error}</p> : null}
      {list === null ? (
        <div className="bx-files-list" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div className="bx-file skel" key={i} />
          ))}
        </div>
      ) : !list.length && !error ? (
        <div className="bpg-none">
          <span>{t('Здесь пусто')}</span>
        </div>
      ) : (
        <div className="bx-files-list">
          {list.map((f) => (
            <div className="bx-file" key={f.name}>
              <button type="button" className="bx-file-main" onClick={() => (f.dir ? setDir(join(dir, f.name)) : void revealBuildFile(profile, join(dir, f.name)).catch((e) => showToast(apiErrorText(e, t('Не удалось открыть папку')), 'error')))}>
                <Icon id={f.dir ? 'i-folder' : 'i-box'} />
                <b>{f.name}</b>
                <small>{f.dir ? '' : fmtSize(f.size)}</small>
                <small>{f.modified ? whenText(f.modified) : ''}</small>
              </button>
              {f.service ? (
                <span className="bpg-tag" title={t('Служебный файл лаунчера')}>
                  <Icon id="i-lock" />
                </span>
              ) : (
                <button type="button" className="icon-btn del" aria-label={t('Удалить {name}', { name: f.name })} onClick={() => void remove(f)}>
                  <Icon id="i-trash" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
