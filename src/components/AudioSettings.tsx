import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Select } from './Select'
import { Slider } from './Slider'
import { showToast, useUi } from '../state/ui'
import {
  canPickOutput,
  isSystemAlias,
  listAudioDevices,
  micConstraint,
  micErrorText,
  playTestTone,
  setStoredMic,
  setStoredMicProcessing,
  setStoredOutput,
  storedMic,
  storedMicProcessing,
  storedOutput,
} from '../lib/audioDevices'
import type { AudioDevice, MicProcessing } from '../lib/audioDevices'
import { setStoredMicGain, setStoredNoiseMode, storedMicGain, storedNoiseMode, type NoiseMode } from '../lib/call/mic-worklet'
import { setStoredCallVolume, storedCallVolume } from '../lib/call/audio'
import { canShareScreen, setStoredScreenQuality, storedScreenQuality, type ScreenQuality } from '../lib/call/screen'
import {
  canUseCamera,
  listCameras,
  setStoredCamera,
  setStoredCameraQuality,
  storedCamera,
  storedCameraQuality,
  type CameraDevice,
  type CameraQuality,
} from '../lib/call/camera'
import { setCallMicGain, setCallNoise, setCallProcessing, setCallVolume } from '../state/call'

const SYSTEM = { value: '', label: 'Системное по умолчанию' }

const MIC_STEPS = [
  'Разреши доступ к микрофону в системе: Windows — Параметры → Конфиденциальность → Микрофон, macOS — Системные настройки → Конфиденциальность → Микрофон.',
  'Закрой программы, которые держат микрофон: Discord, OBS, браузер с созвоном.',
  'Выбери устройство в списке выше и нажми «Проверить» — полоса должна двигаться.',
  'Если полоса стоит на месте — микрофон отключён или замьючен в самой системе.',
]

/// A meter beats any wording: a mic that shows nothing here is the mic that
/// records silence, and a test tone tells the output apart from the file.
function MicMeter({ deviceId, onFail }: { deviceId: string; onFail: () => void }) {
  const [level, setLevel] = useState(0)
  const [busy, setBusy] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => () => stopRef.current?.(), [])

  const listen = async () => {
    if (stopRef.current) {
      stopRef.current()
      stopRef.current = null
      setBusy(false)
      setLevel(0)
      return
    }
    setBusy(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraint() })
      const ctx = new AudioContext()
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      src.connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      let raf = 0
      const tick = () => {
        analyser.getFloatTimeDomainData(buf)
        let peak = 0
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
        setLevel(Math.min(1, Math.sqrt(peak) * 1.35))
        raf = requestAnimationFrame(tick)
      }
      tick()
      stopRef.current = () => {
        cancelAnimationFrame(raf)
        stream.getTracks().forEach((t) => t.stop())
        void ctx.close().catch(() => {})
      }
    } catch (error) {
      setBusy(false)
      onFail()
      showToast(micErrorText(error), 'error')
    }
  }

  return (
    <div className="aud-meter-row">
      <button className="btn sm ghost" onClick={() => void listen()}>
        <Icon id="i-mic" />
        {busy ? 'Остановить' : 'Проверить'}
      </button>
      <div className="aud-meter" key={deviceId}>
        <i style={{ width: Math.round(level * 100) + '%' }} />
      </div>
    </div>
  )
}

const NOISE_OPTIONS: { value: NoiseMode; label: string }[] = [
  { value: 'off', label: 'Выключен' },
  { value: 'standard', label: 'Обычный' },
  { value: 'strong', label: 'Сильный' },
]

const NOISE_HINT: Record<NoiseMode, string> = {
  off: 'Микрофон как есть',
  standard: 'Тишина между фразами',
  strong: 'Для шумной комнаты',
}

const SCREEN_OPTIONS: { value: ScreenQuality; label: string }[] = [
  { value: 'smooth', label: 'Плавно — 720p, 60 кадров' },
  { value: 'balanced', label: 'Поровну — 900p, 30 кадров' },
  { value: 'sharp', label: 'Чётко — 1080p, 15 кадров' },
]

const CAMERA_OPTIONS: { value: CameraQuality; label: string }[] = [
  { value: 'eco', label: 'Экономно — 360p, 20 кадров' },
  { value: 'balanced', label: 'Поровну — 480p, 24 кадра' },
  { value: 'sharp', label: 'Чётко — 720p, 30 кадров' },
]

const ON_OFF = [
  { value: 'on', label: 'Включено' },
  { value: 'off', label: 'Выключено' },
]

/// Настройки звонка меняются и во время разговора: значение уходит и в
/// хранилище, и в живой звонок, иначе его пришлось бы перезванивать.
function CallSettings() {
  const [noise, setNoise] = useState<NoiseMode>(storedNoiseMode())
  const [gain, setGain] = useState(storedMicGain())
  const [volume, setVolume] = useState(storedCallVolume())
  const [screen, setScreen] = useState<ScreenQuality>(storedScreenQuality())
  const [processing, setProcessing] = useState<MicProcessing>(storedMicProcessing())
  const [cams, setCams] = useState<CameraDevice[]>([])
  const [cam, setCam] = useState(storedCamera())
  const [camQuality, setCamQuality] = useState<CameraQuality>(storedCameraQuality())

  useEffect(() => {
    const reload = () => void listCameras().then(setCams).catch(() => {})
    reload()
    navigator.mediaDevices?.addEventListener?.('devicechange', reload)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', reload)
  }, [])

  const applyProcessing = (next: MicProcessing) => {
    setProcessing(next)
    setStoredMicProcessing(next)
    void setCallProcessing(next)
  }

  return (
    <>
      <div className="set-row">
        <span className="lab">
          Шумоподавление в звонках<small>{NOISE_HINT[noise]}</small>
        </span>
        <Select
          value={noise}
          width={230}
          options={NOISE_OPTIONS}
          onChange={(v) => {
            const mode = v as NoiseMode
            setNoise(mode)
            setStoredNoiseMode(mode)
            setCallNoise(mode)
          }}
        />
      </div>
      <div className="set-row">
        <span className="lab">
          Автоуровень микрофона
          {processing.agc ? <small>Убавляет громкость на долгой речи</small> : null}
        </span>
        <Select
          value={processing.agc ? 'on' : 'off'}
          width={230}
          options={ON_OFF}
          onChange={(v) => applyProcessing({ ...processing, agc: v === 'on' })}
        />
      </div>
      <div className="set-row">
        <span className="lab">
          Подавление эха
          <small>{processing.echo ? 'Нужно для колонок' : 'В наушниках не нужно'}</small>
        </span>
        <Select
          value={processing.echo ? 'on' : 'off'}
          width={230}
          options={ON_OFF}
          onChange={(v) => applyProcessing({ ...processing, echo: v === 'on' })}
        />
      </div>
      <div className="set-row">
        <span className="lab">
          Усиление микрофона<small>{gain}%</small>
        </span>
        <div style={{ width: 230 }}>
          <Slider
            value={gain}
            min={50}
            max={250}
            step={5}
            onChange={(v) => {
              setGain(v)
              setStoredMicGain(v)
              setCallMicGain(v)
            }}
          />
        </div>
      </div>
      <div className="set-row">
        <span className="lab">
          Громкость собеседника<small>{volume}%</small>
        </span>
        <div style={{ width: 230 }}>
          <Slider
            value={volume}
            onChange={(v) => {
              setVolume(v)
              setStoredCallVolume(v)
              setCallVolume(v)
            }}
          />
        </div>
      </div>
      {canShareScreen() ? (
        <div className="set-row">
          <span className="lab">
            Показ экрана
          </span>
          <Select
            value={screen}
            width={230}
            options={SCREEN_OPTIONS}
            onChange={(v) => {
              const q = v as ScreenQuality
              setScreen(q)
              setStoredScreenQuality(q)
            }}
          />
        </div>
      ) : (
        <div className="set-row">
          <span className="lab">
            Показ экрана<small>Недоступен в этой системе</small>
          </span>
        </div>
      )}
      {canUseCamera() ? (
        <>
          <div className="set-row">
            <span className="lab">
              Камера
              {cams.length ? null : <small>Названия скрыты до первого включения</small>}
            </span>
            <Select
              value={cam}
              width={230}
              options={[SYSTEM, ...cams.map((d) => ({ value: d.id, label: d.label }))]}
              onChange={(v) => {
                setCam(v)
                setStoredCamera(v)
              }}
            />
          </div>
          <div className="set-row">
            <span className="lab">
              Качество камеры
              <small>Встанет при следующем включении</small>
            </span>
            <Select
              value={camQuality}
              width={230}
              options={CAMERA_OPTIONS}
              onChange={(v) => {
                const q = v as CameraQuality
                setCamQuality(q)
                setStoredCameraQuality(q)
              }}
            />
          </div>
        </>
      ) : null}
    </>
  )
}

export function AudioSettings() {
  const [inputs, setInputs] = useState<AudioDevice[]>([])
  const [outputs, setOutputs] = useState<AudioDevice[]>([])
  const [named, setNamed] = useState(true)
  const [mic, setMic] = useState(storedMic())
  const [out, setOut] = useState(storedOutput())
  const [toneBusy, setToneBusy] = useState(false)
  const [micFailed, setMicFailed] = useState(false)
  const focus = useUi((s) => s.settingsFocus)
  const clearFocus = useUi((s) => s.clearSettingsFocus)
  const micRow = useRef<HTMLDivElement | null>(null)

  const reload = (probe: boolean) =>
    listAudioDevices(probe)
      .then((d) => {
        setInputs(d.inputs)
        setOutputs(d.outputs)
        setNamed(d.named)
      })
      .catch(() => {})

  useEffect(() => {
    if (isSystemAlias(storedMic())) {
      setStoredMic('')
      setMic('')
    }
    if (isSystemAlias(storedOutput())) {
      setStoredOutput('')
      setOut('')
    }
    void reload(false)
    const onChange = () => void reload(false)
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange)
  }, [])

  useEffect(() => {
    if (focus !== 'mic') return
    // The highlight fades on its own; the steps stay until the panel is left,
    // because the user came here to follow them.
    setMicFailed(true)
    micRow.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const t = setTimeout(clearFocus, 2600)
    return () => clearTimeout(t)
  }, [focus])

  // Device names are hidden until the page has held the microphone once, and a
  // list without them tells nothing apart — so it stays empty until then.
  const unnamed = !named
  const showSteps = micFailed || focus === 'mic'
  const namesBtn = (
    <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => void reload(true)}>
      Показать названия
    </button>
  )

  return (
    <>
      <div className={'set-row' + (focus === 'mic' ? ' focus-flash' : '')} ref={micRow}>
        <span className="lab">
          Микрофон
          {unnamed ? <small>Названия скрыты до первой проверки</small> : null}
        </span>
        <Select
          value={mic}
          width={230}
          options={[SYSTEM, ...inputs.map((d) => ({ value: d.id, label: d.label }))]}
          onChange={(v) => {
            setMic(v)
            setStoredMic(v)
          }}
        />
      </div>
      <div className="set-row" style={{ alignItems: 'flex-start' }}>
        <span className="lab">
          Проверка записи<small>Скажи что-нибудь — полоса должна двигаться</small>
        </span>
        <div style={{ width: 230 }}>
          <MicMeter deviceId={mic} onFail={() => setMicFailed(true)} />
          {unnamed ? namesBtn : null}
        </div>
      </div>
      {showSteps ? (
        <div className="set-row" style={{ alignItems: 'flex-start' }}>
          <span className="lab">
            Микрофон не работает
          </span>
          <ol className="set-steps">
            {MIC_STEPS.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      ) : null}
      {canPickOutput() ? (
        <>
          <div className="set-row">
            <span className="lab">
              Наушники
              {unnamed ? <small>Названия скрыты до первой проверки</small> : null}
            </span>
            <div style={{ width: 230 }}>
              <Select
                value={out}
                options={[SYSTEM, ...outputs.map((d) => ({ value: d.id, label: d.label }))]}
                onChange={(v) => {
                  setOut(v)
                  setStoredOutput(v)
                }}
              />
              {unnamed ? namesBtn : null}
            </div>
          </div>
          <div className="set-row">
            <span className="lab">
              Проверка звука
            </span>
            <button
              className="btn sm secondary"
              disabled={toneBusy}
              onClick={() => {
                setToneBusy(true)
                playTestTone()
                  .catch(() => showToast('Не удалось проиграть сигнал — устройство занято или отключено', 'error'))
                  .finally(() => setToneBusy(false))
              }}
            >
              <Icon id="i-volume" />
              {toneBusy ? 'Играет…' : 'Проверить'}
            </button>
          </div>
        </>
      ) : null}
      <div className="side-cap" style={{ padding: '10px 2px 2px' }}>
        Звонки
      </div>
      <CallSettings />
    </>
  )
}
