import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { fmtVoiceTime } from '../lib/voice'
import { applyOutput } from '../lib/audioDevices'
import type { ChatAttachment } from '../state/friends'

/// One element for the whole app: two voice messages playing at once is never
/// what the user meant.
let current: HTMLAudioElement | null = null

/// A silent player is the worst outcome: the reason decides what to fix, and
/// the codes are the only thing the element ever tells us.
function mediaErrorText(err: MediaError | null): string {
  switch (err?.code) {
    case MediaError.MEDIA_ERR_NETWORK:
      return 'сеть'
    case MediaError.MEDIA_ERR_DECODE:
      return 'битый файл'
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'не открылся'
    default:
      return 'ошибка'
  }
}

/// The envelope is recorded at 48 points, but the bubble is ~200px wide: drawn
/// as is, the bars collapse into a solid block. Buckets are merged by peak so
/// the loud parts stay loud.
const WAVE_BARS = 26

function downsample(peaks: number[] | undefined, count: number): number[] {
  if (!peaks || !peaks.length) return Array.from({ length: count }, () => 20)
  if (peaks.length <= count) return peaks
  const per = peaks.length / count
  return Array.from({ length: count }, (_, i) => {
    let max = 0
    for (let k = Math.floor(i * per); k < Math.floor((i + 1) * per) && k < peaks.length; k++) {
      max = Math.max(max, peaks[k])
    }
    return max
  })
}

export function VoiceMessage({ att, me }: { att: ChatAttachment; me?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [at, setAt] = useState(0)
  const [failed, setFailed] = useState('')
  const total = att.durationMs || 0
  const peaks = downsample(att.peaks, WAVE_BARS)

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
        setPlaying(false)
        setFailed(mediaErrorText(a!.error))
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
    setFailed('')
    const el = a
    void applyOutput(el).then(() =>
      el
        .play()
        .then(() => setPlaying(true))
        .catch((e: Error) => setFailed(e.name === 'NotAllowedError' ? 'нет доступа' : 'не играет')),
    )
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
      <button
        className={'voice-play' + (playing ? '' : ' is-play')}
        onClick={toggle}
        title={playing ? 'Пауза' : 'Слушать'}
      >
        <Icon id={playing ? 'i-pause' : 'i-play'} />
      </button>
      <div className="voice-wave" onClick={seek}>
        {peaks.map((p, i, all) => (
          <i key={i} className={i / all.length < done ? 'on' : ''} style={{ height: Math.max(3, p * 0.24) + 'px' }} />
        ))}
      </div>
      <span className={'voice-time' + (failed ? ' bad' : '')} title={failed ? att.url : undefined}>
        {failed || fmtVoiceTime(playing || at ? left : total)}
      </span>
    </div>
  )
}
