import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { Select } from './Select'
import { showToast, useUi } from '../state/ui'
import {
  canPickOutput,
  listAudioDevices,
  micConstraint,
  playTestTone,
  setStoredMic,
  setStoredOutput,
  storedMic,
  storedOutput,
} from '../lib/audioDevices'
import type { AudioDevice } from '../lib/audioDevices'

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
    } catch {
      setBusy(false)
      onFail()
      showToast('Микрофон недоступен — проверь, не занят ли он другой программой', 'error')
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
          Микрофон<small>С него записываются голосовые сообщения в чате</small>
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
              Наушники<small>Куда проигрывать голосовые сообщения</small>
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
    </>
  )
}
