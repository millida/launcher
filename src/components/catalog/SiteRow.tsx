import { useEffect, useState } from 'react'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { Icon } from '../Icon'
import { HostInstall } from '../playhub/HostInstall'
import type { HostTarget } from '../playhub/HostInstall'
import { hostingPackFor, loadHostingPacks } from '../playhub/data'
import type { HostingPack } from '../playhub/data'
import { useCatalogCtx } from './target'
import type { CatalogTarget } from './target'
import { openExt } from '../../lib/api'
import { useModAction } from '../ModRow'
import { hasTauri } from '../../ipc/tauri'
import { openProject } from '../../state/project'
import type { ModHit } from '../../state/mods'
import { useLobby } from '../../state/lobbyMode'
import { priceLabel } from '../../lib/premium'
import { newBuildFrom, planFor } from './newBuildFrom'
import {
  SIDE_LABEL,
  capFirst,
  categoryIconSrc,
  displayName,
  fmtNum,
  hostable,
  loaderIconSrc,
  loaderLabel,
  loaderTone,
  openOnSite,
  ownDownloads,
  ownPackHit,
  peekHit,
  plural,
  relativeTime,
  resolveHit,
  versionRange,
} from './site'
import type { SiteCard, SiteSection } from './site'

/*
 * Строка и карточка ленты каталога — раскладка сайта (`mr-row.tsx`,
 * `mr-gallery-card.tsx`): иконка 96×96, «Название от автор», описание в две
 * строки, ряд меток (сторона, загрузчики цветом, версии, категории); справа —
 * скачивания, «Обновлён …» и кнопки. Кнопки — лаунчерные: вместо «Скачать»
 * со страницы — «В сборку» и «Новая сборка», у готовой сборки — «Установить».
 */

/* ── Значки ─────────────────────────────────────────────────── */

/** Значок Modrinth из /mr-icons — маской, цветом текста (`MrIcon` сайта). */
export function MrIcon({ src, size = 14 }: { src: string; size?: number }) {
  return <i className="mri" aria-hidden="true" style={{ width: size, height: size, '--mri': `url("${src}")` } as CSSProperties} />
}

/** Ветка версий (Tabler git-branch) — такого значка в наборе лаунчера нет. */
function BranchIcon() {
  return (
    <svg className="mr-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M17 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M7 8v8M9 18h6a2 2 0 0 0 2 -2v-5M14 14l3 -3l3 3" />
    </svg>
  )
}

interface Tag {
  label: string
  node?: ReactNode
  tone?: string | null
  accent?: boolean
}

function sideTag(side: string | null): Tag | null {
  const s = side ? SIDE_LABEL[side] : null
  if (!s) return null
  return { label: s.label, accent: true, node: s.icon === 'globe' ? <MrIcon src="/mr-icons/categories/globe.svg" /> : <Icon id={s.icon} /> }
}

function loaderTag(l: string): Tag {
  const src = loaderIconSrc(l)
  return { label: loaderLabel(l), tone: loaderTone(l), node: src ? <MrIcon src={src} /> : null }
}

function catTag(c: string): Tag {
  const src = categoryIconSrc(c)
  return { label: capFirst(c), node: src ? <MrIcon src={src} /> : null }
}

export function Tags({ tags, className }: { tags: Tag[]; className?: string }) {
  if (!tags.length) return null
  return (
    <ul className={'mr-tags' + (className ? ' ' + className : '')} aria-label="Метки">
      {tags.map((t, i) => (
        <li
          key={t.label + i}
          className={'mr-tag' + (t.accent ? ' is-accent' : t.tone ? ' has-tone' : '')}
          style={t.tone ? ({ '--mk-tone': t.tone } as CSSProperties) : undefined}
        >
          {t.node}
          <span>{t.label}</span>
        </li>
      ))}
    </ul>
  )
}

/* ── Заглушка логотипа (CatalogCoverFallback сайта) ─────────── */

const ACCENT: Record<string, string> = { mods: '#2C8F45', shaders: '#8B45D6', maps: '#B07C1E' }

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

function shade(hex: string, seed: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const k = 0.9 + ((seed >>> 3) % 21) / 100
  const ch = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)))
  return `#${((ch((n >> 16) & 255) << 16) | (ch((n >> 8) & 255) << 8) | ch(n & 255)).toString(16).padStart(6, '0')}`
}

export function Fallback({ slug, section, title }: { slug: string; section: string; title: string }) {
  const initial = (title.replace(/^[^A-Za-zА-Яа-яЁё0-9]+/, '').charAt(0) || '?').toUpperCase()
  return (
    <span className="mr-fallback" style={{ backgroundColor: shade(ACCENT[section] || '#5ACE66', hash(slug)) }}>
      <span>{initial}</span>
    </span>
  )
}

const img = (src: string) => (
  <img
    src={src}
    alt=""
    loading="lazy"
    draggable={false}
    onError={(e) => {
      e.currentTarget.style.visibility = 'hidden'
    }}
  />
)

/* ── Кнопки ─────────────────────────────────────────────────── */

/** Не больше трёх походов за источником разом: лента — двадцать строк. */
let active = 0
const waiting: (() => void)[] = []
function queued<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      active++
      job()
        .then(resolve, reject)
        .finally(() => {
          active--
          waiting.shift()?.()
        })
    }
    if (active < 3) run()
    else waiting.push(run)
  })
}

/**
 * Карточка сайта → строка лаунчера. Своя сборка готова сразу; чужой материал
 * узнаёт источник в фоне (только в приложении — в браузере ставить нечем) или
 * по первому нажатию.
 */
function useCardHit(card: SiteCard) {
  const [hit, setHit] = useState<ModHit | null | undefined>(() => peekHit(card))
  useEffect(() => {
    if (hit !== undefined || !hasTauri()) return
    let alive = true
    void queued(() => resolveHit(card)).then((h) => alive && setHit(h))
    return () => {
      alive = false
    }
  }, [card.slug])
  const resolve = (): Promise<ModHit | null> =>
    hit !== undefined
      ? Promise.resolve(hit)
      : resolveHit(card).then((h) => {
          setHit(h)
          return h
        })
  return { hit, resolve }
}

type Want = 'add' | 'new'

function ActBar({
  label,
  plus,
  done,
  busy,
  onMain,
  onNew,
  newBusy,
  extra,
}: {
  /** «На сервер» — первой в ряду кнопок строки. */
  extra?: ReactNode
  label: string
  plus: boolean
  done: boolean
  busy: boolean
  onMain: () => void
  onNew?: () => void
  newBusy?: boolean
}) {
  return (
    <div className="mr-actions">
      {extra}
      {onNew ? (
        <button
          className="btn sm secondary"
          data-track="new_build_from"
          disabled={newBusy}
          onClick={(e) => {
            e.stopPropagation()
            onNew()
          }}
        >
          Новая сборка
        </button>
      ) : null}
      <button
        className={'btn sm ' + (done ? 'secondary done' : 'primary')}
        data-track={done ? 'installed' : plus ? 'add_to_build' : 'install'}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          onMain()
        }}
      >
        {plus ? <Icon id="i-plus" /> : null}
        {label}
      </button>
    </div>
  )
}

const CONTENT = new Set(['mod', 'resourcepack', 'shader', 'datapack'])

function Bound({ h, kind, want, onFired, extra }: { h: ModHit; kind: string; want: Want | null; onFired: () => void; extra?: ReactNode }) {
  const a = useModAction(h)
  const [making, setMaking] = useState(false)
  const content = CONTENT.has(kind)
  const canNew = content && !!planFor(h, kind)
  const makeNew = () => {
    setMaking(true)
    void newBuildFrom(h, kind).finally(() => setMaking(false))
  }
  useEffect(() => {
    if (!want) return
    onFired()
    if (want === 'add') a.onClick()
    else if (canNew) makeNew()
  }, [want])
  const label = a.done || a.running || !content ? a.text : 'В сборку'
  return (
    <>
      {a.modal}
      <ActBar
        label={label}
        plus={content && !a.done && !a.running}
        done={a.done}
        busy={a.running}
        onMain={a.onClick}
        onNew={canNew ? makeNew : undefined}
        newBusy={making}
        extra={extra}
      />
    </>
  )
}

/**
 * «На сервер» — материал на свой сервер хостинга Millida (приказ владельца
 * 24.09.2026, 18:35). Окно одно на весь лаунчер (`HostInstall`): нет сервера —
 * «Создать сервер», один — подтверждение, несколько — выбор. В панели сервера
 * ставит сразу на него.
 */
export function ServerButton({ target, primary }: { target: HostTarget; primary?: boolean }) {
  const ctx = useCatalogCtx().target
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className={'btn sm ' + (primary ? 'primary' : 'secondary') + ' mr-host'}
        data-track="to_server"
        data-sound="open"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        <Icon id="i-server" />
        На сервер
      </button>
      {open ? (
        // Портал всплывает по дереву React — клик в окне не должен открыть строку.
        <span className="mr-host-portal" onClick={(e) => e.stopPropagation()}>
          <HostInstall
            target={target}
            serverId={ctx.kind === 'server' ? ctx.serverId : undefined}
            onClose={() => setOpen(false)}
            onDone={ctx.kind === 'server' ? ctx.onInstalled : undefined}
          />
        </span>
      ) : null}
    </>
  )
}

/**
 * Своя сборка каталога (MCSborki, Arcania) хостингом ставится не по адресу
 * каталога, а целиком по ключу (`GET /hosting/packs`, как «Поставить на
 * хостинг» на странице сборки). Нет ключа — на сервер её не поставить.
 */
function usePartnerPack(card: SiteCard, sec: SiteSection): HostingPack | null {
  const want = sec.kind === 'modpack' && !!card.launcherOnly
  const [pack, setPack] = useState<HostingPack | null>(null)
  useEffect(() => {
    if (!want) return
    let alive = true
    void loadHostingPacks().then((l) => alive && setPack(hostingPackFor({ slug: card.slug, title: displayName(card.title) }, l)))
    return () => {
      alive = false
    }
  }, [want, card.slug])
  return want ? pack : null
}

/** Кнопка «На сервер» строки — или null, если материал на сервер не встаёт. */
function useServerButton(card: SiteCard, sec: SiteSection): ReactNode {
  const { target } = useCatalogCtx()
  const partner = usePartnerPack(card, sec)
  const title = displayName(card.title)
  const primary = target.kind === 'server'
  if (partner) return <ServerButton target={{ kind: 'partner', pack: partner, title }} primary={primary} />
  // В «Ресурсах» моды на сервер не ставим (владелец: «за исключением модов»);
  // в панели сервера серверные моды ставятся, как и раньше.
  const ok = target.kind === 'server' ? hostable(sec, card) : sec.kind !== 'mod' && hostable(sec, card)
  if (!ok) return null
  return <ServerButton target={{ kind: 'catalog', section: sec.slug, slug: card.slug, title }} primary={primary} />
}

function Actions({
  card,
  sec,
  hit,
  resolve,
  server,
}: {
  card: SiteCard
  sec: SiteSection
  hit: ModHit | null | undefined
  resolve: () => Promise<ModHit | null>
  server?: ReactNode
}) {
  const [want, setWant] = useState<Want | null>(null)
  const [busy, setBusy] = useState(false)
  const content = CONTENT.has(sec.kind)
  if (hit) return <Bound h={hit} kind={sec.kind} want={want} onFired={() => setWant(null)} extra={server} />
  const go = (w: Want) => {
    if (hit === null) {
      openOnSite(sec.slug, card.slug)
      return
    }
    setBusy(true)
    void resolve().then((h) => {
      setBusy(false)
      if (h) setWant(w)
      else openOnSite(sec.slug, card.slug)
    })
  }
  // До ответа источника «Новая сборка» видна там, где из вещи её можно собрать.
  const canNew = content && !!planFor(ownPackHit(card), sec.kind)
  return (
    <ActBar
      label={content ? 'В сборку' : 'Установить'}
      plus={content}
      done={false}
      busy={busy}
      onMain={() => go('add')}
      onNew={canNew ? () => go('new') : undefined}
      newBusy={busy}
      extra={server}
    />
  )
}

/** Кнопки строки: в «Ресурсах» — в сборку и «На сервер», в панели сервера — только «На сервер». */
function RowActions(props: { card: SiteCard; sec: SiteSection; hit: ModHit | null | undefined; resolve: () => Promise<ModHit | null> }) {
  const { target } = useCatalogCtx()
  const server = useServerButton(props.card, props.sec)
  if (target.kind === 'server') return <div className="mr-actions">{server}</div>
  return <Actions {...props} server={server} />
}

/* ── Строка и карточка ──────────────────────────────────────── */

export interface RowProps {
  card: SiteCard
  sec: SiteSection
  /** Своя сборка (MCSborki, Arcania) — её страница в хабе. */
  onOpenPack?: (slug: string) => void
  /** Место в ленте — для аналитики. */
  pos?: number
}

/** Тип карточки для аналитики: платная сборка — premium, карта — map. */
const trackKind = (card: SiteCard, sec: SiteSection) => (card.premium ? 'premium' : sec.kind === 'world' ? 'map' : sec.kind)

function useOpen({ card, sec, onOpenPack }: RowProps, resolve: () => Promise<ModHit | null>, target: CatalogTarget) {
  return (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    // В панели сервера окно проекта лаунчера ставит в сборку, а не на сервер —
    // подробности материала открываем на сайте.
    if (target.kind === 'server') {
      openOnSite(sec.slug, card.slug)
      return
    }
    if (card.launcherOnly) {
      if (onOpenPack) onOpenPack(card.slug)
      return
    }
    void resolve().then((h) => {
      if (h && h.slug) void openProject(h.slug, sec.kind)
      else openOnSite(sec.slug, card.slug)
    })
  }
}

function rowTags(card: SiteCard): Tag[] {
  const tags: Tag[] = []
  const side = sideTag(card.side)
  if (side) tags.push(side)
  for (const l of card.loaders.slice(0, 3)) tags.push(loaderTag(l))
  const range = versionRange(card.versions)
  if (range) tags.push({ label: range, node: <BranchIcon /> })
  for (const c of card.categories.slice(0, 3)) tags.push(catTag(c))
  return tags
}

/** Цена платной сборки — только если её прислал сервер витрины; иначе пусто. */
function usePrice(card: SiteCard): string {
  const pack = useLobby((s) => (card.premium ? s.premium.find((p) => (p.slug || p.id) === card.slug) : undefined))
  return pack ? priceLabel(pack) : ''
}

export function SiteRow(props: RowProps) {
  const { card, sec } = props
  const { hit, resolve } = useCardHit(card)
  const open = useOpen(props, resolve, useCatalogCtx().target)
  const name = displayName(card.title)
  const updated = relativeTime(card.updatedAt || card.publishedAt)
  const dl = ownDownloads(card)
  const price = usePrice(card)
  // У наших сборок логотипа нет, есть обложка — она и встаёт в квадрат 96×96
  // (правка владельца 24.09.2026: «вместо букв I, L, C — обложка сборки»).
  const logo = card.icon || card.cover
  return (
    <article
      className={'card mr-row' + (card.premium ? ' is-premium' : '')}
      data-track="row_open"
      data-kind={trackKind(card, sec)}
      data-id={card.slug}
      data-pos={props.pos}
      onClick={open}
    >
      <span className="mr-icon" aria-hidden="true">
        {logo ? img(logo) : <Fallback slug={card.slug} section={sec.slug} title={name} />}
      </span>
      <div className="mr-body">
        <div className="mr-titleline">
          <h3 className="mr-title">{name}</h3>
          {card.premium ? (
            <span className="mr-prem">
              <Icon id="i-crown" /> Премиум
            </span>
          ) : null}
          {card.author ? <span className="mr-by">от {card.author}</span> : null}
        </div>
        {card.summary ? <p className="mr-desc">{card.summary}</p> : null}
        <Tags tags={rowTags(card)} />
      </div>
      <div className="mr-side">
        {price ? <span className="mr-price">{price}</span> : null}
        {dl ? (
          <span className="mr-stat">
            <Icon id="i-download" />
            <b>{fmtNum(dl)}</b>
            <span className="mr-stat-unit">{plural(dl, 'скачивание', 'скачивания', 'скачиваний')}</span>
          </span>
        ) : null}
        {updated ? <span className="mr-upd">Обновлён {updated}</span> : null}
        <RowActions card={card} sec={sec} hit={hit} resolve={resolve} />
      </div>
    </article>
  )
}

export function SiteGalleryCard(props: RowProps) {
  const { card, sec } = props
  const { hit, resolve } = useCardHit(card)
  const open = useOpen(props, resolve, useCatalogCtx().target)
  const name = displayName(card.title)
  const updated = relativeTime(card.updatedAt || card.publishedAt)
  const tags: Tag[] = []
  for (const l of card.loaders.slice(0, 2)) tags.push(loaderTag(l))
  for (const c of card.categories.slice(0, 2)) tags.push(catTag(c))
  const range = versionRange(card.versions)
  if (range && tags.length < 4) tags.push({ label: range, node: <BranchIcon /> })
  return (
    <article
      className="card mr-gal"
      data-track="row_open"
      data-kind={trackKind(card, sec)}
      data-id={card.slug}
      data-pos={props.pos}
      onClick={open}
    >
      <span className="mr-gal-cover" aria-hidden="true">
        {card.cover ? img(card.cover) : <Fallback slug={card.slug} section={sec.slug} title={name} />}
      </span>
      <span className="mr-gal-body">
        <span className="mr-gal-icon" aria-hidden="true">
          {card.icon ? img(card.icon) : <Fallback slug={card.slug} section={sec.slug} title={name} />}
        </span>
        <h3 className="mr-gal-title">{name}</h3>
        {card.author || updated ? (
          <span className="mr-gal-author">{[card.author, updated ? 'обновлён ' + updated : ''].filter(Boolean).join(' · ')}</span>
        ) : null}
        <span className="mr-gal-summary">{card.summary}</span>
        <Tags tags={tags} className="mr-gal-tags" />
        <span className="mr-gal-foot">
          <span className="mr-gal-stat">
            {ownDownloads(card) ? (
              <>
                <Icon id="i-download" />
                <b>{fmtNum(ownDownloads(card)!)}</b>
              </>
            ) : null}
          </span>
          <RowActions card={card} sec={sec} hit={hit} resolve={resolve} />
        </span>
      </span>
    </article>
  )
}

/* ── Заглушки на время запроса ──────────────────────────────── */

export function RowSkeleton({ gallery, n = 6 }: { gallery?: boolean; n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) =>
        gallery ? (
          <div key={i} className="card mr-gal cat-skel" aria-hidden="true">
            <span className="mr-gal-cover skel"></span>
            <span className="mr-gal-body">
              <span className="skel skel-line" style={{ width: '60%' }}></span>
              <span className="skel skel-line" style={{ width: '40%', height: 10 }}></span>
            </span>
          </div>
        ) : (
          <div key={i} className="card mr-row cat-skel" aria-hidden="true">
            <span className="mr-icon skel"></span>
            <span className="mr-body">
              <span className="skel skel-line" style={{ width: 180 + ((i * 47) % 140) + 'px', height: 16 }}></span>
              <span className="skel skel-line" style={{ width: '80%', marginTop: 8 }}></span>
              <span className="skel skel-line" style={{ width: '50%', marginTop: 12, height: 10 }}></span>
            </span>
            <span className="mr-side">
              <span className="skel skel-line" style={{ width: 110 }}></span>
            </span>
          </div>
        ),
      )}
    </>
  )
}

/* ── Строка карты (CurseForge): тот же вид, данные из старого каталога ── */

export function HitRow({ h, pos }: { h: ModHit; pos?: number }) {
  const a = useModAction(h)
  return (
    <>
      {a.modal}
      <article
        className="card mr-row"
        data-track="row_open"
        data-kind="map"
        data-id={h.cfid ? String(h.cfid) : h.slug || undefined}
        data-pos={pos}
        onClick={a.onOpen}
      >
        <span className="mr-icon" aria-hidden="true">
          {h.icon ? img(h.icon) : <Fallback slug={h.slug || h.title} section="maps" title={h.title} />}
        </span>
        <div className="mr-body">
          <div className="mr-titleline">
            <h3 className="mr-title">{h.title}</h3>
            {h.author ? <span className="mr-by">от {h.author}</span> : null}
          </div>
          {h.desc ? <p className="mr-desc">{h.desc}</p> : null}
          <Tags tags={h.cats.filter(Boolean).map((c) => ({ label: capFirst(c) }))} />
        </div>
        <div className="mr-side">
          {h.dl > 0 ? (
            <span className="mr-stat">
              <Icon id="i-download" />
              <b>{fmtNum(h.dl)}</b>
              <span className="mr-stat-unit">{plural(h.dl, 'скачивание', 'скачивания', 'скачиваний')}</span>
            </span>
          ) : null}
          <ActBar
            label={a.text}
            plus={false}
            done={a.done}
            busy={a.running}
            onMain={a.onClick}
            extra={h.cfid ? <ServerButton target={{ kind: 'curseforge', projectId: String(h.cfid), title: h.title, map: true }} /> : null}
          />
        </div>
      </article>
    </>
  )
}

/**
 * Строка карты из каталога хостинга (CurseForge через `/hosting/catalog/curseforge`):
 * в панели сервера и в браузерном просмотре, где у лаунчера нет своего CurseForge.
 * Вид — та же строка ленты; кнопка — только «На сервер».
 */
export interface MapHit {
  id: number
  slug: string
  name: string
  summary: string
  iconUrl: string | null
  downloads: number
}

export function MapRow({ m, pos }: { m: MapHit; pos?: number }) {
  return (
    <article
      className="card mr-row"
      data-track="row_open"
      data-kind="map"
      data-id={String(m.id)}
      data-pos={pos}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        openExt('https://www.curseforge.com/minecraft/worlds/' + encodeURIComponent(m.slug))
      }}
    >
      <span className="mr-icon" aria-hidden="true">
        {m.iconUrl ? img(m.iconUrl) : <Fallback slug={m.slug} section="maps" title={m.name} />}
      </span>
      <div className="mr-body">
        <div className="mr-titleline">
          <h3 className="mr-title">{m.name}</h3>
        </div>
        {m.summary ? <p className="mr-desc">{m.summary}</p> : null}
      </div>
      <div className="mr-side">
        {m.downloads > 0 ? (
          <span className="mr-stat">
            <Icon id="i-download" />
            <b>{fmtNum(m.downloads)}</b>
            <span className="mr-stat-unit">{plural(m.downloads, 'скачивание', 'скачивания', 'скачиваний')}</span>
          </span>
        ) : null}
        <div className="mr-actions">
          <ServerButton target={{ kind: 'curseforge', projectId: String(m.id), title: m.name, map: true }} primary />
        </div>
      </div>
    </article>
  )
}
