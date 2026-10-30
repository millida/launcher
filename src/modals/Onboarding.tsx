import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { hasTauri } from '../ipc/tauri'
import { importInstance, importPackFile, scanImports, tlauncherNick } from '../ipc/commands'
import type { FoundInstance } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { showToast } from '../state/ui'
import { INVITER_STEP, ONBOARDING_STEPS, finishOnboarding, onboardingBack, onboardingNext, useOnboarding } from '../state/onboarding'
import { TOUR_STEPS } from '../state/tour'
import { getAccount, isOfflineNick, useAccounts } from '../state/accounts'
import { foundKey } from '../lib/imports'
import { setSoundMode, soundMode } from '../lib/sound'
import { musicAutostartOn, setMusicAutostart, useMusic } from '../state/music'
import { track } from '../lib/telemetry'
import { trackImportFailure } from '../lib/importTrack'
import { MovePanel } from './MoveBuilds'
import { autostartOn, setAutostart } from '../lib/autostart'
import { hasMillidaAccount } from '../lib/api'
import { apiErrorText } from '../lib/apiError'
import { Head } from '../components/Head'
import { dropInviteCode, lookupInviter, onboardingInvite, peekInviteCode } from '../lib/referrals'
import { INVITEE_GIFTS } from '../lib/inviteGifts'
import { t, useT } from '../i18n'
import { isPickCancelled } from '../lib/coreErrors'
import { OnboardingSurvey } from '../components/OnboardingSurvey'
import { PcStep } from '../components/GfxPresets'
import { globalChoice, setGlobalChoice, type GfxChoice } from '../lib/gfxPresets'
import { GRAPHICS_PRESETS_PUBLIC } from '../lib/graphicsRelease'

function Welcome({ nick }: { nick: string }) {
  const t = useT()
  return (
    <>
      <div className="onb-hero">
        <img src="/millida-logo.svg" alt="" />
        <div>
          <h3>{nick ? t('Привет, {nick}!', { nick }) : t('Привет!')}</h3>
        </div>
      </div>
      <div className="onb-list">
        <div className="onb-point">
          <Icon id="i-box2" />
          <span>
            <b>{t('Перенесём сборки')}</b>
            <small>{t('Prism, MultiMC, CurseForge и другие')}</small>
          </span>
        </div>
        <div className="onb-point">
          <Icon id="i-image" />
          <span>
            <b>{t('Подберём оформление')}</b>
            <small>{t('Тема, музыка, звуки')}</small>
          </span>
        </div>
        <div className="onb-point">
          <Icon id="i-play" />
          <span>
            <b>{t('Покажем, где что')}</b>
            <small>{t('{n} подсказок в конце', { n: TOUR_STEPS.length })}</small>
          </span>
        </div>
      </div>
    </>
  )
}

/// «Кто тебя позвал?»: код друга, можно пропустить. Подарки показаны
/// плитками — по ним видно, зачем вводить.
function InviterStep() {
  const t = useT()
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
    const timer = setTimeout(() => {
      lookupInviter(text)
        .then((r) => {
          if (mine !== seq.current) return
          if (r.found) setFound({ nickname: r.nickname })
          else setMiss(true)
        })
        .catch(() => {})
    }, 350)
    return () => clearTimeout(timer)
  }, [query])

  const confirm = () => {
    if (!found || busy) return
    setBusy(true)
    onboardingInvite(query.trim())
      .then(() => {
        dropInviteCode()
        showToast(t('Друг найден — подарок твой'), 'ok', 'achievement')
        onboardingNext(!hasMillidaAccount())
      })
      .catch((e) => showToast(apiErrorText(e, t('Не удалось применить')), 'error'))
      .finally(() => setBusy(false))
  }

  return (
    <>
      <h3>{t('Кто тебя позвал?')}</h3>
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
            placeholder={t('Код друга')}
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
          <b>{found.nickname || t('Игрок')}</b>
          <button className="btn md primary" data-track="onb_ref_confirm" disabled={busy} onClick={confirm}>
            <Icon id="i-check" />
            {t('Это он')}
          </button>
        </div>
      ) : miss ? (
        <div className="onb-ref-miss">
          <Icon id="i-search" />
          {t('Не нашли')}
        </div>
      ) : null}
    </>
  )
}

function ImportStep() {
  const t = useT()
  const profiles = useProfiles((s) => s.profiles)
  const [list, setList] = useState<FoundInstance[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState('')
  const [fileBusy, setFileBusy] = useState(false)
  const [movable, setMovable] = useState(0)
  const [tlNick, setTlNick] = useState('')
  const [tlDone, setTlDone] = useState(false)

  useEffect(() => {
    if (hasTauri())
      tlauncherNick()
        .then((n) => setTlNick(n && isOfflineNick(n) ? n : ''))
        .catch((e) => console.warn('[onb-import] TLauncher nick', e))
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
  const allPicked = importable.length > 0 && selected.length === importable.length
  const toggleAll = () => setPicked((p) => ({ ...p, ...Object.fromEntries(importable.map((it) => [foundKey(it), !allPicked])) }))

  const runImport = async (list: FoundInstance[] = selected) => {
    let ok = 0
    for (const it of list) {
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
        showToast(t('Не удалось перенести «{name}»', { name: it.name }), 'error')
      }
    }
    setBusy('')
    void useProfiles.getState().refresh()
    if (ok) showToast(ok === 1 ? t('Импортирована 1 сборка') : t('Импортировано сборок: {n}', { n: ok }))
  }

  const tlBuilds = importable.filter(fromTlauncher)
  const fromTl = () => {
    setTlDone(true)
    setPicked((p) => ({ ...p, ...Object.fromEntries(importable.map((it) => [foundKey(it), fromTlauncher(it)])) }))
    if (tlNick) keepNick(tlNick)
    if (tlBuilds.length) void runImport(tlBuilds)
  }

  const fromFile = () => {
    if (fileBusy) return
    if (!hasTauri()) {
      showToast(t('Импорт файлом доступен в приложении лаунчера'), 'error')
      return
    }
    setFileBusy(true)
    importPackFile()
      .then((p) => {
        track('build_import', { source: 'file', mc: p.version, loader: p.loader || (p.fabric ? 'fabric' : 'vanilla') })
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        showToast(t('Импортировано: {name}', { name: p.name }))
      })
      .catch((err) => {
        if (isPickCancelled(err)) return
        // Своя фраза бэкенда («Файл не найден», «Не удалось распаковать») — до двоеточия;
        // системный хвост и английские ошибки ОС — только в лог.
        console.error('[onb-import-file]', err)
        trackImportFailure('file', err)
        const head = String(err).split(':')[0].trim()
        showToast(/^[А-ЯЁ]/.test(head) ? head : t('Не удалось импортировать файл'), 'error')
      })
      .finally(() => setFileBusy(false))
  }

  return (
    <>
      <h3>{t('Перенесём сборки')}</h3>
      <div className="sub">{movable ? t('Сборки Prism и Modrinth App переедут в Millida целиком — с мирами и настройками') : t('Оригиналы останутся на месте')}</div>
      {movable ? <MovePanel /> : null}
      <div className="onb-scroll">
        {failed ? (
          <p className="faint-note">{t('Не удалось найти сборки')}</p>
        ) : list === null ? (
          <p className="faint-note onb-scan">
            <span className="spin"></span>
            {t('Ищем на дисках')}
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
                <span className="pill">{busy === key ? t('Переносим…') : already ? t('Уже в лаунчере') : t('К переносу')}</span>
              </label>
            )
          })
        ) : (
          <p className="faint-note">{t('Других сборок не нашли')}</p>
        )}
      </div>
      <div className="onb-inline">
        <div className="onb-inline-start">
          {(tlNick || tlBuilds.length) && !tlDone ? (
            <button className="btn sm secondary" data-track="onb_from_tlauncher" onClick={fromTl} disabled={!!busy}>
              <Icon id="i-download" /> {t('У меня был TLauncher')}
            </button>
          ) : null}
          <button className="btn sm secondary" onClick={fromFile} disabled={fileBusy || !!busy}>
            <Icon id="i-box2" /> {fileBusy ? t('Импортируем…') : t('Импорт из файла')}
          </button>
          {importable.length > 1 ? (
            <button className="btn sm ghost" onClick={toggleAll} disabled={!!busy}>
              {allPicked ? t('Снять выбор') : t('Выбрать все')}
            </button>
          ) : null}
        </div>
        {importable.length ? (
          <button className="btn sm primary" onClick={() => void runImport()} disabled={!selected.length || !!busy}>
            {busy ? t('Переносим…') : t('Перенести ({n})', { n: selected.length })}
          </button>
        ) : null}
      </div>
    </>
  )
}

const fromTlauncher = (it: FoundInstance) => /TLauncher|TL Legacy/.test(it.source)

/// The TLauncher nick joins the accounts without taking over the one already in
/// use: a Millida sign-in keeps launching as itself.
function keepNick(nick: string) {
  const store = useAccounts.getState()
  if (store.list.some((a) => a.kind === 'offline' && a.nick === nick)) return
  const before = store.active
  store.add({ nick, kind: 'offline' })
  if (before) useAccounts.getState().setActive(before)
  showToast(t('Ник из TLauncher сохранён: {nick}', { nick }))
}

/** Шаг «Какой у тебя компьютер?». */
const GFX_STEP = GRAPHICS_PRESETS_PUBLIC ? 3 : -1
const LOOK_STEP = GRAPHICS_PRESETS_PUBLIC ? 4 : 3

/** Выбор на шаге: по умолчанию «Авто — под мой ПК». Общим он становится по «Далее». */
let pendingGfx: GfxChoice | null = null

function GraphicsStep() {
  const [value, setValue] = useState<GfxChoice>(() => pendingGfx ?? globalChoice() ?? 'auto')
  const pick = useCallback((c: GfxChoice) => {
    pendingGfx = c
    setValue(c)
  }, [])
  return <PcStep value={value} onPick={pick} />
}

/** «Далее» на шаге графики: выбор встаёт во все сборки перед их запуском (шаг не последний, поэтому не «Готово»). */
function commitGfx() {
  const choice = pendingGfx ?? globalChoice() ?? 'auto'
  setGlobalChoice(choice)
  track('screen_view', { screen: 'onboarding-gfx', preset: choice })
}

function LookStep() {
  const t = useT()
  const [music, setMusic] = useState(musicAutostartOn)
  const [sound, setSound] = useState(() => soundMode() !== 'off')

  return (
    <>
      <h3>{t('Звук')}</h3>
      <div className="set-row">
        <span className="lab">
          {t('Музыка')}
        </span>
        <span
          className={'tgl' + (music ? ' on' : '')}
          onClick={() => {
            const next = !music
            setMusic(next)
            setMusicAutostart(next)
            const player = useMusic.getState()
            if (player.playing !== next && player.tracks.length) player.togglePlay()
          }}
        ></span>
      </div>
      <div className="set-row">
        <span className="lab">
          {t('Звуки')}
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
  const t = useT()
  const [autostart, setAuto] = useState(false)
  useEffect(() => {
    if (hasTauri()) void autostartOn().then(setAuto)
  }, [])

  return (
    <>
      <h3>{t('Готово')}</h3>
      <div className="set-row">
        <span className="lab">{t('Запускать вместе с системой')}</span>
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
            <b>{t('Гайд по разделам')}</b>
            <small>{t('{n} подсказок, можно прервать', { n: TOUR_STEPS.length })}</small>
          </span>
        </div>
        <div className="onb-point">
          <Icon id="i-settings" />
          <span>
            <b>{t('Повторить потом')}</b>
            <small>{t('Настройки → «Показать гайд»')}</small>
          </span>
        </div>
      </div>
    </>
  )
}

export function OnboardingModal() {
  const t = useT()
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
      <div className={'modal onb-modal' + (step === GFX_STEP ? ' onb-gfx' : '')}>
        <div className="onb-bar">
          {Array.from({ length: ONBOARDING_STEPS }, (_, i) => (
            <span key={i} className={'onb-bar-seg' + (i <= step ? ' on' : '')}></span>
          ))}
        </div>

        {step === 0 ? <Welcome nick={acc ? acc.nick : ''} /> : null}
        {step === INVITER_STEP ? <InviterStep /> : null}
        {step === 2 ? <ImportStep /> : null}
        {step === GFX_STEP ? <GraphicsStep /> : null}
        {step === LOOK_STEP ? <LookStep /> : null}
        {step === LOOK_STEP + 1 ? <OnboardingSurvey /> : null}
        {step === LOOK_STEP + 2 ? <ReadyStep /> : null}

        <div className="onb-actions">
          {step > 0 ? (
            <button className="btn md secondary" onClick={() => onboardingBack(!hasMillidaAccount())}>
              {t('Назад')}
            </button>
          ) : (
            <button className="btn md ghost" onClick={() => finishOnboarding(false)}>
              {t('Пропустить')}
            </button>
          )}
          <span className="tour-spacer"></span>
          {last ? (
            <>
              <button className="btn md ghost" onClick={() => finishOnboarding(false)}>
                {t('Без гайда')}
              </button>
              <button className="btn md primary" onClick={() => finishOnboarding(true)}>
                <Icon id="i-play" /> {t('Показать гайд')}
              </button>
            </>
          ) : (
            <button
              className={'btn md ' + (step === INVITER_STEP ? 'secondary' : 'primary')}
              data-track={step === INVITER_STEP ? 'onb_ref_skip' : undefined}
              data-gfx-done={step === GFX_STEP ? '' : undefined}
              onClick={() => {
                if (step === GFX_STEP) commitGfx()
                onboardingNext(!hasMillidaAccount())
              }}
            >
              {step === 0 ? t('Поехали') : step === INVITER_STEP ? t('Пропустить') : t('Далее')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
