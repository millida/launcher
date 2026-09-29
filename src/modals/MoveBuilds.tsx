import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { hasTauri } from '../ipc/tauri'
import { moveInstance, planMoves } from '../ipc/commands'
import type { MoveCandidate } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { closeModal, showToast, useUi } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { backdropClose } from '../lib/dismiss'
import { track } from '../lib/telemetry'
import { batchSummary, candidateMeta, confirmText, contentText, errorText, launchersText, rowVerdict } from '../lib/moves'
import type { RowResult } from '../lib/moves'

/** The core copies and checks worlds and mods against the source; the build in the other launcher is never changed. */
export function MovePanel() {
  const [list, setList] = useState<MoveCandidate[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState<Record<string, RowResult>>({})

  useEffect(() => {
    let alive = true
    ;(hasTauri() ? planMoves() : Promise.resolve([] as MoveCandidate[]))
      .then((l) => {
        if (!alive) return
        setList(l)
        setPicked(Object.fromEntries(l.map((c) => [c.path, true])))
      })
      .catch((e) => {
        console.error('[move-plan]', e)
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const moved = (c: MoveCandidate) => results[c.path]?.kind === 'ok'
  const selected = (list || []).filter((c) => picked[c.path] && !moved(c))

  const run = async () => {
    if (!selected.length || busy) return
    const yes = await uiConfirm(confirmText(selected), {
      title: 'Скопировать в Millida',
      confirmLabel: 'Скопировать',
      danger: false,
    })
    if (!yes) return
    const batch: RowResult[] = []
    for (const c of selected) {
      setBusy(c.path)
      let r: RowResult
      try {
        const outcome = await moveInstance(c.path)
        r = { kind: 'ok', outcome }
        track('build_import', { source: c.launcher, mc: c.version, loader: c.loader })
        useProfiles.getState().setSelected(outcome.profile.name)
      } catch (e) {
        console.error('[move]', e)
        r = { kind: 'error', text: errorText(e) }
      }
      batch.push(r)
      setResults((m) => ({ ...m, [c.path]: r }))
    }
    setBusy('')
    await useProfiles.getState().refresh()
    const sum = batchSummary(batch)
    showToast(sum.text, sum.kind, sum.kind === 'ok' ? 'achievement' : undefined)
  }

  if (failed) return <p className="faint-note">Не получилось поискать сборки Prism и Modrinth App</p>
  if (list === null)
    return (
      <p className="faint-note onb-scan">
        <span className="spin"></span>
        Ищем сборки Prism и Modrinth App
      </p>
    )
  if (!list.length) return null

  const where = launchersText(list)
  return (
    <>
      <div className="onb-scroll">
        {list.map((c) => {
          const r = results[c.path]
          const done = r?.kind === 'ok'
          return (
            <label className={'onb-row' + (done ? ' off' : '')} key={c.path}>
              <input
                type="checkbox"
                checked={done || !!picked[c.path]}
                disabled={done || !!busy}
                onChange={(e) => setPicked((p) => ({ ...p, [c.path]: e.target.checked }))}
              />
              <span className="onb-row-main">
                <b>{c.name}</b>
                <small>{candidateMeta(c) + ' · ' + contentText(c)}</small>
                {r?.kind === 'error' ? <small>{r.text}</small> : null}
              </span>
              <span className="pill">{busy === c.path ? 'Переносим…' : r ? rowVerdict(r) : 'К переносу'}</span>
            </label>
          )
        })}
      </div>
      <div className="onb-inline">
        <span className="faint-note">Закрой {where} перед переносом</span>
        <button className="btn sm primary" onClick={() => void run()} disabled={!selected.length || !!busy}>
          <Icon id="i-download" /> {busy ? 'Переносим…' : 'Перенести (' + selected.length + ')'}
        </button>
      </div>
    </>
  )
}

export function MoveBuildsModal() {
  const modal = useUi((s) => s.modals.mvModal)
  if (!modal.open) return null
  const close = () => closeModal('mvModal')
  return (
    <div className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')} id="mvModal" {...backdropClose(close)}>
      <div className="modal mw-md">
        <h3>Перенести всё в Millida</h3>
        <div className="sub">Миры, моды, настройки, скриншоты и серверы переедут вместе со сборкой</div>
        <MovePanel />
        <div style={{ display: 'flex', marginTop: '14px', justifyContent: 'flex-end' }}>
          <button className="btn md secondary" data-sound="close" onClick={close}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  )
}
