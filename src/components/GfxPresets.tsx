import { useCallback, useEffect, useRef, useState } from 'react'
import { chooseGfxPreset, createProfile, gfxPresetState, gfxUnchosenBuilds, gpuDriverIssue, openUrl, revertGfxPreset, type DriverIssue, type GfxPresetState } from '../ipc/commands'
import { uiConfirm } from '../state/confirm'
import { hasTauri } from '../ipc/tauri'
import { showToast } from '../state/ui'
import { useProfiles } from '../state/profiles'
import { pluralForm, tx, useT } from '../i18n'
import type { Hardware } from '../lib/perfTier'
import { Slider } from './Slider'
import { Toggle } from './SetKit'
import {
  GFX_PRESETS,
  PRESET_TAGS,
  cachedHardware,
  epicAllowed,
  globalChoice,
  isGfxChoice,
  onBattery,
  presetArt,
  presetChunks,
  recommendPreset,
  stepDown,
  type GfxChoice,
  type GfxPresetId,
  type PresetTag,
} from '../lib/gfxPresets'

/** Превью без ядра (`?preview`): железо и прошлые игры для показа экрана. В релиз не попадает. */
const DEMO_HW: Hardware | null = import.meta.env.DEV ? { gpu: 'NVIDIA GeForce RTX 3060', ramMb: 16_000, cores: 12, screenW: 1920, screenH: 1080 } : null
const demo = () => import.meta.env.DEV && !hasTauri()

export function useHardware(): Hardware | null {
  const [hw, setHw] = useState<Hardware | null>(null)
  useEffect(() => {
    let live = true
    if (demo() && DEMO_HW) {
      setHw(DEMO_HW)
      return
    }
    void cachedHardware().then((h) => {
      if (live) setHw(h)
    })
    return () => {
      live = false
    }
  }, [])
  return hw
}

export function usePresetText() {
  const t = useT()
  const name: Record<GfxPresetId, string> = {
    potato: t('Картошка'),
    low: t('Низкие'),
    standard: t('Стандарт'),
    high: t('Высокие'),
    epic: t('Эпические'),
  }
  /** Для какого компьютера уровень — понятнее, чем список настроек. */
  const forPc: Record<GfxPresetId, string> = {
    potato: t('Очень слабый ПК, старый ноутбук'),
    low: t('Слабый ПК, встроенная графика'),
    standard: t('Обычный ПК'),
    high: t('Игровой ПК'),
    epic: t('Мощная видеокарта, шейдеры'),
  }
  const tag: Record<PresetTag, string> = {
    noShadows: t('Без теней'),
    simpleTextures: t('Простые текстуры'),
    noClouds: t('Без облаков'),
    shadows: t('Тени'),
    clouds: t('Облака'),
    smoothLight: t('Мягкий свет'),
    shaders: t('Шейдеры'),
  }
  const chunks = (n: number) => pluralForm(n, t('{n} чанк', { n }), t('{n} чанка', { n }), t('{n} чанков', { n }))
  return { name, forPc, tag, chunks }
}

/** Память · потоки · видеокарта · экран — то, по чему «Авто» выбирает уровень. */
export function HardwareLine({ hw }: { hw: Hardware }) {
  const t = useT()
  const parts: string[] = []
  if (hw.ramMb) parts.push(t('{n} ГБ', { n: Math.round(hw.ramMb / 1024) }))
  if (hw.cores) parts.push(t('{n} потоков', { n: hw.cores }))
  if (hw.gpu) parts.push(hw.gpu.replace(/\(r\)|\(tm\)|nvidia|amd|intel|geforce/gi, '').replace(/\s+/g, ' ').trim())
  if (hw.screenW && hw.screenH) parts.push(`${hw.screenW}×${hw.screenH}`)
  if (!parts.length) return null
  return (
    <div className="gp-hw" aria-label={t('Твой компьютер')}>
      {parts.map((p) => (
        <span key={p}>{p}</span>
      ))}
    </div>
  )
}

/** Старый драйвер видеокарты (ядро сверяет со списком Sodium wiki); один раз за запуск лаунчера. */
let driverAsk: Promise<DriverIssue | null> | null = null
export function useDriverIssue(): DriverIssue | null {
  const [issue, setIssue] = useState<DriverIssue | null>(null)
  useEffect(() => {
    if (!hasTauri()) return
    let live = true
    void (driverAsk ??= gpuDriverIssue().catch(() => null)).then((d) => {
      if (live) setIssue(d)
    })
    return () => {
      live = false
    }
  }, [])
  return issue
}

/** Ноутбук от батареи сейчас: перед запуском ступень станет ниже, кадры — 60. */
export function useBattery(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let live = true
    void onBattery().then((b) => {
      if (live) setOn(b)
    })
    return () => {
      live = false
    }
  }, [])
  return on
}

/** Одна кнопка вместо объяснений: страница драйвера у производителя. */
function DriverBanner({ issue }: { issue: DriverIssue }) {
  const t = useT()
  return (
    <div className="gp-driver" role="alert">
      <span>
        <b>{t('Старый драйвер видеокарты')}</b>
        <small>{issue.card + ' · ' + issue.version}</small>
      </span>
      <button className="btn sm primary" data-gfx-driver onClick={() => void openUrl(issue.url)}>
        {t('Обновить драйвер')}
      </button>
    </div>
  )
}

interface ControlProps {
  /** Выбор игрока; null — «как в общих настройках» (только у сборки). */
  choice: GfxChoice
  hw: Hardware
  onChoice: (c: GfxChoice) => void
  /** Ядро не нашло дискретной карты или загрузчик без шейдеров. */
  noShaders?: boolean
  /** Замер прошлой игры этой сборки — единственный FPS, который показываем. */
  measured?: { avg: number; preset: string | null } | null
  /** Игрок менял графику в игре: ступень «Своя», пока он сам не выберет уровень. */
  custom?: boolean
  driver?: DriverIssue | null
}

/**
 * Ползунок качества на пять ступеней, как в играх: название ступени крупно,
 * «Авто — под мой ПК» и большая картинка выбранной ступени под ползунком.
 * Всё меняется мгновенно; ставится перед запуском игры.
 */
export function PresetControl({ choice, hw, onChoice, noShaders, measured, custom, driver }: ControlProps) {
  const t = useT()
  const text = usePresetText()
  const battery = useBattery()
  const epicOff = noShaders || !!driver || !epicAllowed(hw)
  const rec = (() => {
    const r = recommendPreset(hw)
    return r === 'epic' && epicOff ? 'high' : r
  })()
  const auto = choice === 'auto'
  const level: GfxPresetId | null = choice === 'none' ? null : auto ? rec : choice
  const shown = level ?? rec
  const [epicNote, setEpicNote] = useState(false)

  const pick = (index: number) => {
    const id = GFX_PRESETS[Math.max(0, Math.min(GFX_PRESETS.length - 1, index))]
    if (id === 'epic' && epicOff) {
      setEpicNote(true)
      onChoice('high')
      return
    }
    setEpicNote(false)
    onChoice(id)
  }

  return (
    <div className={'gp-ctl' + (level && !custom ? '' : ' none')}>
      {driver ? <DriverBanner issue={driver} /> : null}
      <div className="gp-ctl-head">
        <div className="gp-level" aria-live="polite">
          <b>{custom ? t('Своя') : level ? text.name[level] : t('Без пресета')}</b>
          <span>{custom ? t('Ты менял графику в игре') : level ? text.forPc[level] : t('Графика игры как была')}</span>
        </div>
        <label className="gp-auto">
          <span>{t('Авто — под мой ПК')}</span>
          <Toggle label={t('Авто — под мой ПК')} on={auto} onChange={() => onChoice(auto ? shown : 'auto')} />
        </label>
      </div>
      <div className="gp-rec-line">{t('Рекомендуем для твоего ПК: {name}', { name: text.name[rec] })}</div>
      <div className="gp-slide">
        <Slider value={GFX_PRESETS.indexOf(shown)} min={0} max={GFX_PRESETS.length - 1} step={1} onChange={pick} />
        <div className="gp-steps">
          {GFX_PRESETS.map((id, i) => (
            <button
              key={id}
              type="button"
              data-gfx={id}
              className={'gp-step' + (id === level ? ' on' : '') + (id === 'epic' && epicOff ? ' off' : '') + (id === rec ? ' rec' : '')}
              style={{ left: (i / (GFX_PRESETS.length - 1)) * 100 + '%' }}
              aria-pressed={id === level}
              onClick={() => pick(i)}
            >
              {text.name[id]}
            </button>
          ))}
        </div>
      </div>
      {epicNote ? <div className="gp-note">{driver ? t('Шейдерам нужен свежий драйвер') : t('Эпическим нужна дискретная видеокарта')}</div> : null}
      {battery && level && !custom ? (
        <div className="gp-note">{t('На батарее: «{name}» и 60 FPS', { name: text.name[stepDown(level)] })}</div>
      ) : null}
      <figure className="gp-preview">
        {/* TODO: public/presets/*.webp — временные кадры из одной картинки, заменить реальными со стенда (scripts/gfx-preset-art.py). */}
        <img src={presetArt(shown)} alt="" decoding="async" draggable={false} />
        <figcaption className="gp-tags">
          <span>{text.chunks(presetChunks(shown, hw))}</span>
          {PRESET_TAGS[shown].map((tg) => (
            <span key={tg}>{text.tag[tg]}</span>
          ))}
        </figcaption>
        {measured ? (
          <span className="gp-measured" data-gfx-fps={measured.avg}>
            {t('В прошлый раз: {fps} FPS', { fps: measured.avg })}
          </span>
        ) : null}
      </figure>
    </div>
  )
}

/** Картинки ступеней грузятся заранее: ползунок меняет кадр без мигания. */
function usePreloadArt() {
  useEffect(() => {
    for (const id of GFX_PRESETS) {
      const img = new Image()
      img.src = presetArt(id)
    }
  }, [])
}

/**
 * Онбординг: «Какой у тебя компьютер?» По умолчанию «Авто — под мой ПК»;
 * «Готово» под шагом делает выбор общим для всех сборок (Onboarding.tsx).
 */
export function PcStep({ value, onPick }: { value: GfxChoice; onPick: (c: GfxChoice) => void }) {
  const t = useT()
  const hw = useHardware()
  const driver = useDriverIssue()
  usePreloadArt()
  return (
    <>
      <h3>{t('Какой у тебя компьютер?')}</h3>
      {hw ? <HardwareLine hw={hw} /> : null}
      {hw ? <PresetControl choice={value} hw={hw} onChoice={onPick} driver={driver} /> : <div className="gp-ctl skel" aria-hidden="true" />}
    </>
  )
}

/** Сыгранные сборки без выбора графики: общий выбор их не трогает, пока игрок не нажмёт кнопку. */
function useUnchosenBuilds(): [string[], () => void] {
  const [names, setNames] = useState<string[]>([])
  const load = useCallback(() => {
    if (demo()) {
      setNames(['Выживание', 'Друзья 1.20.1', 'Техно'])
      return
    }
    if (!hasTauri()) return
    gfxUnchosenBuilds()
      .then(setNames)
      .catch((e) => console.warn('[gfx] unchosen', e))
  }, [])
  useEffect(load, [load])
  return [names, load]
}

/**
 * Вкладка «Настройки → Графика»: общий выбор («Авто» по умолчанию) для новых
 * сборок. Просмотр ничего не сохраняет. Сыгранные сборки без своего выбора —
 * одной кнопкой «Оптимизировать мои сборки (N)» с подтверждением.
 */
export function GlobalPresetPicker({ value, onPick }: { value: GfxChoice; onPick: (c: GfxChoice) => void }) {
  const t = useT()
  const hw = useHardware()
  const { name } = usePresetText()
  const driver = useDriverIssue()
  const [unchosen, reload] = useUnchosenBuilds()
  const [busy, setBusy] = useState(false)
  usePreloadArt()
  if (!hw) return <div className="gp-ctl skel" aria-hidden="true" />

  const level = value === 'none' ? null : value === 'auto' ? recommendPreset(hw) : value
  const optimize = async () => {
    if (busy || !level) return
    const ok = await uiConfirm(
      t('Сборок: {n}. Моды-ускорители и графика «{name}» встанут при запуске, свои моды останутся.', {
        n: unchosen.length,
        name: name[level],
      }),
      { title: t('Оптимизировать мои сборки'), confirmLabel: t('Оптимизировать'), danger: false },
    )
    if (!ok) return
    // Выбор, а не установка: сам пресет встанет перед запуском каждой сборки.
    const choice: GfxChoice = value === 'none' ? 'auto' : value
    if (demo()) {
      showToast(t('Сборок: {n} — графика встанет при их запуске', { n: unchosen.length }), 'ok')
      return
    }
    setBusy(true)
    const done = await Promise.all(unchosen.map((b) => chooseGfxPreset(b, choice).then(() => true).catch(() => false)))
    setBusy(false)
    reload()
    showToast(t('Сборок: {n} — графика встанет при их запуске', { n: done.filter(Boolean).length }), 'ok')
  }

  return (
    <div className="gp-wrap">
      <div className="gp-head">
        <HardwareLine hw={hw} />
        {value !== 'none' ? (
          <button className="btn sm ghost" data-gfx-global="off" onClick={() => onPick('none')}>
            {t('Не менять')}
          </button>
        ) : null}
      </div>
      <PresetControl choice={value} hw={hw} onChoice={onPick} driver={driver} />
      {unchosen.length > 0 && level ? (
        <div className="gp-optimize">
          <button className="btn md primary" data-gfx-optimize={unchosen.length} disabled={busy} onClick={() => void optimize()}>
            {t('Оптимизировать мои сборки ({n})', { n: unchosen.length })}
          </button>
        </div>
      ) : null}
    </div>
  )
}

const DEMO_STATE: GfxPresetState = {
  preset: 'low',
  source: 'own',
  want: 'low',
  canRevert: true,
  applicable: true,
  fresh: false,
  mods: true,
  shadersOk: true,
  // Без замера цифр нет: демо не рисует «до и после», которых не было.
  lastFps: null,
  beforeFps: null,
  skipped: [],
  driver: null,
  battery: false,
  auto: false,
  custom: false,
}

/** Fabric пришёл в 1.14: на ванилле старше копию с модами-ускорителями не сделать. */
function fabricFits(version: string): boolean {
  const [major, minor] = version.split('.').map((p) => Number.parseInt(p, 10))
  if (!Number.isFinite(major)) return false
  return major > 1 || (Number.isFinite(minor) && minor >= 14)
}

/**
 * Выбор, по которому живёт сборка: свой; общий («Авто» по умолчанию) — у новой
 * сборки и у той, что уже настроена общим; у сыгранной без выбора — «не трогать».
 */
export function effectiveChoice(st: Pick<GfxPresetState, 'want' | 'fresh' | 'source'>, global: GfxChoice | null): GfxChoice {
  if (isGfxChoice(st.want)) return st.want
  if (st.fresh || st.source === 'global') return global ?? 'auto'
  return 'none'
}

interface BuildProps {
  profile: string
  loader: string
  version: string
  onChange: () => void
}

/**
 * Графика сборки поверх общего выбора. Ползунок только запоминает выбор —
 * мгновенно, без загрузок; моды, текстуры и options.txt ставятся перед
 * следующим запуском (lib/prelaunchCare.ts). «Вернуть как было» — сразу.
 */
export function BuildGfxPresets({ profile, loader, version, onChange }: BuildProps) {
  const t = useT()
  const hw = useHardware()
  const { name } = usePresetText()
  const [state, setState] = useState<GfxPresetState | null>(null)
  const [busy, setBusy] = useState<'revert' | 'copy' | null>(null)
  const seq = useRef(0)
  usePreloadArt()

  const load = useCallback(() => {
    const my = ++seq.current
    if (demo()) {
      setState(DEMO_STATE)
      return
    }
    if (!hasTauri()) return
    gfxPresetState(profile)
      .then((s) => {
        if (my === seq.current) setState(s)
      })
      .catch((e) => console.warn('[gfx] state', e))
  }, [profile])

  useEffect(() => {
    setState(null)
    load()
  }, [load])

  if (!state || !hw || (!state.applicable && !state.canRevert)) return null

  const choice = effectiveChoice(state, globalChoice())
  const vanilla = loader === 'vanilla' && !state.mods
  const rec = recommendPreset(hw)
  const target = choice === 'none' ? null : choice === 'auto' ? rec : choice
  const pending = target !== null && target !== state.preset

  const pick = (c: GfxChoice) => {
    const before = state
    // Мгновенно: ползунок двигается сразу, ядро только записывает выбор.
    setState({ ...state, want: c, custom: false })
    if (demo()) return
    const my = ++seq.current
    chooseGfxPreset(profile, c)
      .then((s) => {
        if (my === seq.current) setState(s)
      })
      .catch((e) => {
        if (my === seq.current) setState(before)
        showToast(t('Не удалось сохранить выбор: {error}', { error: tx(e) }), 'error')
      })
  }

  const revert = () => {
    if (busy) return
    if (demo()) {
      setState({ ...state, preset: null, want: 'none', canRevert: false })
      return
    }
    setBusy('revert')
    revertGfxPreset(profile)
      .then((s) => {
        setState(s)
        onChange()
        showToast(t('Настройки графики вернули как было'))
      })
      .catch((e) => showToast(t('Не удалось вернуть: {error}', { error: tx(e) }), 'error'))
      .finally(() => setBusy(null))
  }

  /** Ванилла моды не держит: рядом Fabric-копия той же версии с тем же выбором графики. */
  const fabricCopy = () => {
    if (busy) return
    const taken = new Set(useProfiles.getState().profiles.map((p) => p.name))
    let copy = `${profile} Fabric`
    for (let n = 2; taken.has(copy); n++) copy = `${profile} Fabric ${n}`
    setBusy('copy')
    createProfile(copy, version, true, 'fabric', null)
      .then(async (p) => {
        // Как и выбор на странице сборки: моды и графика встанут перед первым запуском копии.
        await chooseGfxPreset(p.name, choice === 'none' ? 'auto' : choice).catch((e) => console.error('[gfx] copy', e))
        await useProfiles.getState().refresh()
        showToast(t('Готова сборка «{name}» с модами-ускорителями', { name: p.name }), 'ok')
      })
      .catch((e) => showToast(t('Не удалось сделать копию: {error}', { error: tx(e) }), 'error'))
      .finally(() => setBusy(null))
  }

  return (
    <div className="gp-build" id="bsGfx">
      <div className="gp-head">
        <span className="bx-opts-cap">{t('Графика')}</span>
      </div>
      <PresetControl
        choice={choice}
        hw={hw}
        onChoice={pick}
        noShaders={!state.shadersOk}
        measured={state.lastFps}
        custom={state.custom}
        driver={state.driver}
      />
      <div className="gp-actions">
        {pending && target ? (
          <span className="gp-note on">{t('«{name}» встанут при запуске', { name: name[target] })}</span>
        ) : state.want === null && choice !== 'none' ? (
          <span className="gp-note">{t('Как в общих настройках')}</span>
        ) : null}
        {vanilla && fabricFits(version) ? (
          <button className="btn sm secondary" data-gfx-copy disabled={!!busy} onClick={fabricCopy}>
            {t('Fabric-копия')}
          </button>
        ) : null}
        {state.canRevert ? (
          <button className="btn sm secondary" data-gfx-revert disabled={!!busy} onClick={revert}>
            {t('Вернуть как было')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
