import { useCallback, useEffect, useState } from 'react'
import { apiErrorText } from '../lib/apiError'
import { Icon } from './Icon'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { loadProfileSettings, setAutoTune, tuneProfile, type Tuning } from '../ipc/commands'
import { useT } from '../i18n'

interface Props {
  profile: string
  /// Manual memory from the build slider, in GB; 0 means the tuner decides.
  manualGb: number
}

/// Auto memory and JVM flags, with the reasoning visible. The numbers matter
/// less than the explanation: two gigabytes for 180 mods is the most common
/// cause of a build that crashes on the loading screen, and a player only
/// stops setting it by hand once they see why.
export function TunePanel({ profile, manualGb }: Props) {
  const t = useT()
  const [tuning, setTuning] = useState<Tuning | null>(null)
  const [on, setOn] = useState(true)
  const [showFlags, setShowFlags] = useState(false)

  const load = useCallback(() => {
    if (!hasTauri()) return
    void tuneProfile(profile).then(setTuning).catch(() => {})
    void loadProfileSettings(profile)
      .then((s) => setOn((s as { autoTune?: boolean }).autoTune !== false))
      .catch(() => {})
  }, [profile])

  useEffect(load, [load])

  if (!tuning) return null
  const overridden = manualGb > 0
  return (
    <div className="set-row" style={{ alignItems: 'flex-start' }}>
      <span className="lab">
        {t('Авто-подбор памяти')}
        <small>
          {overridden
            ? t('Вручную {manual} ГБ · авто дал бы {auto} ГБ', { manual: manualGb, auto: Math.round(tuning.ramMb / 1024) })
            : on
              ? t('{n} ГБ памяти', { n: Math.round(tuning.ramMb / 1024) })
              : t('Выключен — половина ОЗУ')}
        </small>
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '320px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            className={'tgl' + (on ? ' on' : '')}
            onClick={() => {
              const next = !on
              setOn(next)
              setAutoTune(profile, next)
                .then(load)
                .catch((err) => {
                  setOn(!next)
                  showToast(apiErrorText(err, t('Не сохранилось')), 'error')
                })
            }}
          ></span>
        </span>
        <ul className="tune-why">
          {tuning.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <button className="crash-toggle" onClick={() => setShowFlags((v) => !v)}>
          <Icon id={showFlags ? 'i-chev-d' : 'i-chev-r'} /> {showFlags ? t('Скрыть флаги') : t('Флаги JVM')}
        </button>
        {showFlags ? <pre className="host-console crash-tail">{tuning.flags.join('\n')}</pre> : null}
      </div>
    </div>
  )
}
