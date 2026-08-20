import { useEffect, useState } from 'react'
import { Icon } from '../components/Icon'
import { hasTauri } from '../ipc/tauri'
import { importInstance, importPackFile, scanImports } from '../ipc/commands'
import type { FoundInstance } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { showToast } from '../state/ui'
import { ONBOARDING_STEPS, finishOnboarding, onboardingBack, onboardingNext, useOnboarding } from '../state/onboarding'
import { getAccount, useAccounts } from '../state/accounts'
import { applyTheme, storedTheme } from '../lib/theme'
import { foundKey } from '../lib/imports'
import type { ThemeId } from '../lib/theme'
import { setSoundMode, soundMode } from '../lib/sound'
import { setMusicAutostart } from '../state/music'
import { track } from '../lib/telemetry'

const THEMES: [ThemeId, string][] = [
  ['', 'Тёмная'],
  ['light', 'Светлая'],
  ['auto', 'Как в системе'],
]

function Welcome({ nick }: { nick: string }) {
  return (
    <>
      <div className="onb-hero">
        <img src="/millida-logo.svg" alt="" />
        <div>
          <h3>Привет{nick ? ', ' + nick : ''}!</h3>
          <div className="sub">Сейчас настроим лаунчер под тебя — это займёт минуту.</div>
        </div>
      </div>
      <div className="onb-list">
        <div className="onb-point">
          <Icon id="i-box2" />
          <span>
            <b>Перенесём твои сборки</b>
            <small>Из Prism, MultiMC, CurseForge, GDLauncher, ATLauncher, Modrinth и .minecraft</small>
          </span>
        </div>
        <div className="onb-point">
          <Icon id="i-image" />
          <span>
            <b>Подберём оформление</b>
            <small>Тема, музыка и звуки — всё меняется потом в настройках</small>
          </span>
        </div>
        <div className="onb-point">
          <Icon id="i-play" />
          <span>
            <b>Покажем, где что нажимать</b>
            <small>Короткий гайд по лаунчеру в конце настройки</small>
          </span>
        </div>
      </div>
    </>
  )
}

function ImportStep() {
  const profiles = useProfiles((s) => s.profiles)
  const [list, setList] = useState<FoundInstance[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')
  const [fileBusy, setFileBusy] = useState(false)

  useEffect(() => {
    ;(hasTauri() ? scanImports() : Promise.resolve([] as FoundInstance[]))
      .then((l) => {
        setList(l)
        setPicked(Object.fromEntries(l.map((it) => [foundKey(it), true])))
      })
      .catch(() => setFailed(true))
  }, [])

  const existing = new Set(profiles.map((p) => p.name))
  const importable = (list || []).filter((it) => !existing.has(it.name) && !done[foundKey(it)])
  const selected = importable.filter((it) => picked[foundKey(it)])

  const runImport = async () => {
    let ok = 0
    for (const it of selected) {
      setBusy(foundKey(it))
      try {
        const p = await importInstance(it.path, it.name, it.version, it.loader)
        track('build_import', { source: it.source, mc: it.version, loader: it.loader })
        setDone((d) => ({ ...d, [foundKey(it)]: true }))
        useProfiles.getState().setSelected(p.name)
        ok++
      } catch (err) {
        showToast('Не удалось импортировать «' + it.name + '»: ' + err, 'error')
      }
    }
    setBusy('')
    void useProfiles.getState().refresh()
    if (ok) showToast(ok === 1 ? 'Импортирована 1 сборка' : 'Импортировано сборок: ' + ok)
  }

  const fromFile = () => {
    if (fileBusy) return
    if (!hasTauri()) {
      showToast('Импорт файлом доступен в приложении лаунчера', 'error')
      return
    }
    setFileBusy(true)
    importPackFile()
      .then((p) => {
        track('build_import', { source: 'file', mc: p.version, loader: p.loader || (p.fabric ? 'fabric' : 'vanilla') })
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        showToast('Импортировано: ' + p.name)
      })
      .catch((err) => {
        if (String(err).includes('Отменено')) return
        showToast('' + err, 'error')
      })
      .finally(() => setFileBusy(false))
  }

  return (
    <>
      <h3>Перенесём сборки</h3>
      <div className="sub">Нашли сборки других лаунчеров на всех дисках. Отметь, что перенести — файлы копируются, оригинал остаётся на месте.</div>
      <div className="onb-scroll">
        {failed ? (
          <p className="faint-note">Не удалось просканировать диски. Сборки можно импортировать позже — «Сборки» → «Импорт».</p>
        ) : list === null ? (
          <p className="faint-note">Ищем сборки на дисках… Это до минуты на HDD — можно сразу жать «Далее», перенести получится и потом.</p>
        ) : list.length ? (
          list.map((it) => {
            const key = foundKey(it)
            const already = existing.has(it.name) || done[key]
            return (
              <label className={'onb-row' + (already ? ' off' : '')} key={key}>
                <input
                  type="checkbox"
                  checked={already ? true : !!picked[key]}
                  disabled={already || !!busy}
                  onChange={(e) => setPicked((p) => ({ ...p, [key]: e.target.checked }))}
                />
                <span className="onb-row-main">
                  <b>{it.name}</b>
                  <small>
                    {it.source} · {it.loader} · {it.version}
                  </small>
                </span>
                <span className="pill">{busy === key ? 'Переносим…' : already ? 'Уже в лаунчере' : 'К переносу'}</span>
              </label>
            )
          })
        ) : (
          <p className="faint-note">
            Сборок других лаунчеров не нашли. Ничего страшного — сборку можно создать с нуля или загрузить модпак прямо
            из лаунчера.
          </p>
        )}
      </div>
      <div className="onb-inline">
        <button className="btn sm secondary" onClick={fromFile} disabled={fileBusy || !!busy}>
          <Icon id="i-box2" /> {fileBusy ? 'Импортируем…' : 'Импорт из файла'}
        </button>
        {importable.length ? (
          <button className="btn sm primary" onClick={() => void runImport()} disabled={!selected.length || !!busy}>
            {busy ? 'Переносим…' : 'Перенести выбранные (' + selected.length + ')'}
          </button>
        ) : null}
      </div>
    </>
  )
}

function LookStep() {
  const [theme, setTheme] = useState<ThemeId>(storedTheme)
  const [music, setMusic] = useState(() => localStorage.getItem('m-mus-auto') !== '0')
  const [sound, setSound] = useState(() => soundMode() !== 'off')

  return (
    <>
      <h3>Под тебя</h3>
      <div className="sub">Всё это меняется потом в настройках — сейчас просто выбери, как удобнее.</div>
      <div className="set-row">
        <span className="lab">Тема</span>
        <div className="segs">
          {THEMES.map(([v, label]) => (
            <button
              key={label}
              className={'seg' + (theme === v ? ' on' : '')}
              style={{ height: '32px', fontSize: '12.5px' }}
              onClick={() => {
                setTheme(v)
                applyTheme(v)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <span className="lab">
          Музыка в лаунчере<small>Спокойные треки, пока выбираешь сборку</small>
        </span>
        <span
          className={'tgl' + (music ? ' on' : '')}
          onClick={() => {
            const next = !music
            setMusic(next)
            setMusicAutostart(next)
          }}
        ></span>
      </div>
      <div className="set-row">
        <span className="lab">
          Звуки интерфейса<small>Клики, уведомления от друзей</small>
        </span>
        <span
          className={'tgl' + (sound ? ' on' : '')}
          onClick={() => {
            const next = !sound
            setSound(next)
            setSoundMode(next ? 'all' : 'off')
          }}
        ></span>
      </div>
    </>
  )
}

function ReadyStep() {
  return (
    <>
      <h3>Готово — можно играть</h3>
      <div className="sub">Осталось короткое знакомство с лаунчером: где сборки, контент, серверы и друзья.</div>
      <div className="onb-list">
        <div className="onb-point">
          <Icon id="i-play" />
          <span>
            <b>Гайд занимает меньше минуты</b>
            <small>10 подсказок по разделам, можно прервать в любой момент</small>
          </span>
        </div>
        <div className="onb-point">
          <Icon id="i-settings" />
          <span>
            <b>Запустить заново</b>
            <small>Настройки → «Показать гайд по лаунчеру»</small>
          </span>
        </div>
      </div>
    </>
  )
}

export function OnboardingModal() {
  const open = useOnboarding((s) => s.open)
  const step = useOnboarding((s) => s.step)
  useAccounts()
  const acc = getAccount()

  useEffect(() => {
    if (open) track('screen_view', { screen: 'onboarding-' + step })
  }, [open, step])

  if (!open) return null
  const last = step === ONBOARDING_STEPS - 1

  return (
    <div className="modal-bg open vis" id="onbModal">
      <div className="modal onb-modal">
        <div className="onb-bar">
          {Array.from({ length: ONBOARDING_STEPS }, (_, i) => (
            <span key={i} className={'onb-bar-seg' + (i <= step ? ' on' : '')}></span>
          ))}
        </div>

        {step === 0 ? <Welcome nick={acc ? acc.nick : ''} /> : null}
        {step === 1 ? <ImportStep /> : null}
        {step === 2 ? <LookStep /> : null}
        {step === 3 ? <ReadyStep /> : null}

        <div className="onb-actions">
          {step > 0 ? (
            <button className="btn md secondary" onClick={onboardingBack}>
              Назад
            </button>
          ) : (
            <button className="btn md ghost" onClick={() => finishOnboarding(false)}>
              Пропустить настройку
            </button>
          )}
          <span className="tour-spacer"></span>
          {last ? (
            <>
              <button className="btn md ghost" onClick={() => finishOnboarding(false)}>
                Без гайда
              </button>
              <button className="btn md primary" onClick={() => finishOnboarding(true)}>
                <Icon id="i-play" /> Показать гайд
              </button>
            </>
          ) : (
            <button className="btn md primary" onClick={onboardingNext}>
              {step === 0 ? 'Поехали' : 'Далее'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
