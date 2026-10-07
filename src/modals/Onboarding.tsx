import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { hasTauri } from '../ipc/tauri'
import { importInstance, importPackFile, scanImports } from '../ipc/commands'
import type { FoundInstance } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { showToast } from '../state/ui'
import { INVITER_STEP, ONBOARDING_STEPS, finishOnboarding, onboardingBack, onboardingNext, useOnboarding } from '../state/onboarding'
import { TOUR_STEPS } from '../state/tour'
import { getAccount, useAccounts } from '../state/accounts'
import { foundKey } from '../lib/imports'
import { setSoundMode, soundMode } from '../lib/sound'
import { setMusicAutostart } from '../state/music'
import { track } from '../lib/telemetry'
import { trackImportFailure } from '../lib/importTrack'
import { MovePanel } from './MoveBuilds'
import { autostartOn, setAutostart } from '../lib/autostart'
import { hasMillidaAccount } from '../lib/api'
import { apiErrorText } from '../lib/apiError'
import { Head } from '../components/Head'
import { dropInviteCode, lookupInviter, onboardingInvite, peekInviteCode } from '../lib/referrals'
import { INVITEE_GIFTS } from '../lib/inviteGifts'

function Welcome({ nick }: { nick: string }) {
  return (
    <>
      <div className="onb-hero">
        <img src="/millida-logo.svg" alt="" />
        <div>
          <h3>Привет{nick ? ', ' + nick : ''}!</h3>
        </div>
      </div>
      <div className="onb-list">
        <div className="onb-point">
          <Icon id="i-box2" />
          <span>
            <b>Перенесём сборки</b>
            <small>Prism, MultiMC, CurseForge и другие</small>
          </span>
        </div>
        <div className="onb-point">
          <Icon id="i-image" />
          <span>
            <b>Подберём оформление</b>
            <small>Тема, музыка, звуки</small>
          </span>
        </div>
        <div className="onb-point">
          <Icon id="i-play" />
          <span>
            <b>Покажем, где что</b>
            <small>{TOUR_STEPS.length} подсказок в конце</small>
          </span>
        </div>
      </div>
    </>
  )
}

/// «Кто тебя позвал?»: ник или код друга, можно пропустить. Подарки показаны
/// плитками — по ним видно, зачем вводить.
function InviterStep() {
  const [query, setQuery] = useState(() => peekInviteCode())
  const [found, setFound] = useState<{ nickname: string | null } | null>(null)
  const [miss, setMiss] = useState(false)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const text = query.trim()
    setFound(null)
    setMiss(false)
    if (text.length < 3) return
    const mine = ++seq.current
    const t = setTimeout(() => {
      lookupInviter(text)
        .then((r) => {
          if (mine !== seq.current) return
          if (r.found) setFound({ nickname: r.nickname })
          else setMiss(true)
        })
        .catch(() => {})
    }, 350)
    return () => clearTimeout(t)
  }, [query])

  const confirm = () => {
    if (!found || busy) return
    setBusy(true)
    onboardingInvite(query.trim())
      .then(() => {
        dropInviteCode()
        showToast('Друг найден — подарок твой', 'ok', 'achievement')
        onboardingNext(!hasMillidaAccount())
      })
      .catch((e) => showToast(apiErrorText(e, 'Не удалось применить'), 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <h3>Кто тебя позвал?</h3>
      <div className="onb-ref-gifts">
        {INVITEE_GIFTS.map((g) => (
          <div className="onb-ref-gift" key={g.id}>
            <Icon id={g.icon} />
            <b>{g.title}</b>
          </div>
        ))}
      </div>
      <div className="onb-ref-row">
        <label className="input onb-ref-input">
          <Icon id="i-user" />
          <input
            autoFocus
            placeholder="Ник или код друга"
            value={query}
            maxLength={32}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirm()
            }}
          />
        </label>
      </div>
      {found ? (
        <div className="onb-ref-found">
          <Head nick={found.nickname || undefined} size={40} />
          <b>{found.nickname || 'Игрок'}</b>
          <button className="btn md primary" data-track="onb_ref_confirm" disabled={busy} onClick={confirm}>
            <Icon id="i-check" />
            Это он
          </button>
        </div>
      ) : miss ? (
        <div className="onb-ref-miss">
          <Icon id="i-search" />
          Не нашли
        </div>
      ) : null}
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
  const [movable, setMovable] = useState(0)

  useEffect(() => {
    ;(hasTauri() ? scanImports() : Promise.resolve([] as FoundInstance[]))
      .then((all) => {
        const l = all.filter((it) => !it.movable)
        setMovable(all.length - l.length)
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
        console.error('[onb-import]', it.path, err)
        trackImportFailure(it.source, err, it)
        showToast('Не удалось перенести «' + it.name + '»', 'error')
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
        // Своя фраза бэкенда («Файл не найден», «Не удалось распаковать») — до двоеточия;
        // системный хвост и английские ошибки ОС — только в лог.
        console.error('[onb-import-file]', err)
        trackImportFailure('file', err)
        const head = String(err).split(':')[0].trim()
        showToast(/^[А-ЯЁ]/.test(head) ? head : 'Не удалось импортировать файл', 'error')
      })
      .finally(() => setFileBusy(false))
  }

  return (
    <>
      <h3>Перенесём сборки</h3>
      <div className="sub">{movable ? 'Сборки Prism и Modrinth App переедут в Millida целиком — с мирами и настройками' : 'Оригиналы останутся на месте'}</div>
      {movable ? <MovePanel /> : null}
      <div className="onb-scroll">
        {failed ? (
          <p className="faint-note">Не удалось найти сборки</p>
        ) : list === null ? (
          <p className="faint-note onb-scan">
            <span className="spin"></span>
            Ищем на дисках
          </p>
        ) : movable && !list.length ? null : list.length ? (
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
          <p className="faint-note">Других сборок не нашли</p>
        )}
      </div>
      <div className="onb-inline">
        <button className="btn sm secondary" onClick={fromFile} disabled={fileBusy || !!busy}>
          <Icon id="i-box2" /> {fileBusy ? 'Импортируем…' : 'Импорт из файла'}
        </button>
        {importable.length ? (
          <button className="btn sm primary" onClick={() => void runImport()} disabled={!selected.length || !!busy}>
            {busy ? 'Переносим…' : 'Перенести (' + selected.length + ')'}
          </button>
        ) : null}
      </div>
    </>
  )
}

function LookStep() {
  const [music, setMusic] = useState(() => localStorage.getItem('m-mus-auto') !== '0')
  const [sound, setSound] = useState(() => soundMode() !== 'off')

  return (
    <>
      <h3>Звук</h3>
      <div className="set-row">
        <span className="lab">
          Музыка
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
          Звуки
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
  const [autostart, setAuto] = useState(true)
  useEffect(() => {
    if (hasTauri()) void autostartOn().then(setAuto)
  }, [])

  return (
    <>
      <h3>Готово</h3>
      <div className="set-row">
        <span className="lab">Запускать вместе с системой</span>
        <span
          className={'tgl' + (autostart ? ' on' : '')}
          role="switch"
          aria-checked={autostart}
          id="onbAutostart"
          onClick={() => {
            const next = !autostart
            setAuto(next)
            if (hasTauri()) void setAutostart(next).then(setAuto).catch(() => setAuto(!next))
          }}
        ></span>
      </div>
      <div className="onb-list">
        <div className="onb-point">
          <Icon id="i-play" />
          <span>
            <b>Гайд по разделам</b>
            <small>{TOUR_STEPS.length} подсказок, можно прервать</small>
          </span>
        </div>
        <div className="onb-point">
          <Icon id="i-settings" />
          <span>
            <b>Повторить потом</b>
            <small>Настройки → «Показать гайд»</small>
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
        {step === INVITER_STEP ? <InviterStep /> : null}
        {step === 2 ? <ImportStep /> : null}
        {step === 3 ? <LookStep /> : null}
        {step === 4 ? <ReadyStep /> : null}

        <div className="onb-actions">
          {step > 0 ? (
            <button className="btn md secondary" onClick={() => onboardingBack(!hasMillidaAccount())}>
              Назад
            </button>
          ) : (
            <button className="btn md ghost" onClick={() => finishOnboarding(false)}>
              Пропустить
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
            <button
              className={'btn md ' + (step === INVITER_STEP ? 'secondary' : 'primary')}
              data-track={step === INVITER_STEP ? 'onb_ref_skip' : undefined}
              onClick={() => onboardingNext(!hasMillidaAccount())}
            >
              {step === 0 ? 'Поехали' : step === INVITER_STEP ? 'Пропустить' : 'Далее'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
