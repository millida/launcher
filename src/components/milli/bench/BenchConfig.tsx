import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { PxArt } from '../px'
import { Slider } from '../../Slider'
import { useBump, useHeightAnim } from '../motion'
import { deviceSpecs } from '../../../ipc/commands'
import { hasTauri } from '../../../ipc/tauri'
import { detectGpu } from './detectGpu'
import type { MilliConfig, MilliLevel, MilliOp, MilliPack, MilliProfile } from '../../../lib/milli'
import { benchOp } from '../../../state/milliBench'
import { BenchTabFrame, useHead, useModder } from './BenchShaders'
import { CONFIG_RULES, OPTION_KEYS, PROFILE_OPTIONS, SHADER_LEVELS, clampOption, configOf, optionOf, ramCapGb, ramForPack, shaderLevelOf } from './benchTabs'
import '../../../styles/pixel/milli-bench-tabs.css'
import '../../../styles/pixel/milli-config.css'

/*
 * Вкладка «Настройки» карточки сборки. Для игрока 12–14 лет: почти без текста.
 *   ПК (иконки) → 3 больших пресета → FPS крупно → «Тонкая настройка» (свёрнуто):
 *   строки «имя · значение · контрол», изменённые от пресета подсвечены, «Сбросить».
 * Всё уходит в MilliConfig сборки через benchOp (op profile / config / shader_level).
 */

// ─── Железо ────────────────────────────────────────────────────────────

export interface PcInfo {
  ramMb: number
  cores: number
  cpu: string
  /** Сырая строка видеокарты из WebGL; пусто — неизвестна. */
  gpu: string
}

const GENERIC_GPU = /swiftshader|llvmpipe|basic render|software|^apple gpu$|^webkit|^$/i

/** «RTX 3060», «RX 6600», «Intel UHD 620», «M2 Pro»; пусто — показывать нечего. */
export function gpuShort(raw: string, cpu = ''): string {
  let s = raw.trim()
  const angle = /^ANGLE \((.*)\)$/.exec(s)
  if (angle) {
    const parts = angle[1].split(',')
    s = (parts[1] ?? parts[0] ?? '').trim()
  }
  s = s
    .replace(/\(TM\)|\(R\)|®|™/gi, '')
    .replace(/\(0x[0-9a-f]+\)/gi, '')
    .replace(/\s(Direct3D|vs_\d|OpenGL|Metal|\/PCIe).*$/i, '')
    .replace(/^(NVIDIA|AMD|ATI)\s+/i, '')
    .replace(/GeForce\s+/i, '')
    .replace(/Radeon\s+(?=RX|Pro)/i, '')
    .replace(/\s+Graphics\b/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (GENERIC_GPU.test(s)) {
    // Mac: видеокарта — часть чипа, WebKit её прячет; чип знает ядро.
    const m = /Apple (M\d+(?: (?:Pro|Max|Ultra))?)/i.exec(cpu)
    return m ? m[1] : ''
  }
  return s.length > 16 ? s.slice(0, 15) + '…' : s
}

/** Тот же расчёт, что сервер (`agent.ts pcProfile`): слабый / баланс / мощный. */
export function pcPreset(pc: Pick<PcInfo, 'ramMb' | 'cores' | 'gpu' | 'cpu'> | null): MilliProfile | null {
  if (!pc || !(pc.ramMb > 0)) return null
  const gpu = (GENERIC_GPU.test(pc.gpu.trim()) && /apple m\d/i.test(pc.cpu) ? pc.cpu : pc.gpu).toLowerCase()
  const discrete = /rtx|gtx|quadro|radeon\s*(rx|pro)|\brx\s*\d|arc\s*a\d|apple m\d\s*(pro|max|ultra)/.test(gpu)
  const integrated = !discrete && /intel|uhd|iris|vega\s*\d*\s*graphics|radeon\(tm\)\s*graphics|radeon graphics|basic render|llvmpipe|swiftshader|mali|adreno|apple m\d/.test(gpu)
  const strong = /rtx\s*(20[6-9]0|30[6-9]0|40[6-9]0|50[6-9]0)|rx\s*(6[7-9]\d0|7[7-9]\d0|9\d{3})|apple m\d\s*(max|ultra)/.test(gpu)
  if (pc.ramMb < 8000 || integrated || (pc.cores && pc.cores <= 2)) return 'low'
  if (strong && pc.ramMb >= 15000) return 'high'
  return 'balanced'
}

/** Демо (?preview=user, только dev): «ПК» для скриншотов без ядра. */
const DEMO_PC: PcInfo = { ramMb: 16384, cores: 8, cpu: 'AMD Ryzen 5 5600', gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)' }
const isDemo = () => import.meta.env.DEV && typeof location !== 'undefined' && /[?&]preview=user\b/.test(location.search)

let pcAsk: Promise<PcInfo | null> | null = null
function askPc(): Promise<PcInfo | null> {
  if (isDemo() && !hasTauri()) return Promise.resolve(DEMO_PC)
  if (!hasTauri()) return Promise.resolve(null)
  pcAsk ??= deviceSpecs()
    .then((s) => (s && s.ram_mb > 0 ? { ramMb: s.ram_mb, cores: s.cpu_cores || s.cpu_threads || 0, cpu: s.cpu || '', gpu: detectGpu() } : null))
    .catch(() => {
      pcAsk = null
      return null
    })
  return pcAsk
}

function usePc(): PcInfo | null {
  const [pc, setPc] = useState<PcInfo | null>(null)
  useEffect(() => {
    let live = true
    void askPc().then((v) => live && setPc(v))
    return () => {
      live = false
    }
  }, [])
  return pc
}

// ─── Пресеты и оценка FPS ──────────────────────────────────────────────

const PRESETS: readonly { id: MilliProfile; ru: string; icon: string }[] = [
  { id: 'low', ru: 'Быстро', icon: 'iron_ingot' },
  { id: 'balanced', ru: 'Баланс', icon: 'gold_ingot' },
  { id: 'high', ru: 'Красиво', icon: 'diamond' },
]

/** Потолок шейдеров пресета (presets.ts PROFILE_SHADER). */
const PRESET_SHADER: Record<MilliProfile, MilliLevel> = { low: 'off', balanced: 'medium', high: 'heavy' }
const LEVEL_RANK: Record<MilliLevel, number> = { off: 0, light: 1, medium: 2, heavy: 3 }

/** Ключи options.txt, которые показывает «Тонкая настройка» и сверяет с пресетом. */
const FINE_KEYS = ['renderDistance', 'entityShadows', 'particles', 'renderClouds', 'ao'] as const

/** FPS видеокарты на средних настройках (12 чанков, без шейдеров, Sodium). */
function gpuBase(pc: PcInfo | null): number {
  if (!pc) return 100
  const g = (pc.gpu + ' ' + pc.cpu).toLowerCase()
  if (/rtx\s*(30[7-9]0|40[6-9]0|50[6-9]0)|rx\s*(6[89]\d0|7[89]\d0|9\d{3})|apple m\d\s*(max|ultra)/.test(g)) return 260
  if (/rtx|rx\s*(6[67]\d0|7[67]\d0)|arc\s*a7/.test(g)) return 190
  if (/apple m\d\s*pro/.test(g)) return 150
  if (/gtx|\brx\s*\d|radeon\s*pro|quadro|arc/.test(g)) return 120
  if (/apple m\d/.test(g)) return 100
  if (/iris\s*xe|radeon(\(tm\))?\s*graphics|vega/.test(g)) return 70
  if (/intel|uhd|hd graphics|mali|adreno/.test(g)) return 45
  return pc.ramMb >= 15000 ? 120 : pc.ramMb >= 7500 ? 90 : 60
}

export interface FpsInput {
  renderDistance: number
  shader: MilliLevel
  particles: string
  clouds: string
  ao: string
  shadows: string
  mods: number
  ramMb: number
  needMb: number
  maxFps: number
}

/** Грубая оценка FPS «от–до», кратно 10. Это оценка, не замер. */
export function fpsEstimate(pc: PcInfo | null, o: FpsInput): [number, number] {
  let f = gpuBase(pc)
  f *= Math.pow(12 / Math.max(2, o.renderDistance), 0.6)
  f *= { off: 1, light: 0.6, medium: 0.42, heavy: 0.28 }[o.shader]
  if (o.particles === '0') f *= 0.95
  if (o.clouds === 'true') f *= 0.96
  if (o.ao === 'true') f *= 0.97
  if (o.shadows === 'true') f *= 0.98
  f *= 1 - Math.min(0.35, o.mods / 800)
  if (o.ramMb < o.needMb) f *= 0.8
  if (pc && pc.cores > 0 && pc.cores <= 4) f *= 0.85
  const cap = o.maxFps > 0 && o.maxFps < 260 ? o.maxFps : Infinity
  const r10 = (n: number) => Math.max(10, Math.round(n / 10) * 10)
  const lo = Math.min(r10(f * 0.75), cap)
  const hi = Math.min(Math.max(r10(f * 1.15), lo), cap)
  return [lo, hi]
}

// ─── Черновик значения: двигается сразу, op уходит после паузы ─────────

function useDraft(key: string, value: string) {
  const [draft, setDraft] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const set = (v: string) => {
    setDraft(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      if (v === value) return setDraft(null)
      void benchOp({ op: 'config', key, value: v }).finally(() => setDraft(null))
    }, 350)
  }
  return [draft ?? value, set] as const
}

const FINE_KEY = 'm-milli-cfg-fine'
function useFineOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(FINE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setOpen((v) => {
      try {
        localStorage.setItem(FINE_KEY, v ? '0' : '1')
      } catch {}
      return !v
    })
  return [open, toggle] as const
}

// ─── Вкладка ───────────────────────────────────────────────────────────

export function BenchConfig() {
  const head = useHead()
  if (!head) return null
  return (
    <BenchTabFrame tab="config">
      <Config pack={head} />
    </BenchTabFrame>
  )
}

const GB = 1024
const gbOf = (mb: number) => Math.max(1, Math.round(mb / GB))
const set = (key: string, value: string) => void benchOp({ op: 'config', key, value })

function Config({ pack }: { pack: MilliPack }) {
  const modder = useModder()
  const pc = usePc()
  const cfg = configOf(pack)
  const mods = (pack.mods ?? []).length
  const dh = (pack.mods ?? []).some((m) => m.slug === 'distanthorizons')
  const totalMb = pc?.ramMb ?? 0
  const capGb = ramCapGb(totalMb)
  const needMb = ramForPack(mods, cfg.profile, dh)
  const presetRamGb = Math.max(2, Math.min(capGb, gbOf(needMb)))
  const level = shaderLevelOf(pack)
  const canShaders = level !== 'off' || (pack.shaderChoices ?? []).length > 0
  const mine = pcPreset(pc)
  const preset = PROFILE_OPTIONS[cfg.profile]

  // Что отличается от пресета.
  const dirty = new Set<string>()
  for (const k of FINE_KEYS) if (optionOf(cfg, k) !== preset[k]) dirty.add(k)
  if (canShaders && LEVEL_RANK[level] > LEVEL_RANK[PRESET_SHADER[cfg.profile]]) dirty.add('shader')
  if (Math.abs(gbOf(cfg.ramMb) - presetRamGb) >= 1) dirty.add('ramMb')

  const reset = () => {
    const ops: MilliOp[] = []
    for (const k of FINE_KEYS) if (dirty.has(k)) ops.push({ op: 'config', key: k, value: preset[k] })
    if (dirty.has('ramMb')) ops.push({ op: 'config', key: 'ramMb', value: String(presetRamGb * GB) })
    if (dirty.has('shader')) ops.push({ op: 'shader_level', level: PRESET_SHADER[cfg.profile] })
    if (ops.length) void benchOp(ops)
  }

  const [lo, hi] = fpsEstimate(pc, {
    renderDistance: Number(optionOf(cfg, 'renderDistance')) || 12,
    shader: level,
    particles: optionOf(cfg, 'particles'),
    clouds: optionOf(cfg, 'renderClouds'),
    ao: optionOf(cfg, 'ao'),
    shadows: optionOf(cfg, 'entityShadows'),
    mods,
    ramMb: cfg.ramMb,
    needMb: Math.min(needMb, capGb * GB),
    maxFps: Number(optionOf(cfg, 'maxFps')) || 0,
  })

  return (
    <div className="mcf">
      {pc ? <PcStrip pc={pc} /> : null}

      <div className="mcf-presets" role="radiogroup" aria-label="Графика">
        {PRESETS.map((p) => {
          const on = cfg.profile === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={'mcf-preset mlm-press pf-' + p.id + (on ? ' on' : '')}
              data-track="milli_cfg_preset"
              data-id={p.id}
              onClick={() => !on && void benchOp({ op: 'profile', profile: p.id })}
            >
              {mine === p.id ? <span className="mcf-mine">твой ПК</span> : null}
              <span className="mcf-preset-px" aria-hidden="true">
                <PxArt name={p.icon} size={32} />
              </span>
              <b>{p.ru}</b>
            </button>
          )
        })}
      </div>

      <Fps lo={lo} hi={hi} pc={!!pc} />

      <Fine
        cfg={cfg}
        dirty={dirty}
        onReset={reset}
        level={level}
        canShaders={canShaders}
        totalMb={totalMb}
        capGb={capGb}
        needMb={needMb}
        presetRamGb={presetRamGb}
        mods={mods}
      />

      {modder ? <ModderConfig cfg={cfg} /> : null}
    </div>
  )
}

function PcStrip({ pc }: { pc: PcInfo }) {
  const gpu = gpuShort(pc.gpu, pc.cpu)
  return (
    <div className="mcf-pc" aria-label="Твой ПК">
      <span className="mcf-pc-chip" title="Оперативная память">
        <PxArt name="comparator" size={16} />
        <b>{gbOf(pc.ramMb)} ГБ</b>
      </span>
      {gpu ? (
        <span className="mcf-pc-chip" title={'Видеокарта: ' + gpu}>
          <PxArt name="diamond" size={16} />
          <b>{gpu}</b>
        </span>
      ) : null}
      {pc.cores > 0 ? (
        <span className="mcf-pc-chip" title={pc.cpu ? 'Процессор: ' + pc.cpu : 'Процессор'}>
          <PxArt name="redstone" size={16} />
          <b>
            {pc.cores} {pc.cores % 10 === 1 && pc.cores % 100 !== 11 ? 'ядро' : pc.cores % 10 >= 2 && pc.cores % 10 <= 4 && (pc.cores % 100 < 12 || pc.cores % 100 > 14) ? 'ядра' : 'ядер'}
          </b>
        </span>
      ) : null}
    </div>
  )
}

function Fps({ lo, hi, pc }: { lo: number; hi: number; pc: boolean }) {
  const txt = lo === hi ? String(lo) : `${lo}–${hi}`
  const bump = useBump(txt)
  const tone = lo < 30 ? 'bad' : lo < 55 ? 'mid' : 'ok'
  return (
    <div className={'mcf-fps ' + tone} title={pc ? 'Оценка по твоему ПК, не замер' : 'Оценка для среднего ПК, не замер'}>
      <PxArt name="fps_torch" size={32} className="mcf-fps-px" />
      <b className="mcf-fps-n" data-mlm-bump={bump}>
        {txt}
      </b>
      <span className="mcf-fps-u">FPS</span>
      <span className="mcf-fps-tag">≈ оценка</span>
    </div>
  )
}

// ─── Тонкая настройка ──────────────────────────────────────────────────

const PARTICLES = [
  { v: '0', ru: 'Все' },
  { v: '1', ru: 'Меньше' },
  { v: '2', ru: 'Мин' },
]
const CLOUDS = [
  { v: 'false', ru: 'Нет' },
  { v: 'fast', ru: 'Просто' },
  { v: 'true', ru: 'Красиво' },
]
const LANGS = [
  { v: 'ru_ru', ru: 'RU' },
  { v: 'uk_ua', ru: 'UA' },
  { v: 'en_us', ru: 'EN' },
]
const SHADER_RU: Record<MilliLevel, string> = { off: 'Без шейдеров', light: 'Лёгкие', medium: 'Средние', heavy: 'Тяжёлые' }

interface FineProps {
  cfg: MilliConfig
  dirty: Set<string>
  onReset: () => void
  level: MilliLevel
  canShaders: boolean
  totalMb: number
  capGb: number
  needMb: number
  presetRamGb: number
  mods: number
}

function Fine(p: FineProps) {
  const [open, toggle] = useFineOpen()
  const fold = useRef<HTMLDivElement>(null)
  const keep = useHeightAnim(fold, open)
  const n = p.dirty.size
  return (
    <section className={'mcf-fine' + (open ? ' open' : '')}>
      <div className="mcf-fine-head">
        <button type="button" className="mcf-fine-btn" aria-expanded={open} data-track="milli_cfg_fine" onClick={toggle}>
          <PxArt name="comparator" size={16} />
          <span>Подкрутить самому</span>
          {n ? <i className="mcf-dot" aria-label={'Изменено: ' + n} /> : null}
          <svg className="mcf-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {n ? (
          <button type="button" className="btn sm ghost mcf-reset mlm-pop" data-track="milli_cfg_reset" onClick={p.onReset} title="Вернуть как в пресете">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 6a3.5 3.5 0 1 0 1-2.5M2.5 1.5v2.5H5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Сбросить
          </button>
        ) : null}
      </div>
      <div ref={fold} className="mcf-fold">
        {open || keep ? (
          <div className="mcf-rows">
            <DistanceRow cfg={p.cfg} dirty={p.dirty.has('renderDistance')} />
            {p.canShaders ? <ShaderRow level={p.level} dirty={p.dirty.has('shader')} /> : null}
            <SegRow label="Частицы" px="firework_star" k="particles" opts={PARTICLES} cfg={p.cfg} dirty={p.dirty.has('particles')} />
            <SegRow label="Облака" px="painting" k="renderClouds" opts={CLOUDS} cfg={p.cfg} dirty={p.dirty.has('renderClouds')} />
            <TglRow label="Тени" px="torch" k="entityShadows" cfg={p.cfg} dirty={p.dirty.has('entityShadows')} />
            <TglRow label="Плавный свет" px="glowstone" k="ao" cfg={p.cfg} dirty={p.dirty.has('ao')} />
            <RamRow {...p} dirty={p.dirty.has('ramMb')} />
            <SegRow label="Язык" px="book_quill" k="lang" opts={LANGS} cfg={p.cfg} dirty={false} />
          </div>
        ) : null}
      </div>
    </section>
  )
}

function Row({ label, px, dirty, value, children, wide }: { label: string; px: string; dirty: boolean; value?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={'mcf-row' + (dirty ? ' dirty' : '') + (wide ? ' wide' : '')}>
      <span className="mcf-lab">
        <PxArt name={px} size={16} />
        {label}
      </span>
      {value !== undefined ? <span className="mcf-val">{value}</span> : null}
      <span className="mcf-ctl">{children}</span>
    </div>
  )
}

function DistanceRow({ cfg, dirty }: { cfg: MilliConfig; dirty: boolean }) {
  const rule = CONFIG_RULES.renderDistance
  const [v, setV] = useDraft('renderDistance', optionOf(cfg, 'renderDistance'))
  const n = Number(v) || 12
  const flip = useBump(n)
  if (!rule || rule.kind === 'enum') return null
  const step = (d: number) => setV(String(Math.max(rule.min, Math.min(rule.max, n + d))))
  return (
    <Row label="Дальность" px="spyglass" dirty={dirty}>
      <span className="mcf-step" role="group" aria-label="Дальность прорисовки, чанков">
        <button type="button" className="mlm-press" aria-label="Меньше" disabled={n <= rule.min} onClick={() => step(-2)}>
          −
        </button>
        <b className="mcf-step-n" data-mlm-flip={flip}>
          {n}
        </b>
        <button type="button" className="mlm-press" aria-label="Больше" disabled={n >= rule.max} onClick={() => step(2)}>
          +
        </button>
      </span>
    </Row>
  )
}

function ShaderRow({ level, dirty }: { level: MilliLevel; dirty: boolean }) {
  return (
    <Row label="Шейдеры" px="glowstone" dirty={dirty}>
      <span className="mcf-seg mcf-seg-px" role="radiogroup" aria-label="Шейдеры">
        {SHADER_LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={level === l.id}
            aria-label={SHADER_RU[l.id]}
            title={SHADER_RU[l.id]}
            className={level === l.id ? 'on' : undefined}
            onClick={() => level !== l.id && void benchOp({ op: 'shader_level', level: l.id })}
          >
            <PxArt name={l.icon} size={16} />
          </button>
        ))}
      </span>
    </Row>
  )
}

function SegRow({ label, px, k, opts, cfg, dirty }: { label: string; px: string; k: string; opts: { v: string; ru: string }[]; cfg: MilliConfig; dirty: boolean }) {
  const cur = optionOf(cfg, k)
  return (
    <Row label={label} px={px} dirty={dirty}>
      <span className="mcf-seg" role="radiogroup" aria-label={label}>
        {opts.map((o) => (
          <button key={o.v} type="button" role="radio" aria-checked={cur === o.v} className={cur === o.v ? 'on' : undefined} onClick={() => cur !== o.v && set(k, o.v)}>
            {o.ru}
          </button>
        ))}
      </span>
    </Row>
  )
}

function TglRow({ label, px, k, cfg, dirty }: { label: string; px: string; k: string; cfg: MilliConfig; dirty: boolean }) {
  const on = optionOf(cfg, k) === 'true'
  const flip = () => set(k, on ? 'false' : 'true')
  return (
    <Row label={label} px={px} dirty={dirty}>
      <span
        role="switch"
        tabIndex={0}
        aria-checked={on}
        aria-label={label}
        className={'tgl' + (on ? ' on' : '')}
        onClick={flip}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), flip())}
      />
    </Row>
  )
}

function RamRow({ cfg, totalMb, capGb, needMb, presetRamGb, mods, dirty }: Omit<FineProps, 'dirty'> & { dirty: boolean }) {
  const totalGb = totalMb > 0 ? Math.round(totalMb / GB) : 0
  // Ползунок дальше безопасного (до «всё, кроме 2 ГБ»), чтобы было видно «слишком много».
  const max = Math.max(capGb, totalGb ? Math.min(32, totalGb - 2) : 16)
  const [mbStr, setMb] = useDraft('ramMb', String(cfg.ramMb))
  const gb = Math.max(2, Math.min(max, Math.round(Number(mbStr) / GB) || 2))
  const needGb = Math.max(2, gbOf(needMb))
  const pct = (x: number) => ((Math.max(2, Math.min(max, x)) - 2) / (max - 2 || 1)) * 100
  const zoneFrom = pct(Math.min(needGb, capGb))
  const zoneTo = pct(capGb)
  // ПК неизвестен, а память прислала Милли (сервер знал машину) — не спорим.
  const low = gb < Math.min(needGb, capGb) && (totalMb > 0 || gb !== gbOf(cfg.ramMb))
  const high = gb > capGb
  const left = totalGb ? totalGb - gb : 0
  const flip = useBump(gb)
  const warn = high
    ? { cls: 'bad', ru: 'Слишком много', tip: `Windows и лаунчеру останется ${left} ГБ — компьютер начнёт тормозить` }
    : low
      ? { cls: 'mid', ru: 'Мало', tip: `Сборке на ${mods} модов нужно около ${needGb} ГБ — игра может вылетать` }
      : null
  return (
    <div className={'mcf-row mcf-ram' + (dirty ? ' dirty' : '')}>
      <span className="mcf-lab">
        <PxArt name="redstone" size={16} />
        Память
      </span>
      {warn ? (
        <span className={'mcf-warn mlm-pop ' + warn.cls} title={warn.tip}>
          {warn.ru}
        </span>
      ) : null}
      <b className="mcf-val" data-mlm-flip={flip}>
        {gb} ГБ
      </b>
      <div className="mcf-ram-track" title={`Зелёная зона — безопасно. Метка — совет: ${presetRamGb} ГБ`}>
        <i className="mcf-zone" style={{ left: zoneFrom + '%', width: Math.max(1.5, zoneTo - zoneFrom) + '%' }} aria-hidden="true" />
        <i className="mcf-tick" style={{ left: pct(presetRamGb) + '%' }} aria-hidden="true" />
        <Slider width="100%" min={2} max={max} value={gb} onChange={(v) => setMb(String(v * GB))} />
      </div>
    </div>
  )
}

// ─── Для моддеров ──────────────────────────────────────────────────────

function ModderConfig({ cfg }: { cfg: MilliConfig }) {
  return (
    <section className="mcf-modder">
      <div className="mcf-row">
        <span className="mcf-lab">
          <PxArt name="comparator" size={16} />
          JVM
        </span>
        <span className="mcf-ctl">
          <span className="mcf-seg" role="radiogroup" aria-label="Сборщик мусора">
            {(['g1', 'zgc'] as const).map((j) => (
              <button
                key={j}
                type="button"
                role="radio"
                aria-checked={cfg.jvm === j}
                title={j === 'zgc' ? 'Меньше фризов, нужна Java 21+' : 'Надёжно на любой Java'}
                className={cfg.jvm === j ? 'on' : undefined}
                onClick={() => cfg.jvm !== j && void benchOp({ op: 'config', key: 'jvm', value: j })}
              >
                {j === 'g1' ? 'G1' : 'ZGC'}
              </button>
            ))}
          </span>
        </span>
      </div>
      <div className="mcf-raw" title="options.txt — только эти ключи; бинды не трогаем">
        {OPTION_KEYS.map((k) => (
          <RawKey key={k} k={k} value={optionOf(cfg, k)} />
        ))}
      </div>
    </section>
  )
}

function RawKey({ k, value }: { k: string; value: string }) {
  const [text, setText] = useState(value)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    setText(value)
    setBad(false)
  }, [value])
  const rule = CONFIG_RULES[k]
  const hint = !rule ? '' : rule.kind === 'enum' ? rule.values.join(' | ') : `${rule.min}…${rule.max}`
  const commit = () => {
    const v = clampOption(k, text)
    if (v === null) return setBad(true)
    setBad(false)
    setText(v)
    if (v !== value) void benchOp({ op: 'config', key: k, value: v })
  }
  return (
    <label className={'mcf-raw-row' + (bad ? ' bad' : '')} title={hint}>
      <code>{k}</code>
      <span className="input sm">
        <input
          value={text}
          spellCheck={false}
          aria-invalid={bad}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setText(value)
              setBad(false)
            }
          }}
        />
      </span>
    </label>
  )
}
