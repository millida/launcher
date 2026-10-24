import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { Icon } from './Icon'
import { applyCrashFix, openUrl } from '../ipc/commands'
import { listenGameLogStart, type CrashInfo } from '../ipc/events'
import { hasTauri } from '../ipc/tauri'
import { backdropClose } from '../lib/dismiss'
import { followGameLog } from '../lib/gameLogFeed'
import { culpritPattern, lineKind, liveLogFix, LIVE_LOG_MAX } from '../lib/liveLog'
import { readPref, writePref } from '../lib/prefs'
import { lastCrash, markFixApplied } from '../lib/repair'
import { useCrash } from '../state/crash'
import { showToast } from '../state/ui'
import { tx, useT } from '../i18n'

const PREF = 'm-live-log'
const REDRAW_MS = 150

interface LiveLogState {
  open: boolean
  profile: string
  lines: string[]
  crash: CrashInfo | null
}

const useLiveLog = create<LiveLogState>(() => ({ open: false, profile: '', lines: [], crash: null }))

let buffer: string[] = []
let redraw: ReturnType<typeof setTimeout> | null = null

const flush = () => {
  redraw = null
  useLiveLog.setState({ lines: buffer })
}

export const openLiveLog = () => useLiveLog.setState({ open: true, lines: buffer })

let started = false

/** Слушает лог с первого запуска: окно может открыться позже, а строки нужны с начала. */
export function startLiveLog() {
  if (started || !hasTauri()) return
  started = true
  void listenGameLogStart((profile) => {
    // A build that crashed last time opens the log by itself: that is when the player wants to watch it.
    const open = readPref(PREF, '0') === '1' || !!lastCrash(profile)
    useLiveLog.setState((s) => ({ profile, lines: [], crash: null, open: s.open || open }))
  })
  followGameLog(LIVE_LOG_MAX, (lines, profile) => {
    buffer = lines
    if (profile && profile !== useLiveLog.getState().profile) useLiveLog.setState({ profile })
    if (useLiveLog.getState().open && !redraw) redraw = setTimeout(flush, REDRAW_MS)
  })
  useCrash.subscribe((s) => {
    if (s.info && s.info.profile === useLiveLog.getState().profile) useLiveLog.setState({ crash: s.info })
  })
}

/** Окно живого лога запуска: ошибки цветом, виновный мод красным, после вылета — «Починить» тем же исправлением, что и окно вылета. */
export function LiveLog() {
  const t = useT()
  const { open, profile, lines, crash } = useLiveLog()
  const [fixing, setFixing] = useState(false)
  const [always, setAlways] = useState(() => readPref(PREF, '0') === '1')
  const box = useRef<HTMLPreElement>(null)
  const culprit = useMemo(() => culpritPattern(crash?.culprits ?? []), [crash])
  const fix = liveLogFix(crash?.actions)

  useEffect(() => {
    const b = box.current
    if (b) b.scrollTop = b.scrollHeight
  }, [lines, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useLiveLog.setState({ open: false })
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const close = () => useLiveLog.setState({ open: false })
  const repair = () => {
    if (!fix || !crash) return
    if (fix.kind === 'open-url') {
      openUrl(fix.arg ?? '')
      return
    }
    setFixing(true)
    applyCrashFix(crash.profile, fix.kind, fix.arg ?? '')
      .then((msg) => {
        showToast(msg, 'ok')
        markFixApplied(crash.profile, 'log:' + fix.kind)
        useCrash.getState().close()
        useLiveLog.setState({ open: false, crash: null })
        void import('../lib/autoHeal').then((h) => h.relaunchAfterFix(crash.profile))
      })
      .catch((e) => showToast(String(e), 'error'))
      .finally(() => setFixing(false))
  }

  return (
    <div className="modal-bg open vis" style={{ zIndex: 200 }} {...backdropClose(close)}>
      <div className="modal mw-lg" role="dialog" aria-labelledby="live-log-title">
        <div className="crash-head">
          <div>
            <h3 id="live-log-title">{t('Лог запуска')}</h3>
            {profile ? (
              <div className="sub" style={{ marginTop: '2px' }}>
                {profile}
              </div>
            ) : null}
          </div>
        </div>
        <pre ref={box} className="host-console" style={{ height: '360px', margin: 0 }}>
          {lines.length
            ? lines.map((line, i) => {
                const kind = lineKind(line, culprit)
                const cls = kind === 'culprit' ? 'err' : kind === 'err' ? 'lvl-err' : kind === 'warn' ? 'lvl-warn' : undefined
                return (
                  <span key={i} className={cls}>
                    {line + '\n'}
                  </span>
                )
              })
            : t('Игра ещё ничего не написала')}
        </pre>
        {crash ? <p className="crash-reason" style={{ marginTop: '12px' }}>{tx(crash.reason)}</p> : null}
        <div className="crash-acts">
          {fix ? (
            <button className="btn lg primary" data-track="live_log_fix" disabled={fixing} onClick={repair}>
              <Icon id="i-restart" /> {fixing ? t('Чиним…') : tx(fix.label)}
            </button>
          ) : null}
          <div className="crash-acts-min">
            <label className="btn md ghost">
              <input
                type="checkbox"
                checked={always}
                onChange={(e) => {
                  setAlways(e.target.checked)
                  writePref(PREF, e.target.checked ? '1' : '0')
                }}
              />{' '}
              {t('Открывать при каждом запуске')}
            </label>
            <button className="btn md ghost" onClick={close}>
              {t('Закрыть')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
