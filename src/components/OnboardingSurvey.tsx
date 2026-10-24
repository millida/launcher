import { useEffect, useRef, useState } from 'react'
import { Toggle } from './SetKit'
import { setTelemetryEnabled, telemetryEnabled, track } from '../lib/telemetry'
import { useT } from '../i18n'

type Answers = { heard?: string; plays?: string; license?: string }

let sent = false

/// Three optional questions and the statistics switch. Answers leave only with the player's
/// consent and only once: going back and forth through the wizard does not send them again.
export function OnboardingSurvey() {
  const t = useT()
  const [answers, setAnswers] = useState<Answers>({})
  const [stats, setStats] = useState(telemetryEnabled)
  const latest = useRef(answers)
  latest.current = answers

  useEffect(
    () => () => {
      const a = latest.current
      if (sent || !telemetryEnabled() || (!a.heard && !a.plays && !a.license)) return
      sent = true
      track('screen_view', { screen: 'onboarding-survey', heard: a.heard ?? '', plays: a.plays ?? '', license: a.license ?? '' })
    },
    [],
  )

  const questions: Array<{ key: keyof Answers; title: string; options: Array<[string, string]> }> = [
    {
      key: 'heard',
      title: t('Откуда узнал о Millida?'),
      options: [
        ['youtube', 'YouTube'],
        ['tiktok', 'TikTok'],
        ['friends', t('От друзей')],
        ['search', t('Поиск')],
        ['other', t('Другое')],
      ],
    },
    {
      key: 'plays',
      title: t('Во что больше играешь?'),
      options: [
        ['survival', t('Выживание')],
        ['mods', t('Моды и сборки')],
        ['servers', t('Сервера')],
        ['pvp', 'PvP'],
        ['build', t('Строю')],
      ],
    },
    {
      key: 'license',
      title: t('Есть лицензия Minecraft?'),
      options: [
        ['yes', t('Есть')],
        ['no', t('Нет')],
        ['unsure', t('Не знаю')],
      ],
    },
  ]

  return (
    <>
      <h3>{t('Пара вопросов')}</h3>
      {questions.map((q) => (
        <div key={q.key} className="onb-q" role="radiogroup" aria-label={q.title}>
          <span className="onb-q-title">{q.title}</span>
          <div className="segs onb-q-opts">
            {q.options.map(([value, label]) => (
              <button
                key={value}
                role="radio"
                aria-checked={answers[q.key] === value}
                className={'seg' + (answers[q.key] === value ? ' on' : '')}
                onClick={() => setAnswers((a) => ({ ...a, [q.key]: a[q.key] === value ? undefined : value }))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="set-row">
        <span className="lab">{t('Делиться анонимной статистикой')}</span>
        <Toggle
          label={t('Делиться анонимной статистикой')}
          on={stats}
          onChange={() => {
            const next = !stats
            setStats(next)
            setTelemetryEnabled(next)
          }}
        />
      </div>
    </>
  )
}
