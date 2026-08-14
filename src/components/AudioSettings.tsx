import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Select } from './Select'
import { Slider } from './Slider'
import { showToast, useUi } from '../state/ui'
import {
  canPickOutput,
  listAudioDevices,
  micConstraint,
  micErrorText,
  playTestTone,
  setStoredMic,
  setStoredOutput,
  storedMic,
  storedOutput,
} from '../lib/audioDevices'
import type { AudioDevice } from '../lib/audioDevices'
import { setStoredMicGain, setStoredNoiseMode, storedMicGain, storedNoiseMode, type NoiseMode } from '../lib/call/mic-worklet'
import { setStoredCallVolume, storedCallVolume } from '../lib/call/audio'
import { SCREEN_PRESETS, canShareScreen, setStoredScreenQuality, storedScreenQuality, type ScreenQuality } from '../lib/call/screen'
import { setCallMicGain, setCallNoise, setCallVolume } from '../state/call'

const SYSTEM = { value: '', label: 'Системное по умолчанию' }

const MIC_STEPS = [
  'Разреши доступ к микрофону в системе: Windows — Параметры → Конфиденциальность → Микрофон, macOS — Системные настройки → Конфиденциальность → Микрофон.',
  'Закрой программы, которые держат микрофон: Discord, OBS, браузер с созвоном.',
  'Выбери устройство в списке выше и нажми «Проверить микрофон» — полоса должна двигаться.',
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
        {busy ? 'Остановить' : 'Проверить микрофон'}
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
  off: 'Остаётся только шумоподавление системы',
  standard: 'Тишина между фразами, речь не режется',
  strong: 'Для шумной комнаты: механическая клавиатура, вентилятор',
}

const SCREEN_OPTIONS: { value: ScreenQuality; label: string }[] = [
  { value: 'smooth', label: 'Плавно — 720p, 60 кадров' },
  { value: 'balanced', label: 'Поровну — 900p, 30 кадров' },
  { value: 'sharp', label: 'Чётко — 1080p, 15 кадров' },
]

/// Настройки звонка меняются и во время разговора: значение уходит и в
/// хранилище, и в живой звонок, иначе его пришлось бы перезванивать.
function CallSettings() {
  const [noise, setNoise] = useState<NoiseMode>(storedNoiseMode())
  const [gain, setGain] = useState(storedMicGain())
  const [volume, setVolume] = useState(storedCallVolume())
  const [screen, setScreen] = useState<ScreenQuality>(storedScreenQuality())
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
          Усиление микрофона<small>{gain}% — подними, если тебя плохо слышно</small>
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
            Показ экрана<small>
              До {SCREEN_PRESETS[screen].height}p, {SCREEN_PRESETS[screen].fps} кадров в секунду
            </small>
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
            Показ экрана<small>Недоступен в этой сборке системы — движок не отдаёт экран</small>
          </span>
        </div>
      )}
    </>
  )
}

export function AudioSettings() {
  const [inputs, setInputs] = useState<AudioDevice[]>([])
  const [outputs, setOutputs] = useState<AudioDevice[]>([])
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
      })
      .catch(() => {})

  useEffect(() => {
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

  // Device names are hidden until the page has held the microphone once.
  const unnamed = inputs.length > 0 && inputs.every((d) => /^Микрофон \d+$/.test(d.label))
  const showSteps = micFailed || focus === 'mic'

  return (
    <>
      <div className={'set-row' + (focus === 'mic' ? ' focus-flash' : '')} ref={micRow}>
        <span className="lab">
          Микрофон<small>С него идут голосовые сообщения и голос в звонках</small>
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
          {unnamed ? (
            <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => void reload(true)}>
              Показать названия устройств
            </button>
          ) : null}
        </div>
      </div>
      {showSteps ? (
        <div className="set-row" style={{ alignItems: 'flex-start' }}>
          <span className="lab">
            Микрофон не работает
            <small>Пройди по шагам — почти всегда дело в одном из них</small>
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
              Наушники<small>Куда проигрывать звонки, голосовые и сигналы</small>
            </span>
            <Select
              value={out}
              width={230}
              options={[SYSTEM, ...outputs.map((d) => ({ value: d.id, label: d.label }))]}
              onChange={(v) => {
                setOut(v)
                setStoredOutput(v)
              }}
            />
          </div>
          <div className="set-row">
            <span className="lab">
              Проверка звука<small>Короткий сигнал в выбранное устройство</small>
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
