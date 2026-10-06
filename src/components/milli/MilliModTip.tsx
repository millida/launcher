import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { PxIcon } from '../PxIcon'
import { MODRINTH_API, mirrorAsset, openExt } from '../../lib/api'
import type { MilliItem } from '../../lib/milli'
import { McItem } from './McItem'
import { ruDescription } from './milliPackTree'
import { copyText } from '../../lib/clipboard'
import { Milli } from './Milli'
import { showToast } from '../../state/ui'

/*
 * Подсказка мода в карточке сборки (04.10.2026) — всплывающее описание
 * предмета из Minecraft: почти чёрная плашка с тёмно-фиолетовой рамкой.
 * Стоит СБОКУ от панели Милли, на уровне строки, и список под собой не
 * прячет (владелец: «подсказка закрывает строки ниже»); нет места слева —
 * над строкой или под ней внутри панели. Автор назван и кликается: Милли
 * показывает чужую работу, а не прячет её.
 *
 * Данные: необязательные поля MilliItem (author, description, downloads,
 * url — их присылает сервер); чего нет — один запрос поиска Modrinth на всю
 * сборку (`project_id` в одном фасете), запасной — на один мод при наведении.
 * Кэш — на projectId, на всё время жизни окна.
 */

// ── Рисунки предметов от художника (px/). Грузим лениво и отдельно: модуля
//    может ещё не быть (glob без совпадений — пусто), он может упасть при
//    загрузке — карточка от этого не ломается; имя не из PX_ART — запасной значок.
type PxArtProps = { name: string; size?: number; className?: string; glint?: boolean }
type PxModule = {
  PxArt?: ComponentType<PxArtProps>
  PX_ART?: Record<string, unknown>
  PxXpOrb?: ComponentType<{ size?: number; className?: string; delay?: number }>
}
const usePx = create<{ mod: PxModule | null }>(() => ({ mod: null }))
for (const load of Object.values(import.meta.glob<PxModule>('./px/index.ts'))) {
  load()
    .then((mod) => usePx.setState({ mod }))
    .catch(() => {})
}

/** Предмет Minecraft из px/, иначе запасной значок. */
export function Art({ px, size = 16, children }: { px: string; size?: number; children: ReactNode }) {
  const mod = usePx((s) => s.mod)
  const PxArt = mod?.PxArt
  return PxArt && mod?.PX_ART && Object.prototype.hasOwnProperty.call(mod.PX_ART, px) ? (
    <PxArt name={px} size={size} className="mpc-art" glint={false} />
  ) : (
    <>{children}</>
  )
}

/** Сфера опыта (анимация из px/); нет модуля — ничего. */
export function XpOrb({ size = 16 }: { size?: number }) {
  const Orb = usePx((s) => s.mod?.PxXpOrb)
  return Orb ? <Orb size={size} className="mpc-orb" /> : null
}

export interface ModInfo {
  author: string
  authorUrl: string
  description: string
  downloads: number | null
  follows: number | null
  url: string
  loaders: string[]
  /** Категории Modrinth без загрузчиков: optimization, library, worldgen… */
  categories: string[]
}

interface Hit {
  project_id: string
  slug: string
  author?: string
  organization?: string | null
  description?: string
  downloads?: number
  follows?: number
  categories?: string[]
  project_type?: string
}

const LOADERS = ['fabric', 'forge', 'neoforge', 'quilt', 'iris', 'optifine', 'canvas']
const LOADER_RU: Record<string, string> = {
  fabric: 'Fabric',
  forge: 'Forge',
  neoforge: 'NeoForge',
  quilt: 'Quilt',
  iris: 'Iris',
  optifine: 'OptiFine',
  canvas: 'Canvas',
}

/** Категории Modrinth по-русски: из них — строка описания, когда русского нет. */
const CAT_RU: Record<string, string> = {
  optimization: 'Оптимизация',
  library: 'Библиотека для других модов',
  worldgen: 'Генерация мира',
  adventure: 'Приключения',
  decoration: 'Декор и блоки',
  utility: 'Полезные мелочи',
  technology: 'Техника',
  magic: 'Магия',
  mobs: 'Новые мобы',
  equipment: 'Оружие и броня',
  food: 'Еда',
  storage: 'Хранение вещей',
  transportation: 'Транспорт',
  economy: 'Экономика',
  'game-mechanics': 'Игровые механики',
  management: 'Управление сервером',
  minigame: 'Мини-игры',
  social: 'Общение',
  cursed: 'Безумные идеи',
  combat: 'Бой',
  challenging: 'Хардкор',
  multiplayer: 'Для игры с друзьями',
  quests: 'Квесты',
  lightweight: 'Лёгкая',
  'kitchen-sink': 'Всё и сразу',
  atmosphere: 'Атмосфера',
  realistic: 'Реализм',
  'semi-realistic': 'Почти реализм',
  'vanilla-like': 'В духе ванилы',
  fantasy: 'Фэнтези',
  cartoon: 'Мультяшный стиль',
  audio: 'Звуки',
  blocks: 'Блоки',
  entities: 'Существа',
  environment: 'Окружение',
  gui: 'Интерфейс',
  items: 'Предметы',
  locale: 'Перевод',
  models: 'Модели',
  tweaks: 'Небольшие правки',
  simplistic: 'Простой стиль',
  themed: 'Тематический',
  fonts: 'Шрифты',
  shadows: 'Тени',
  reflections: 'Отражения',
  'colored-lighting': 'Цветное освещение',
  foliage: 'Живая листва',
  'path-tracing': 'Трассировка лучей',
  pbr: 'PBR-материалы',
  bloom: 'Свечение',
  potato: 'Для слабых ПК',
  low: 'Для слабых ПК',
  high: 'Для мощных ПК',
  screenshot: 'Для скриншотов',
}

/** «Оптимизация · Полезные мелочи» — до двух категорий; библиотека — одной фразой. */
export function catLine(cats: string[]): string {
  if (cats.includes('library')) return CAT_RU.library!
  return cats
    .map((c) => CAT_RU[c])
    .filter((v, i, a): v is string => !!v && a.indexOf(v) === i)
    .slice(0, 2)
    .join(' · ')
}

/** «A, B, C и ещё 2» — длинные названия модов не разворачивают плашку на полэкрана. */
const few = (a: string[]) => (a.length > 3 ? a.slice(0, 3).join(', ') + ' и ещё ' + (a.length - 3) : a.join(', '))

const isRu = (s: string) => /[а-яё]/i.test(s)

const useModInfo = create<{ map: Record<string, ModInfo> }>(() => ({ map: {} }))
const asked = new Set<string>()

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function fromHit(h: Hit): ModInfo {
  const org = h.organization || ''
  const author = org || h.author || ''
  return {
    author,
    authorUrl: org
      ? 'https://modrinth.com/organization/' + encodeURIComponent(org)
      : author
        ? 'https://modrinth.com/user/' + encodeURIComponent(author)
        : '',
    description: h.description || '',
    downloads: typeof h.downloads === 'number' ? h.downloads : null,
    follows: typeof h.follows === 'number' ? h.follows : null,
    url: 'https://modrinth.com/' + (h.project_type || 'mod') + '/' + h.slug,
    loaders: (h.categories || []).filter((c) => LOADERS.includes(c)).map((c) => LOADER_RU[c] || c),
    categories: (h.categories || []).filter((c) => !LOADERS.includes(c)),
  }
}

/** Всё, что сервер уже прислал в самом MilliItem: тогда в сеть не ходим. Поля читаем осторожно. */
function fromItem(m: MilliItem): ModInfo | null {
  const author = str(m.author)
  const downloads = typeof m.downloads === 'number' && Number.isFinite(m.downloads) ? m.downloads : null
  if (!author || downloads == null) return null
  const url = str(m.url)
  return {
    author,
    authorUrl: 'https://modrinth.com/user/' + encodeURIComponent(author),
    description: str(m.description),
    downloads,
    follows: null,
    url: /^https:\/\//.test(url) ? url : 'https://modrinth.com/project/' + m.slug,
    loaders: [],
    categories: [],
  }
}

/** Сведения о модах одним запросом поиска на сорок проектов; повторно не спрашивает. */
export function prefetchModInfo(items: MilliItem[]) {
  const map = useModInfo.getState().map
  const need = items.filter((m) => m.projectId && !map[m.projectId] && !asked.has(m.projectId) && !fromItem(m))
  if (!need.length) return
  for (let i = 0; i < need.length; i += 40) {
    const part = need.slice(i, i + 40)
    part.forEach((m) => asked.add(m.projectId))
    const facets = JSON.stringify([part.map((m) => 'project_id:' + m.projectId)])
    fetch(MODRINTH_API + '/v2/search?limit=' + part.length + '&facets=' + encodeURIComponent(facets))
      .then((r) => (r.ok ? (r.json() as Promise<{ hits?: Hit[] }>) : Promise.reject(r.status)))
      .then((r) => {
        const next = { ...useModInfo.getState().map }
        for (const h of r.hits || []) next[h.project_id] = fromHit(h)
        useModInfo.setState({ map: next })
      })
      .catch(() => part.forEach((m) => asked.delete(m.projectId)))
  }
}

export function useModMeta(m: MilliItem | null): ModInfo | null {
  const cached = useModInfo((s) => (m ? s.map[m.projectId] : undefined))
  return m ? cached || fromItem(m) : null
}

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace('.', ',') + ' млн'
  if (n >= 1_000) return Math.round(n / 1_000) + ' тыс.'
  return String(n)
}

/** Связи предмета в сборке — названиями. */
export interface TipRel {
  /** Кому нужна эта библиотека. */
  needFor: string[]
  /** Какие библиотеки нужны этому предмету. */
  needs: string[]
  /** Библиотеку убрали, а эти моды остались — они не запустятся. */
  broken: string[]
}

export interface TipTarget {
  m: MilliItem
  el: HTMLElement
  kind: string
  on: boolean
  locked: boolean
  canToggle: boolean
}

/**
 * Наведение без мерцания: открывается через 380 мс, между строками
 * переключается сразу (плашка та же, двигается и меняет текст), закрывается
 * через 240 мс, если мышь не ушла на саму плашку.
 */
export function useModTip() {
  const [tip, setTip] = useState<TipTarget | null>(null)
  const openT = useRef<number | undefined>(undefined)
  const closeT = useRef<number | undefined>(undefined)
  const shown = useRef(false)
  shown.current = !!tip
  useEffect(
    () => () => {
      window.clearTimeout(openT.current)
      window.clearTimeout(closeT.current)
    },
    [],
  )
  const show = useCallback((t: TipTarget, now = false) => {
    window.clearTimeout(closeT.current)
    window.clearTimeout(openT.current)
    if (now || shown.current) setTip(t)
    else openT.current = window.setTimeout(() => setTip(t), 380)
  }, [])
  const hide = useCallback(() => {
    window.clearTimeout(openT.current)
    window.clearTimeout(closeT.current)
    closeT.current = window.setTimeout(() => setTip(null), 240)
  }, [])
  const keep = useCallback(() => window.clearTimeout(closeT.current), [])
  const close = useCallback(() => {
    window.clearTimeout(openT.current)
    window.clearTimeout(closeT.current)
    setTip(null)
  }, [])
  /** Состояние строки поменялось (галочка) — плашка показывает новое. */
  const sync = useCallback((patch: Partial<TipTarget>) => setTip((t) => (t ? { ...t, ...patch } : t)), [])
  return { tip, show, hide, keep, close, sync }
}

const GAP = 10
const EDGE = 8

type Pos = { top: number; left: number; side: 'l' | 'u' | 'd' }

/** Слева от панели, на уровне строки; не влезает — над строкой или под ней. */
function place(panel: DOMRect, row: DOMRect, w: number, h: number): Pos {
  const vh = window.innerHeight
  if (panel.left - GAP - w >= EDGE) {
    const top = Math.max(EDGE, Math.min(row.top - 6, vh - h - EDGE))
    return { top, left: panel.left - GAP - w, side: 'l' }
  }
  const left = Math.max(panel.left + EDGE, Math.min(row.left + 44, panel.right - w - EDGE))
  const roomUp = row.top - (panel.top + 56)
  const roomDown = panel.bottom - EDGE - row.bottom
  if (roomUp >= h + 6 || roomUp > roomDown) return { top: Math.max(panel.top + 56, row.top - h - 6), left, side: 'u' }
  return { top: Math.min(row.bottom + 6, panel.bottom - h - EDGE), left, side: 'd' }
}

export function MilliModTip({
  tip,
  mc,
  loader,
  rel,
  keep,
  hide,
  close,
  onToggle,
  onOpen,
}: {
  tip: TipTarget
  /** Версия и загрузчик сборки — плашки «что поставим». */
  mc: string
  loader: string
  rel: TipRel
  keep: () => void
  hide: () => void
  close: () => void
  onToggle: () => void
  onOpen: () => void
}) {
  const panel = tip.el.closest('.ml-panel') as HTMLElement | null
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos | null>(null)
  const meta = useModMeta(tip.m)
  const [orig, setOrig] = useState(false)

  // Нет в кэше после пакетного запроса — спрашиваем один мод.
  useEffect(() => {
    if (!meta) prefetchModInfo([tip.m])
  }, [meta, tip.m])

  useLayoutEffect(() => {
    const card = ref.current
    if (!card || !panel) return
    const p = panel.getBoundingClientRect()
    const r = tip.el.getBoundingClientRect()
    if (!p.width || r.bottom < p.top || r.top > p.bottom) {
      close()
      return
    }
    const next = place(p, r, card.offsetWidth, card.offsetHeight)
    setPos((o) => (o && o.top === next.top && o.left === next.left && o.side === next.side ? o : next))
  }, [panel, tip.el, tip.m, tip.on, meta, close])

  // Прокрутили ленту, изменили окно или нажали Esc — плашка уходит сразу.
  useEffect(() => {
    const scroller = tip.el.closest('.ml-scroll')
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    scroller?.addEventListener('scroll', close, { passive: true })
    window.addEventListener('resize', close)
    window.addEventListener('keydown', key)
    return () => {
      scroller?.removeEventListener('scroll', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', key)
    }
  }, [tip.el, close])

  if (!panel) return null
  const m = tip.m
  const kindLabel =
    tip.kind === 'shader'
      ? 'Шейдер'
      : tip.kind === 'resourcepack'
        ? 'Ресурс-пак'
        : m.base && rel.needFor.length && !tip.locked
          ? 'Библиотека'
          : m.base
            ? 'Основа сборки'
            : 'Мод'
  const ru = ruDescription(m)
  const en = meta?.description && meta.description !== ru ? meta.description : ''
  const lore = ru || catLine(meta?.categories || [])
  // «Почему» Милли — если русское и не повторяет описание.
  // «Нужен для …» уже есть строкой связей — второй раз не пишем.
  const why = m.why && isRu(m.why) && m.why !== lore && m.why !== en && !/^нуж(ен|на|но|ны)\s+(для|другим)/i.test(m.why) ? m.why : ''
  const other = meta?.loaders.filter((l) => l !== loader).slice(0, 2) || []
  return createPortal(
    <div
      ref={ref}
      className={'mtip' + (pos ? ' on is-' + pos.side : '')}
      style={pos ? { top: pos.top, left: pos.left } : undefined}
      role="group"
      aria-label={m.title}
      onMouseEnter={keep}
      onMouseLeave={hide}
    >
      <div className="mtip-head">
        <span className="mtip-ic" aria-hidden="true">
          {m.icon ? <img src={mirrorAsset(m.icon)} alt="" /> : <Art px="crafting_table" size={32}><McItem name="book" size={32} /></Art>}
        </span>
        <span className="mtip-id">
          <b className="mtip-title">{m.title}</b>
          {meta?.author ? (
            <button
              type="button"
              className="mtip-author"
              data-track="milli_mod_author"
              data-id={m.slug}
              title={meta.authorUrl}
              onClick={() => openExt(meta.authorUrl)}
            >
              <Art px="player_head" size={12}>
                <PxIcon name="user" size={10} />
              </Art>
              <span>{meta.author}</span>
            </button>
          ) : meta ? null : (
            <span className="mtip-skel" style={{ width: 96 }} />
          )}
          <i className="mtip-kind">{kindLabel}</i>
        </span>
      </div>

      {/* Только по-русски и без повторов: русское описание с сервера, иначе
          строка из категорий Modrinth; английское — за «Оригинал» (для модеров). */}
      {lore ? <p className="mtip-lore">{lore}</p> : !meta && !why ? (
        <span className="mtip-lore mtip-lore-skel" aria-hidden="true">
          <span className="mtip-skel" />
          <span className="mtip-skel" style={{ width: '64%' }} />
        </span>
      ) : null}
      {en && orig ? <p className="mtip-orig" lang="en">{en}</p> : null}

      {rel.broken.length || rel.needFor.length || rel.needs.length ? (
        <p className="mtip-rel">
          {rel.broken.length ? (
            <span className="warn">Убрана — не запустятся: {few(rel.broken)}</span>
          ) : rel.needFor.length ? (
            <span className="lib">
              <i>Нужен для:</i> {few(rel.needFor)}
            </span>
          ) : null}
          {rel.needs.length ? (
            <span>
              <i>Требует:</i> {few(rel.needs)}
            </span>
          ) : null}
        </p>
      ) : null}

      <span className="mtip-tags">
        {meta?.downloads != null ? (
          <span className="mtip-dl" title="Скачиваний на Modrinth">
            <Art px="hopper" size={12}>
              <PxIcon name="download" size={10} />
            </Art>
            {fmtCount(meta.downloads)}
          </span>
        ) : null}
        {m.risk === 'proven' ? (
          <i className="mtip-tag ok" title="Эта версия уже запускалась до главного меню">
            проверен запуском
          </i>
        ) : null}
        {mc ? <i className="mtip-tag v">{mc}</i> : null}
        {loader ? <i className="mtip-tag">{loader}</i> : null}
        {other.map((l) => (
          <i key={l} className="mtip-tag dim">
            {l}
          </i>
        ))}
      </span>

      {m.risk === 'risky' ? (
        <p className="mtip-risk">
          <PxIcon name="alert" size={10} />
          <span>{m.riskNote || 'У этой версии была проблема — Милли её обошла'}</span>
        </p>
      ) : null}

      {why ? (
        <p className="mtip-why">
          <Milli size={18} mode="idle" />
          <span>{why}</span>
        </p>
      ) : null}

      <div className="mtip-acts">
        <button type="button" className="btn sm secondary mtip-btn" data-track="milli_mod_open" data-id={m.slug} onClick={onOpen}>
          <Art px="compass" size={16}>
            <PxIcon name="ext" size={10} />
          </Art>
          Открыть мод
        </button>
        {tip.locked ? (
          <span className="mtip-base">
            <PxIcon name="lock" size={10} />
            Нужен для запуска
          </span>
        ) : tip.canToggle ? (
          <button
            type="button"
            className={'btn sm mtip-btn ' + (tip.on ? 'secondary rm' : 'primary add')}
            data-track="milli_mod_toggle"
            data-id={m.slug}
            data-src="tip"
            onClick={onToggle}
          >
            {tip.on ? (
              <Art px="barrier" size={16}>
                <McItem name="barrier" size={16} />
              </Art>
            ) : (
              <PxIcon name="plus" size={10} />
            )}
            {tip.on ? 'Убрать из сборки' : 'Вернуть в сборку'}
          </button>
        ) : null}
      </div>
      <span className="mtip-foot">
        <button
          type="button"
          className="mtip-idl"
          title="Скопировать id проекта Modrinth"
          onClick={() => void copyText(m.projectId).then((ok) => ok && showToast('id скопирован', 'ok'))}
        >
          {[m.slug, m.version, m.projectId].filter(Boolean).join(' · ')}
        </button>
        {en ? (
          <button type="button" className="mtip-orig-btn" aria-pressed={orig} data-track="milli_mod_orig" onClick={() => setOrig((v) => !v)}>
            {orig ? 'Скрыть оригинал' : 'Оригинал'}
          </button>
        ) : null}
      </span>
    </div>,
    document.body,
  )
}
