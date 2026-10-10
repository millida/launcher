import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icon } from './Icon'
import { Block, Group, Row, Segs, Toggle } from './SetKit'
import { agoText, fmtSize } from '../lib/format'
import { hasTauri, tauri } from '../ipc/tauri'
import { uiConfirm } from '../state/confirm'
import { showToast } from '../state/ui'
import {
  rewindClips,
  rewindDeleteClip,
  rewindOpenFolder,
  rewindRevealClip,
  rewindSetSettings,
  rewindState,
  type ClipFile,
  type RewindQuality,
  type RewindSettings,
  type RewindState,
} from '../ipc/commands'
import { listenRewindClip, listenRewindState } from '../ipc/events'
import { hotkeyFromEvent } from '../lib/rewindHotkey'

const SECONDS: [number, string][] = [
  [15, '15 с'],
  [30, '30 с'],
  [60, '1 мин'],
  [120, '2 мин'],
]

const QUALITY: [RewindQuality, string][] = [
  ['720p', '720p'],
  ['1080p', '1080p'],
  ['native', 'Как в игре'],
]

const FPS: [number, string][] = [
  [30, '30'],
  [60, '60'],
]

const clock = (ms: number) => {
  const s = Math.round(ms / 1000)
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

function HotkeyButton({ value, onPick }: { value: string; onPick: (combo: string) => void }) {
  const [listening, setListening] = useState(false)
  const onKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!listening) return
    e.preventDefault()
    if (e.key === 'Escape') {
      setListening(false)
      return
    }
    const combo = hotkeyFromEvent(e.nativeEvent)
    if (!combo) return
    setListening(false)
    onPick(combo)
  }
  return (
    <button
      className="btn sm ghost"
      aria-label="Сменить клавишу клипа"
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
      onKeyDown={onKey}
    >
      {listening ? 'Нажми сочетание' : <kbd className="s2-kbd">{value}</kbd>}
    </button>
  )
}

export function RewindClips() {
  const [state, setState] = useState<RewindState | null>(null)
  const [clips, setClips] = useState<ClipFile[]>([])
  const [loading, setLoading] = useState(hasTauri)
  const seq = useRef(0)
  const saveSeq = useRef(0)

  const loadClips = useCallback(() => {
    if (!hasTauri()) {
      setLoading(false)
      return
    }
    const mine = ++seq.current
    rewindClips()
      .then((list) => mine === seq.current && setClips(list))
      .catch((e) => showToast('' + e, 'error'))
      .finally(() => mine === seq.current && setLoading(false))
  }, [])

  useEffect(() => {
    if (!hasTauri()) return
    rewindState()
      .then(setState)
      .catch((e) => showToast('' + e, 'error'))
    loadClips()
    const offState = listenRewindState(setState)
    const offClip = listenRewindClip((c) => {
      if (c.ok) loadClips()
    })
    return () => {
      void offState.then((off) => off?.())
      void offClip.then((off) => off?.())
    }
  }, [loadClips])

  const save = (patch: Partial<RewindSettings>) => {
    if (!state) return
    const before = state
    const mine = ++saveSeq.current
    setState({ ...state, settings: { ...state.settings, ...patch } })
    rewindSetSettings({ ...state.settings, ...patch })
      .then((next) => mine === saveSeq.current && setState(next))
      .catch((e) => {
        if (mine === saveSeq.current) setState(before)
        showToast('' + e, 'error')
      })
  }

  const src = (clip: ClipFile) => tauri()?.core.convertFileSrc?.(clip.path) ?? ''

  const s = state?.settings
  const supported = state?.supported ?? false
  const status = state?.status
  const problem = status?.hotkeyProblem || status?.videoProblem || null

  return (
    <>
      <Group title="Rewind">
        <Row
          title="Запись последних секунд"
          hint={supported ? (problem ?? <kbd className="s2-kbd">{s?.hotkey ?? 'Alt+F10'}</kbd>) : 'Только Windows'}
          keys="rewind клипы запись повтор видео"
        >
          <Toggle
            label="Запись последних секунд"
            on={!!s?.enabled}
            disabled={!supported || !s}
            onChange={() => supported && s && save({ enabled: !s.enabled })}
          />
        </Row>
        {s && supported ? (
          <>
            <Row title="Длина клипа" keys="длительность секунды">
              <Segs<number> value={s.seconds} options={SECONDS} onPick={(v) => save({ seconds: v })} />
            </Row>
            <Row title="Качество" keys="разрешение 720 1080">
              <Segs<RewindQuality> value={s.quality} options={QUALITY} onPick={(v) => save({ quality: v })} />
            </Row>
            <Row title="Кадров в секунду" keys="fps частота">
              <Segs<number> value={s.fps} options={FPS} onPick={(v) => save({ fps: v })} />
            </Row>
            <Row title="Звук игры" hint={status?.audioProblem ?? undefined} keys="звук аудио">
              <Toggle label="Звук игры" on={s.gameAudio} onChange={() => save({ gameAudio: !s.gameAudio })} />
            </Row>
            <Row title="Микрофон" keys="микрофон голос">
              <Toggle label="Микрофон" on={s.mic} onChange={() => save({ mic: !s.mic })} />
            </Row>
            <Row title="Сохранить клип" keys="клавиша горячая сочетание">
              <HotkeyButton value={s.hotkey} onPick={(hotkey) => save({ hotkey })} />
            </Row>
          </>
        ) : null}
      </Group>

      <Block keys="клипы видео папка">
        <Group title="Клипы">
          <div className="s2-row">
            <span className="s2-lab">
              <b>{clips.length ? clips.length + ' в папке' : 'Millida Clips'}</b>
            </span>
            <div className="s2-ctl">
              <button className="btn sm ghost" onClick={() => rewindOpenFolder().catch((e) => showToast('' + e, 'error'))}>
                <Icon id="i-folder" /> Папка
              </button>
            </div>
          </div>
          {loading ? (
            <div className="shot-grid" aria-busy="true">
              <span className="skel bx-skel-shot" />
              <span className="skel bx-skel-shot" />
              <span className="skel bx-skel-shot" />
            </div>
          ) : clips.length === 0 ? (
            <div className="bx-mini-empty">
              <Icon id="i-play" />
              <b>Клипов пока нет</b>
              <span>
                В игре жми <kbd className="bx-kbd">{s?.hotkey ?? 'Alt+F10'}</kbd>
              </span>
            </div>
          ) : (
            <div className="shot-grid">
              {clips.map((clip) => (
                <figure className="shot-card" key={clip.path}>
                  <video className="shot-thumb" src={src(clip)} preload="metadata" controls />
                  <figcaption>
                    <b>{clip.name.replace(/\.mp4$/i, '')}</b>
                    <span>
                      {[agoText(clip.createdAt), clip.durationMs ? clock(clip.durationMs) : '', fmtSize(clip.sizeBytes)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </figcaption>
                  <div className="shot-acts">
                    <button
                      className="icon-btn"
                      aria-label="Показать в папке"
                      onClick={() => rewindRevealClip(clip.name).catch((e) => showToast('' + e, 'error'))}
                    >
                      <Icon id="i-folder" />
                    </button>
                    <button
                      className="icon-btn del"
                      aria-label="Удалить"
                      onClick={() => {
                        void uiConfirm('Удалить клип «' + clip.name + '»?', { confirmLabel: 'Удалить' }).then((ok) => {
                          if (!ok) return
                          rewindDeleteClip(clip.name)
                            .then(loadClips)
                            .catch((e) => showToast('' + e, 'error'))
                        })
                      }}
                    >
                      <Icon id="i-trash" />
                    </button>
                  </div>
                </figure>
              ))}
            </div>
          )}
        </Group>
      </Block>
    </>
  )
}
