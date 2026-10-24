import { useCallback, useEffect, useRef, useState } from 'react'
import { addDatapackToWorld, deleteWorldDatapack, listContent, setWorldDatapack, worldDatapacks } from '../../ipc/commands'
import type { ModFile, WorldPack } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import { uiConfirm } from '../../state/confirm'
import { showToast } from '../../state/ui'
import { Icon } from '../Icon'
import { useT } from '../../i18n'
import '../../styles/pixel/build-extras.css'

/** Data packs work per world: the build's datapacks/ folder is only where the catalogue puts them. */
export function WorldPacks({ profile, world, onCatalog }: { profile: string; world: string; onCatalog: () => void }) {
  const t = useT()
  const [packs, setPacks] = useState<WorldPack[] | null>(null)
  const [stock, setStock] = useState<ModFile[]>([])
  const [busy, setBusy] = useState('')
  const seq = useRef(0)

  const load = useCallback(() => {
    if (!hasTauri()) {
      setPacks([])
      return
    }
    const mine = ++seq.current
    Promise.all([worldDatapacks(profile, world), listContent(profile, 'datapack')])
      .then(([w, b]) => {
        if (mine !== seq.current) return
        setPacks(w)
        setStock(b)
      })
      .catch((e) => {
        if (mine !== seq.current) return
        setPacks([])
        showToast(apiErrorText(e, t('Не удалось прочитать дата-паки мира')), 'error')
      })
  }, [profile, world])

  useEffect(load, [load])

  const act = (key: string, task: Promise<unknown>) => {
    setBusy(key)
    task
      .then(load)
      .catch((e) => showToast(apiErrorText(e, t('Не удалось выполнить действие')), 'error'))
      .finally(() => setBusy(''))
  }

  if (packs === null) return <span className="skel bx-wp-skel" aria-busy="true" />
  const have = new Set(packs.map((p) => p.name))
  const offer = stock.filter((s) => s.enabled && !have.has(s.name))
  return (
    <div className="wm-backups bx-wp">
      <span className="cap">{t('Дата-паки')}</span>
      {packs.map((p) => (
        <div className="wm-row" key={p.name}>
          <span className="set-val" style={{ flex: 1 }}>
            {p.name}
          </span>
          <span
            className={'tgl' + (p.enabled ? ' on' : '')}
            role="switch"
            aria-checked={p.enabled}
            aria-label={p.enabled ? t('Выключить {name}', { name: p.name }) : t('Включить {name}', { name: p.name })}
            onClick={() => busy !== p.name && act(p.name, setWorldDatapack(profile, world, p.name, !p.enabled))}
          />
          <button
            className="icon-btn del"
            aria-label={t('Удалить {name}', { name: p.name })}
            disabled={busy === p.name}
            onClick={() =>
              void uiConfirm(t('Удалить «{name}» из мира?', { name: p.name }), { confirmLabel: t('Удалить') }).then(
                (ok) => ok && act(p.name, deleteWorldDatapack(profile, world, p.name)),
              )
            }
          >
            <Icon id="i-trash" />
          </button>
        </div>
      ))}
      {offer.map((s) => (
        <div className="wm-row" key={'add:' + s.name}>
          <span className="set-val" style={{ flex: 1 }}>
            {s.title || s.name}
          </span>
          <button className="btn sm secondary" disabled={busy === s.name} onClick={() => act(s.name, addDatapackToWorld(profile, world, s.name))}>
            <Icon id="i-plus" /> {t('В мир')}
          </button>
        </div>
      ))}
      <button className="btn sm ghost" onClick={onCatalog}>
        <Icon id="i-search" /> {t('Найти дата-паки')}
      </button>
    </div>
  )
}
