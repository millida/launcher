import { useEffect, useState } from 'react'
import { Icon } from '../Icon'
import { catalogPackContents, modpackContents } from '../../ipc/commands'
import type { PackContents as Contents } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { loaderLabel } from './site'
import { sizeLabel } from './itemView'
import { useT } from '../../i18n'

const stem = (file: string) => file.replace(/\.(jar|zip)$/i, '')

/// «Состав» of a modpack before it is installed: what lands in mods,
/// resource packs and shader packs, the loader and the download weight.
/// `project` — a Modrinth pack; `catalog` — a Millida catalogue pack by slug.
export function PackContents({ project, catalog }: { project?: string; catalog?: string }) {
  const t = useT()
  const [data, setData] = useState<Contents | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setData(null)
    setError('')
    if (!hasTauri()) {
      setError(t('Состав видно в приложении лаунчера'))
      return
    }
    ;(catalog ? catalogPackContents(catalog) : modpackContents(project || ''))
      .then((c) => alive && setData(c))
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
    }
  }, [project, catalog, tick])

  if (error)
    return (
      <section className="card ci-box">
        <p className="faint-note">{error}</p>
        <button className="btn sm secondary ci-retry" onClick={() => setTick((n) => n + 1)}>
          <Icon id="i-restart" />
          {t('Повторить')}
        </button>
      </section>
    )
  if (!data)
    return (
      <section className="card ci-box" aria-busy="true">
        <span className="skel" style={{ display: 'block', height: 18, width: '60%' }} />
        <span className="skel" style={{ display: 'block', height: 18, width: '85%', marginTop: 10 }} />
        <span className="skel" style={{ display: 'block', height: 18, width: '40%', marginTop: 10 }} />
      </section>
    )

  const groups: [string, Contents['mods']][] = [
    [t('Моды'), data.mods],
    [t('Ресурспаки'), data.resourcepacks],
    [t('Шейдеры'), data.shaderpacks],
  ]
  return (
    <>
      <section className="card ci-box" aria-label={t('Состав')}>
        <div className="ci-chips">
          <span className="ci-chip">{loaderLabel(data.loader) + (data.game ? ' · ' + data.game : '')}</span>
          {data.totalBytes ? (
            <span className="ci-chip">
              <Icon id="i-download" />
              {sizeLabel(data.totalBytes)}
            </span>
          ) : null}
          {data.bundled ? <span className="ci-chip is-soft">{t('Файлов в архиве: {n}', { n: data.bundled })}</span> : null}
        </div>
      </section>
      {groups
        .filter(([, list]) => list.length)
        .map(([title, list]) => (
          <section className="card ci-box" key={title} aria-label={title}>
            <h2 className="ci-box-h">
              {title} · {list.length}
            </h2>
            <div className="ci-chips">
              {list.map((e) => (
                <span className="ci-chip is-soft" key={e.name} title={sizeLabel(e.size)}>
                  {stem(e.name)}
                </span>
              ))}
            </div>
          </section>
        ))}
    </>
  )
}
