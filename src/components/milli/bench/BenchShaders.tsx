import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { PxArt } from '../px'
import { MODRINTH_API, mirrorAsset } from '../../../lib/api'
import type { MilliItem, MilliLevel, MilliPack, MilliProfile, MilliTab } from '../../../lib/milli'
import { milliPc } from '../../../lib/milli'
import { benchOp, useBench } from '../../../state/milliBench'
import { openPicker } from '../../../state/milliPicker'
import { sendMilli } from '../../../state/milli'
import { activeShader, configOf, shaderCards, shaderLevelOf } from './benchTabs'
import '../../../styles/pixel/milli-bench-tabs.css'
import '../../../styles/pixel/milli-looks.css'

// ─── Общее для вкладок FE-tabs ─────────────────────────────────────────

/**
 * Корень тела вкладки внутри карточки сборки. Прокрутку и её восстановление
 * держит карточка-хост (`.mpc-body[data-bench-scroll]`), здесь — только разметка.
 */
export function BenchTabFrame({ tab, children }: { tab: MilliTab; children: ReactNode }) {
  return <div className={'bt bt-' + tab}>{children}</div>
}

/** Иконка предмета в ячейке инвентаря; без картинки — пиксельный блок. */
export function BenchSlot({ item, px, size = 40 }: { item: Partial<MilliItem>; px: string; size?: number }) {
  const [bad, setBad] = useState(false)
  return (
    <span className="bt-slot" style={{ width: size, height: size }} aria-hidden="true">
      {item.icon && !bad ? (
        <img src={mirrorAsset(item.icon)} alt="" loading="lazy" width={size - 8} height={size - 8} onError={() => setBad(true)} />
      ) : (
        <PxArt name={px} size={size >= 36 ? 32 : 16} />
      )}
    </span>
  )
}

/** Пустая вкладка: одна строка и кнопка, которая просит Милли в чате. */
export function BenchEmpty({ px, text, ask, label = 'Подобрать' }: { px: string; text: string; ask: string; label?: string }) {
  return (
    <div className="bt-empty">
      <PxArt name={px} size={48} className="bt-empty-px" />
      <p>{text}</p>
      <button className="btn sm primary" onClick={() => void sendMilli(ask)}>
        {label}
      </button>
    </div>
  )
}

export const useHead = () => useBench((s) => s.head)
export const useModder = () => useBench((s) => s.ui.modder)

// ─── Картинки из галереи Modrinth ──────────────────────────────────────

/** Что знаем о проекте для «витрины»: картинка галереи и разрешение (ресурс-паки). */
export interface Look {
  img: string | null
  res: string | null
  /** Запасная картинка, если `img` не загрузилась. */
  alt?: string | null
}

/*
 * Галерея курируемой лестницы (presets.ts) и образцов стилей — сразу, без
 * запроса (Modrinth /v2/projects, 04.10.2026). Остальное — один пакетный
 * запрос на вкладку через наш прокси, кэш на весь запуск. Когда сервер начнёт
 * слать `preview`/`res` в MilliItem, запроса не будет вовсе.
 */
const G = (id: string, file: string) => `https://cdn.modrinth.com/data/${id}/images/${file}_350.webp`
const KNOWN: Record<string, Look> = {
  'makeup-ultra-fast-shaders': { img: G('izsIPI7a', '97776ad4f19f734243dbb301feaf81c327bae96b'), res: null },
  'miniature-shader': { img: G('UaS8ROxa', '47126cd6cc7ab7083c14fce162d185aa7e9953f4'), res: null },
  'sildurs-vibrant-shaders': { img: G('z8EjLYqN', 'f805e5d32d4941eb33c4273cc908f70fca2753d5'), res: null },
  'complementary-reimagined': { img: G('HVnmMxH1', '111e76bfa966c68b3581a93f7322588e642ce4db'), res: null },
  'bsl-shaders': { img: G('Q1vvjJYV', '40b899ae09647c98722d67bb2288f790ae28b4fc'), res: null },
  'super-duper-vanilla': { img: G('LMIZZNxZ', 'a1b45a0d10ff893cb4247979ced0ff0b9ce182a9'), res: null },
  'complementary-unbound': { img: G('R6NEzAwj', 'a5a420ab1668bcfe47a76a812eede7056c45fe31'), res: null },
  'photon-shader': { img: G('lLqFfGNs', 'a7205115d731077733ab5cdcc639e5531f2dee12'), res: null },
  'bliss-shader': { img: G('ZvMtQlho', '7ceb3b0fcd9ccdbd5fc4bdc80ba7ee766509c69f'), res: null },
  'solas-shader': { img: G('EpQFjzrQ', 'b87a4f77d7858c6b8fb9ecc40301f9d189a52c44'), res: null },
  'rethinking-voxels': { img: G('kmwfVOoi', 'c2de214a7981a9b0235b46209507eb9c0b225ddc'), res: null },
  'fresh-animations': { img: G('50dA9Sha', 'c6a5bc8c69dea40a3d6f343390d04f2fc01fb0d6'), res: '16x' },
  'better-leaves': { img: G('uvpymuxq', 'f77ee8c99782e2f5b1754fb8189acf70bb4ed2ca'), res: null },
  'faithful-32x': { img: G('w0TnApzs', '8326664336340fe1919056f86d8d6009d06ad2e8'), res: '32x' },
}

/** Картинки-образцы стилей ресурс-паков (самые скачиваемые паки стиля). */
export const STYLE_IMG: Record<string, string> = {
  faithful: G('w0TnApzs', '8326664336340fe1919056f86d8d6009d06ad2e8'),
  fantasy: G('LSmohupN', '4619b32abb8a20293bc78a628dc64463fb06b160'),
  realistic: G('wCD3KHxh', '5ac423015fbdbe1e733444aa634d4b30bf2b55db'),
  cartoon: G('ihLpbKsi', '4a7297254bf295025085cb8ba20d75d31c9fae68'),
  pvp: G('BpaObV8j', '1cc5fd2aa69cc23f249a0fa9d7b16d6683502ad7'),
  medieval: G('as1NtCKY', '11cbf713540a0b99e0d7bdbaf9f2684c64ff58b4'),
  dark: G('zQHARVIr', 'cfef66f903d66e5d96301c31f308c3cb1142466d'),
}

const RES_RX = /^(\d+)x(\+|-)?$/
/** Самое крупное разрешение из тегов Modrinth («16x», «64x», «512x+»). */
export function topRes(tags: readonly string[] | undefined): string | null {
  let best: { n: number; t: string } | null = null
  for (const t of tags ?? []) {
    const m = RES_RX.exec(t)
    if (!m) continue
    const n = Number(m[1])
    if (!best || n > best.n) best = { n, t: m[2] === '+' ? `${m[1]}x+` : `${m[1]}x` }
  }
  return best ? best.t : null
}

/** 64x и выше — тяжело для слабого ПК (presets.ts: слабому — до 16x, среднему — до 32x). */
export const resNum = (res: string | null | undefined) => (res ? Number(RES_RX.exec(res)?.[1] ?? 0) : 0)

const looks = new Map<string, Look | null>()
const asked = new Set<string>()
const subs = new Set<() => void>()
let ver = 0
const bump = () => {
  ver++
  for (const f of subs) f()
}

type MrProject = { id: string; slug: string; categories?: string[]; additional_categories?: string[]; gallery?: { url: string; featured?: boolean; ordering?: number }[] }

function want(slugs: string[]) {
  const miss = [...new Set(slugs)].filter((s) => s && !(s in KNOWN) && !looks.has(s) && !asked.has(s)).slice(0, 40)
  if (!miss.length) return
  for (const s of miss) asked.add(s)
  const url = MODRINTH_API + '/v2/projects?ids=' + encodeURIComponent(JSON.stringify(miss))
  fetch(url)
    .then((r) => (r.ok ? (r.json() as Promise<MrProject[]>) : []))
    .then((list) => {
      for (const p of Array.isArray(list) ? list : []) {
        if (!p || !p.slug) continue
        const g = [...(p.gallery ?? [])].sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || (a.ordering ?? 0) - (b.ordering ?? 0))[0]
        const look: Look = { img: g?.url ?? null, res: topRes([...(p.categories ?? []), ...(p.additional_categories ?? [])]) }
        looks.set(p.slug, look)
        looks.set(p.id, look)
      }
      for (const s of miss) if (!looks.has(s)) looks.set(s, null)
      bump()
    })
    .catch(() => {
      // Сеть: попробуем при следующем открытии вкладки.
      for (const s of miss) asked.delete(s)
    })
}

type Lookable = Pick<MilliItem, 'slug' | 'projectId'> & { preview?: string | null; res?: string | null }

/** Картинка и разрешение для предмета: поле сервера → известные → кэш запроса. */
export function lookOf(item: Lookable): Look {
  const known = KNOWN[item.slug] ?? looks.get(item.slug) ?? looks.get(item.projectId) ?? null
  const img = item.preview || known?.img || null
  return { img, res: item.res || known?.res || null, alt: known?.img && known.img !== img ? known.img : null }
}

/** Подписка на кэш картинок; дозапрашивает недостающие одним запросом. */
export function useLooks(items: readonly Lookable[]): number {
  const v = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => void subs.delete(f)
    },
    () => ver,
  )
  const key = items.map((i) => (i.preview ? '' : i.slug)).join(',')
  useEffect(() => {
    if (key) want(key.split(',').filter(Boolean))
  }, [key])
  return v
}

/** Картинка-превью: галерея → иконка на размытом фоне → пиксельный блок. */
export function LookPic({ src, alt, icon, px, className, eager }: { src: string | null; alt?: string | null; icon?: string | null; px: string; className?: string; eager?: boolean }) {
  const [bad, setBad] = useState<readonly string[]>([])
  const [ready, setReady] = useState<string | null>(null)
  const img = [src, alt].find((u): u is string => !!u && !bad.includes(u)) ?? null
  const ico = !img && icon && !bad.includes(icon) ? icon : null
  return (
    <span className={'lk-pic' + (className ? ' ' + className : '') + (img ? '' : ' is-flat')} aria-hidden="true">
      {img ? (
        <img
          key={img}
          src={mirrorAsset(img)}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={'lk-pic-main' + (ready === img ? ' is-in' : '')}
          onLoad={() => setReady(img)}
          onError={() => setBad((b) => [...b, img])}
        />
      ) : ico ? (
        <>
          <img src={mirrorAsset(ico)} alt="" className="lk-pic-blur" onError={() => setBad((b) => [...b, ico])} />
          <img src={mirrorAsset(ico)} alt="" className="lk-pic-ico" />
        </>
      ) : (
        <PxArt name={px} size={32} className="lk-pic-px" />
      )}
    </span>
  )
}

// ─── ПК игрока и FPS ───────────────────────────────────────────────────

/** Сила ПК: профиль сборки (сервер считал по железу), иначе ОЗУ из ядра. */
export function usePcTier(pack: Pick<MilliPack, 'config' | 'mods' | 'shaders'>): MilliProfile {
  const [ram, setRam] = useState(0)
  const has = !!pack.config
  useEffect(() => {
    if (has) return
    let live = true
    void milliPc().then((p) => live && p && setRam(p.ramMb))
    return () => void (live = false)
  }, [has])
  if (has) return configOf(pack).profile
  if (!ram) return 'balanced'
  return ram <= 8192 ? 'low' : ram <= 16384 ? 'balanced' : 'high'
}

/** good — «летает», mid — «пойдёт», bad — «будет лагать». */
export type Fit = 'good' | 'mid' | 'bad'
const FIT: Record<MilliLevel, Record<MilliProfile, Fit>> = {
  off: { low: 'good', balanced: 'good', high: 'good' },
  light: { low: 'mid', balanced: 'good', high: 'good' },
  medium: { low: 'bad', balanced: 'good', high: 'good' },
  heavy: { low: 'bad', balanced: 'mid', high: 'good' },
}
export const fitOf = (level: MilliLevel, tier: MilliProfile): Fit => FIT[level][tier]
export const FIT_RU: Record<Fit, string> = { good: 'Летает', mid: 'Пойдёт', bad: 'Лагает' }
const FIT_TIP: Record<Fit, string> = {
  good: 'На твоём ПК FPS почти не упадёт',
  mid: 'На твоём ПК FPS заметно упадёт',
  bad: 'Для твоего ПК тяжело: будет лагать',
}

/** Индикатор FPS: 3 пиксельные полоски цвета «светофора». */
export function FpsMeter({ fit, label = true }: { fit: Fit; label?: boolean }) {
  const n = fit === 'good' ? 3 : fit === 'mid' ? 2 : 1
  return (
    <span className={'lk-fps fit-' + fit} title={FIT_TIP[fit]} aria-label={'FPS: ' + FIT_RU[fit]}>
      <span className="lk-fps-bars" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <i key={i} className={i <= n ? 'on' : undefined} />
        ))}
      </span>
      {label ? <b>FPS</b> : null}
    </span>
  )
}

/** Пиксельный огонёк (уровень шейдеров = 1–3 огонька). */
function Flame({ dim }: { dim?: boolean }) {
  return (
    <svg className={'lk-flame' + (dim ? ' dim' : '')} viewBox="0 0 8 10" width="12" height="15" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#ff5a1f" d="M3 0h1v1h1v1h1v2h1v4h-1v1h-1v1h-3v-1h-1v-1h-1v-3h1v-1h1v-2h1z" />
      <path fill="#ffb02e" d="M3 3h1v1h1v2h1v2h-1v1h-3v-1h-1v-2h1v-1h1z" />
      <path fill="#fff3a8" d="M3 6h1v1h1v1h-3v-1h1z" />
    </svg>
  )
}

const LEVELS: readonly { id: MilliLevel; ru: string; flames: number }[] = [
  { id: 'off', ru: 'Выкл', flames: 0 },
  { id: 'light', ru: 'Лёгкие', flames: 1 },
  { id: 'medium', ru: 'Средние', flames: 2 },
  { id: 'heavy', ru: 'Тяжёлые', flames: 3 },
]

/** Подпись загрузчика шейдеров: Iris на Fabric/Quilt/NeoForge, Oculus на Forge. */
export function shaderLoaderName(pack: Pick<MilliPack, 'shaderLoader' | 'loader'>): string {
  const t = pack.shaderLoader?.title
  if (t) return /oculus/i.test(t) ? 'Oculus' : /iris/i.test(t) ? 'Iris' : t
  return pack.loader === 'forge' ? 'Oculus' : 'Iris'
}

// ─── Шейдеры ───────────────────────────────────────────────────────────

export function BenchShaders() {
  const head = useHead()
  if (!head) return null
  return (
    <BenchTabFrame tab="shaders">
      <Shaders pack={head} />
    </BenchTabFrame>
  )
}

function Shaders({ pack }: { pack: MilliPack }) {
  const modder = useModder()
  const tier = usePcTier(pack)
  const level = shaderLevelOf(pack)
  const active = activeShader(pack)
  const cards = shaderCards(pack, level).slice(0, 4)
  // Картинки всех уровней — заранее: смена уровня без пустого кадра.
  const all = [...(pack.shaderChoices ?? []), ...(active ? [active] : [])].filter(Boolean)
  useLooks(all)
  const hero = level === 'off' ? null : active && (active.level ?? level) === level ? active : (cards[0] ?? null)
  const loader = shaderLoaderName(pack)

  // Уровень — варианты на выбор прямо в ленте; конкретный шейдер из списка ставится сразу.
  const setLevel = (l: MilliLevel) => {
    if (l === level && l !== 'off') return openPicker('shader', l, LEVELS.find((x) => x.id === l)?.ru ?? l)
    if (l === level) return
    if (l === 'off') return void benchOp({ op: 'shader_level', level: 'off' })
    openPicker('shader', l, LEVELS.find((x) => x.id === l)?.ru ?? l)
  }
  const pick = (s: MilliItem) => {
    if (active?.projectId !== s.projectId) void benchOp({ op: 'add', tab: 'shaders', ref: s.slug || s.projectId })
  }

  return (
    <div className="lk lk-shaders">
      <div className="lk-levels" role="radiogroup" aria-label="Шейдеры">
        {LEVELS.map((l) => {
          const fit = fitOf(l.id, tier)
          const on = level === l.id
          return (
            <button
              key={l.id}
              role="radio"
              aria-checked={on}
              className={'lk-level mlm-press lv-' + l.id + ' fit-' + fit + (on ? ' on' : '')}
              title={l.id === 'off' ? 'Без шейдеров' : FIT_TIP[fit]}
              onClick={() => setLevel(l.id)}
            >
              <span className="lk-level-ic">
                {l.flames ? Array.from({ length: l.flames }, (_, i) => <Flame key={i} />) : <PxArt name="redstone_lamp_off" size={16} />}
              </span>
              <span className="lk-level-t">{l.ru}</span>
              <i className="lk-level-fit" aria-hidden="true" />
            </button>
          )
        })}
      </div>

      {level === 'off' ? (
        <div className="lk-hero is-off" key="off">
          <span className="lk-hero-off">
            <PxArt name="redstone_lamp_off" size={48} />
            <b>Без шейдеров</b>
          </span>
          <span className="lk-hero-top">
            <FpsMeter fit="good" />
          </span>
        </div>
      ) : hero ? (
        <Hero s={hero} fit={fitOf(hero.level ?? level, tier)} loader={loader} modder={modder} />
      ) : (
        <BenchEmpty px="glowstone" text="Тут пока пусто" ask="подбери шейдеры" />
      )}

      {level !== 'off' && cards.length > 1 ? (
        <div className="lk-swap" role="radiogroup" aria-label="Другой шейдер">
          {cards.map((s, i) => {
            const on = (active?.projectId ?? hero?.projectId) === s.projectId
            const look = lookOf(s)
            return (
              <button
                key={s.projectId}
                role="radio"
                aria-checked={on}
                className={'lk-swap-it mlm-press mlm-pop' + (on ? ' on' : '')}
                style={{ '--i': i } as CSSProperties}
                title={s.title}
                onClick={() => pick(s)}
              >
                <LookPic src={look.img} alt={look.alt} icon={s.icon} px="glowstone" className="lk-swap-pic" />
                <span className="lk-swap-t">{shortName(s.title)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

/** «Complementary Shaders - Reimagined» → «Complementary Reimagined»: 1–2 слова на плитке. */
export function shortName(title: string): string {
  const words = title
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(shaders?|shader ?pack|resource ?pack|texture ?pack|pack|\d+x\d*|v?\d+(\.\d+)+)\b/gi, ' ')
    .split(/[\s\-–—:|]+/)
    .filter(Boolean)
  const out = words.slice(0, 2).join(' ')
  return out || title
}

function Hero({ s, fit, loader, modder }: { s: MilliItem; fit: Fit; loader: string; modder: boolean }) {
  const look = lookOf(s)
  return (
    <div className="lk-hero" key={s.projectId}>
      <LookPic src={look.img} alt={look.alt} icon={s.icon} px="glowstone" className="lk-hero-pic" eager />
      <span className="lk-hero-top">
        <span className="lk-chip" title={`${loader} поставится сам — без него шейдеры не работают`}>
          <PxArt name="glowstone" size={16} />+{loader}
        </span>
        <FpsMeter fit={fit} />
      </span>
      <span className="lk-hero-foot">
        <b className="lk-hero-t">{shortName(s.title)}</b>
        {modder ? (
          <span className="lk-hero-mod">
            {s.dh ? <span className="bt-badge dh">DH</span> : null}
            <span className="bt-badge mono">{s.slug + (s.version ? ' · ' + s.version : '')}</span>
          </span>
        ) : null}
      </span>
    </div>
  )
}
