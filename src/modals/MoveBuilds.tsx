import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { hasTauri } from '../ipc/tauri'
import { closeMoveSources, moveBlockers, moveInstance, planMoves } from '../ipc/commands'
import type { MoveBlocker, MoveCandidate } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { closeModal, showToast, useUi } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { backdropClose } from '../lib/dismiss'
import { track } from '../lib/telemetry'
import { liveInterval } from '../lib/liveInterval'
import { batchSummary, candidateMeta, confirmText, contentText, errorText, launchersText, moveGate, rowVerdict } from '../lib/moves'
import type { RowResult } from '../lib/moves'
import { tx, useT } from '../i18n'

/** The auto-close checkbox is remembered between openings of the window. */
const AUTO_CLOSE_KEY = 'm-move-close-source'
const readAutoClose = () => {
  try {
    return localStorage.getItem(AUTO_CLOSE_KEY) === '1'
  } catch {
    return false
  }
}
const saveAutoClose = (on: boolean) => {
  try {
    localStorage.setItem(AUTO_CLOSE_KEY, on ? '1' : '0')
  } catch (e) {
    console.warn('[move] the auto-close choice was not saved', e)
  }
}
/** How often the panel asks the core whether the source launcher is still open. */
const BLOCKERS_POLL_MS = 2000

/** The core copies and checks worlds and mods against the source; the build in the other launcher is never changed. */
export function MovePanel() {
  const t = useT()
  const [list, setList] = useState<MoveCandidate[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')
  const [results, setResults] = useState<Record<string, RowResult>>({})
  const [blockers, setBlockers] = useState<MoveBlocker[]>([])
  const [autoClose, setAutoClose] = useState(readAutoClose)
  const [closing, setClosing] = useState(false)

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
  const movable = (list || []).filter((c) => !moved(c))
  const selected = movable.filter((c) => picked[c.path])
  const allPicked = movable.length > 0 && selected.length === movable.length
  const toggleAll = () => setPicked((p) => ({ ...p, ...Object.fromEntries(movable.map((c) => [c.path, !allPicked])) }))
  const paths = selected.map((c) => c.path)
  const pathsKey = paths.join('\n')
  const gate = moveGate(blockers, autoClose)

  // Whether the source launcher or a game from a picked build is open: the button wakes up once they close.
  const askSeq = useRef(0)
  const askBlockers = (forPaths: string[]) => {
    const seq = ++askSeq.current
    if (!hasTauri() || !forPaths.length) return setBlockers([])
    moveBlockers(forPaths)
      .then((b) => {
        if (seq === askSeq.current) setBlockers(b)
      })
      .catch((e) => console.warn('[move-blockers]', e))
  }
  useEffect(() => {
    if (busy) return
    const forPaths = pathsKey ? pathsKey.split('\n') : []
    const check = () => askBlockers(forPaths)
    check()
    const stop = liveInterval(check, BLOCKERS_POLL_MS)
    window.addEventListener('focus', check)
    return () => {
      stop()
      window.removeEventListener('focus', check)
      askSeq.current++
    }
  }, [pathsKey, busy])

  // The select-all row: indeterminate when only some builds are picked.
  const allRef = useRef<HTMLInputElement>(null)
  const somePicked = selected.length > 0 && !allPicked
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = somePicked
  }, [somePicked, list])

  const toggleAutoClose = () => {
    saveAutoClose(!autoClose)
    setAutoClose(!autoClose)
  }

  const run = async () => {
    if (!selected.length || busy || closing || !gate.ok) return
    const yes = await uiConfirm(confirmText(selected), {
      title: t('Скопировать в Millida'),
      confirmLabel: t('Скопировать'),
      danger: false,
    })
    if (!yes) return
    if (autoClose && blockers.some((b) => !b.game)) {
      setClosing(true)
      try {
        const left = await closeMoveSources(paths)
        if (left.length) {
          showToast(t('Не получилось закрыть {where} — закрой вручную', { where: launchersText(left.map((l) => ({ launcher: tx(l) }))) }), 'error')
          return askBlockers(paths)
        }
      } catch (e) {
        console.error('[move-close]', e)
        showToast(errorText(e), 'error')
        return
      } finally {
        setClosing(false)
      }
    }
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

  if (failed) return <p className="faint-note">{t('Не получилось поискать сборки Prism и Modrinth App')}</p>
  if (list === null)
    return (
      <p className="faint-note onb-scan">
        <span className="spin"></span>
        {t('Ищем сборки Prism и Modrinth App')}
      </p>
    )
  if (!list.length) return null

  const where = launchersText(list)
  return (
    <>
      {movable.length > 1 ? (
        <label className="onb-row onb-all">
          <input ref={allRef} type="checkbox" checked={allPicked} disabled={!!busy} onChange={toggleAll} />
          <span className="onb-row-main">
            <b>{t('Выбрать все')}</b>
          </span>
          <span className="pill">
            {selected.length} / {movable.length}
          </span>
        </label>
      ) : null}
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
              <span className="pill">{busy === c.path ? t('Переносим…') : r ? rowVerdict(r) : t('К переносу')}</span>
            </label>
          )
        })}
      </div>
      <div className="onb-inline">
        <div className="onb-inline-start">
          <label
            className="faint-note"
            role="checkbox"
            aria-checked={autoClose}
            tabIndex={0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}
            onClick={(e) => {
              e.preventDefault()
              if (!busy && !closing) toggleAutoClose()
            }}
            onKeyDown={(e) => {
              if (e.key !== ' ' && e.key !== 'Enter') return
              e.preventDefault()
              if (!busy && !closing) toggleAutoClose()
            }}
          >
            <span className={'chk' + (autoClose ? ' on' : '')}></span>
            {t('Закрыть {where} перед переносом', { where })}
          </label>
          {!gate.ok ? <span className="faint-note">{t('Закрой {where} перед переносом', { where: gate.holder })}</span> : null}
        </div>
        <button className="btn sm primary" onClick={() => void run()} disabled={!selected.length || !!busy || closing || !gate.ok}>
          <Icon id="i-download" /> {busy || closing ? t('Переносим…') : t('Перенести ({n})', { n: selected.length })}
        </button>
      </div>
    </>
  )
}

export function MoveBuildsModal() {
  const t = useT()
  const modal = useUi((s) => s.modals.mvModal)
  if (!modal.open) return null
  const close = () => closeModal('mvModal')
  return (
    <div className={'modal-bg' + (modal.open ? ' open' : '') + (modal.vis ? ' vis' : '')} id="mvModal" {...backdropClose(close)}>
      <div className="modal mw-md">
        <h3>{t('Перенести всё в Millida')}</h3>
        <div className="sub">{t('Миры, моды, настройки, скриншоты и серверы переедут вместе со сборкой')}</div>
        <MovePanel />
        <div style={{ display: 'flex', marginTop: '14px', justifyContent: 'flex-end' }}>
          <button className="btn md secondary" data-sound="close" onClick={close}>
            {t('Закрыть')}
          </button>
        </div>
      </div>
    </div>
  )
}
