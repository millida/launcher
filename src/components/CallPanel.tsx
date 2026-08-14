import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Head } from './Head'
import { Slider } from './Slider'
import {
  acceptCall,
  declineCall,
  fmtCallTime,
  hangUp,
  setCallVolume,
  toggleDeafen,
  toggleMute,
  toggleScreen,
  useCall,
} from '../state/call'
import { setStoredCallVolume } from '../lib/call/audio'
import { openChat } from '../state/friends'
import { canShareScreen } from '../lib/call/screen'

/// Индикатор связи: точное значение задержки в панели звонка никому не нужно,
/// нужен ответ на вопрос «нормально ли слышно».
function qualityLabel(rttMs: number | null, lossPct: number): { text: string; cls: string } {
  if (rttMs === null) return { text: 'Соединяемся', cls: 'wait' }
  if (lossPct > 8 || rttMs > 350) return { text: 'Плохая связь', cls: 'bad' }
  if (lossPct > 3 || rttMs > 180) return { text: 'Связь так себе', cls: 'mid' }
  return { text: 'Связь хорошая', cls: 'ok' }
}

function Timer({ from }: { from: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{fmtCallTime(now - from)}</>
}

function IncomingCard() {
  const nick = useCall((s) => s.peerNick)
  return (
    <div className="call-ring">
      <div className="call-ring-card">
        <Head nick={nick || 'MHF_Steve'} size={56} />
        <div className="call-ring-body">
          <b>{nick || 'Друг'}</b>
          <span>Входящий звонок</span>
        </div>
        <div className="call-ring-acts">
          <button className="btn sm primary" onClick={() => void acceptCall()}>
            <Icon id="i-phone" />
            Ответить
          </button>
          <button className="btn sm danger" onClick={() => void declineCall()}>
            <Icon id="i-phone-off" />
            Отклонить
          </button>
        </div>
      </div>
    </div>
  )
}

function ScreenView({ stream, full, onFull }: { stream: MediaStream; full: boolean; onFull: (v: boolean) => void }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = stream
    void el.play().catch(() => {})
  }, [stream, full])
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFull(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [full, onFull])
  return (
    <div className={full ? 'call-screen-full' : 'call-screen-mini'} onClick={() => onFull(!full)}>
      {/* Звук показа идёт отдельной дорожкой через свой элемент, поэтому видео
          немое: иначе он играл бы дважды. */}
      <video ref={ref} muted playsInline />
      {full ? null : <span className="call-screen-hint">Экран собеседника</span>}
      {full ? <button className="call-screen-x" title="Свернуть (Esc)"><Icon id="i-x" /></button> : null}
    </div>
  )
}

export function CallPanel() {
  const status = useCall((s) => s.status)
  const nick = useCall((s) => s.peerNick)
  const peerId = useCall((s) => s.peerId)
  const muted = useCall((s) => s.muted)
  const deafened = useCall((s) => s.deafened)
  const sharing = useCall((s) => s.sharing)
  const peerMuted = useCall((s) => s.peerMuted)
  const speaking = useCall((s) => s.speaking)
  const level = useCall((s) => s.level)
  const quality = useCall((s) => s.quality)
  const answeredAt = useCall((s) => s.answeredAt)
  const remoteScreen = useCall((s) => s.remoteScreen)
  const screenFull = useCall((s) => s.screenFull)
  const volume = useCall((s) => s.volume)
  const set = useCall((s) => s.set)
  const [volOpen, setVolOpen] = useState(false)

  if (status === 'idle') return null
  if (status === 'incoming') return <IncomingCard />

  const q = qualityLabel(quality?.rttMs ?? null, quality?.lossPct ?? 0)
  const state =
    status === 'outgoing' ? 'Звоним…' : status === 'connecting' ? 'Соединяем…' : q.text

  return (
    <>
      {remoteScreen && screenFull ? (
        <ScreenView stream={remoteScreen} full onFull={(v) => set({ screenFull: v })} />
      ) : null}
      <div className={'call-dock' + (speaking ? ' talking' : '')}>
        <button
          className="call-dock-who"
          title="Открыть переписку"
          onClick={() => void openChat(peerId, nick)}
        >
          <Head nick={nick || 'MHF_Steve'} size={34} />
          <span className="call-dock-name">
            <b>{nick || 'Друг'}</b>
            <span className={'call-dock-state ' + (status === 'active' ? q.cls : 'wait')}>
              {status === 'active' ? <Timer from={answeredAt} /> : null}
              {status === 'active' ? ' · ' : ''}
              {state}
              {peerMuted ? ' · без микрофона' : ''}
            </span>
          </span>
        </button>

        <div className="call-level" title="Твой микрофон">
          <i style={{ height: Math.round(3 + Math.min(1, Math.sqrt(level) * 1.4) * 15) + 'px' }} />
        </div>

        {remoteScreen && !screenFull ? (
          <ScreenView stream={remoteScreen} full={false} onFull={(v) => set({ screenFull: v })} />
        ) : null}

        <div className="call-dock-acts">
          <button
            className={'tb-btn' + (muted ? ' off' : '')}
            title={muted ? 'Включить микрофон' : 'Выключить микрофон'}
            onClick={toggleMute}
          >
            <Icon id={muted ? 'i-mic-off' : 'i-mic'} />
          </button>
          <button
            className={'tb-btn' + (deafened ? ' off' : '')}
            title={deafened ? 'Включить звук' : 'Заглушить звук'}
            onClick={toggleDeafen}
          >
            <Icon id={deafened ? 'i-headset-off' : 'i-headset'} />
          </button>
          {canShareScreen() ? (
            <button
              className={'tb-btn' + (sharing ? ' on' : '')}
              title={sharing ? 'Остановить показ экрана' : 'Показать экран'}
              disabled={status !== 'active'}
              onClick={() => void toggleScreen()}
            >
              <Icon id="i-screen-share" />
            </button>
          ) : null}
          <button
            className={'tb-btn' + (volOpen ? ' on' : '')}
            title="Громкость собеседника"
            onClick={() => setVolOpen((v) => !v)}
          >
            <Icon id="i-volume" />
          </button>
          <button className="btn sm danger" title="Завершить звонок" onClick={() => void hangUp()}>
            <Icon id="i-phone-off" />
          </button>
        </div>

        {volOpen ? (
          <div className="call-vol">
            <Icon id="i-volume" />
            <Slider
              value={volume}
              onChange={(v) => {
                setCallVolume(v)
                setStoredCallVolume(v)
              }}
            />
            <span>{volume}%</span>
          </div>
        ) : null}
      </div>
    </>
  )
}
