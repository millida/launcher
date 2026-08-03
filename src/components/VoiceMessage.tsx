import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { fmtVoiceTime } from '../lib/voice'
import type { ChatAttachment } from '../state/friends'

/// One element for the whole app: two voice messages playing at once is never
/// what the user meant.
let current: HTMLAudioElement | null = null

export function VoiceMessage({ att, me }: { att: ChatAttachment; me?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [failed, setFailed] = useState(false)
  const total = att.durationMs || 0
  const peaks = att.peaks && att.peaks.length ? att.peaks : null

  useEffect(
    () => () => {
      const a = audioRef.current
      if (a) {
        a.pause()
        if (current === a) current = null
      }
    },
    [],
  )

  const toggle = () => {
    let a = audioRef.current
    if (!a) {
      a = new Audio(att.url)
      a.preload = 'none'
      a.addEventListener('timeupdate', () => setAt(a!.currentTime * 1000))
      a.addEventListener('ended', () => {
        setPlaying(false)
        setAt(0)
      })
      a.addEventListener('error', () => {
        setFailed(true)
        setPlaying(false)
      })
      audioRef.current = a
    }
    if (playing) {
      a.pause()
      setPlaying(false)
      return
    }
    if (current && current !== a) current.pause()
    current = a
    a.play()
      .then(() => setPlaying(true))
      .catch(() => setFailed(true))
  }

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const a = audioRef.current
    const dur = (a && isFinite(a.duration) ? a.duration * 1000 : total) || 0
    if (!a || !dur) return
    const box = e.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
    a.currentTime = (dur * ratio) / 1000
    setAt(dur * ratio)
  }

  const done = total ? Math.min(1, at / total) : 0
  const left = total ? Math.max(0, total - at) : 0

  return (
    <div className={'voice' + (me ? ' me' : '')}>
      <button className="voice-play" onClick={toggle} title={playing ? 'Пауза' : 'Слушать'}>
        <Icon id={playing ? 'i-pause' : 'i-play'} />
      </button>
      <div className="voice-wave" onClick={seek}>
        {(peaks || Array.from({ length: 32 }, () => 24)).map((p, i, all) => (
          <i key={i} className={i / all.length < done ? 'on' : ''} style={{ height: Math.max(3, p * 0.24) + 'px' }} />
        ))}
      </div>
      <span className="voice-time">{failed ? 'нет файла' : fmtVoiceTime(playing || at ? left : total)}</span>
    </div>
  )
}
