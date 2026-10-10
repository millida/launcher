import { createContext, useContext, useEffect, useState } from 'react'
import { prefetchPack } from './packPrefetch'
import type { CSSProperties, MouseEvent, ReactNode } from 'react'
import { Icon } from '../Icon'
import { HostInstall } from '../playhub/HostInstall'
import type { HostTarget } from '../playhub/HostInstall'
import { blockArt, hostingPackFor, isExclusive, loadHostingPacks } from '../playhub/data'
import type { HostingPack } from '../playhub/data'
import { useCatalogCtx } from './target'
import { openExt } from '../../lib/api'
import { rowClickOpens } from '../../lib/dismiss'
import { useModAction } from '../ModRow'
import { hasTauri } from '../../ipc/tauri'
import type { ModHit } from '../../state/mods'
import { useLobby } from '../../state/lobbyMode'
import { priceLabel } from '../../lib/premium'
import { newBuildFrom, planFor } from './newBuildFrom'
import { partnerFrame } from '../premium/packView'
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
  resolveHit,
  versionRange,
} from './site'
import type { SiteCard, SiteSection } from './site'
import { BuyBar, NativeBar, PriceMark, nativeKind, usePaidCard } from './PaidActs'
import { installMillidaItem } from './millidaInstall'
import { isPaid } from './paid'
import { SECTION_VISUAL } from './sections'
import type { SectionSlug } from './sections'
import { blockFor } from './itemView'
import { openItem } from './itemStore'
import { Milli } from '../milli/Milli'
import { aiPackCode, installPackCode } from '../../lib/catalogInstall'

/** Плитка ленты: одна главная кнопка, остальное — на странице материала. */
const CompactCtx = createContext(false)

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

/*
 * Значки меток — квадратной плашкой 16×16, как на сайте (`MrTagGlyph`,
 * владелец 30.09.2026: «всё в квадратном стиле»; у загрузчика в карточке тот
 * же значок, что в фильтре). Круглых глифов нет: сторона — монитор, стойка,
 * монитор со стойкой (Tabler), версии — стопка.
 */
const GLYPH: Record<string, string> = {
  client: 'M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10z M7 20h10 M9 16v4 M15 16v4',
  server: 'M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z M7 8v.01 M7 16v.01',
  both: 'M3 5h6v14h-6l0 -14 M12 9h10v7h-10l0 -7 M14 19h6 M17 16v3 M6 13v.01 M6 16v.01',
  versions: 'M10 7a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2l0 -10 M7 7l0 10 M4 8l0 8',
}
function Glyph({ d }: { d: string }) {
  return (
    <svg className="mr-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
const SIDE_GLYPH: Record<string, string> = { CLIENT: GLYPH.client!, SERVER: GLYPH.server!, BOTH: GLYPH.both! }

/** Знак Millida Hosting — две стойки квадратами (`HostingMark` сайта). */
export function HostingMark() {
  return (
    <svg className="mr-host-mark" viewBox="0 0 16 16" aria-hidden="true">
      <path fillRule="evenodd" d="M1 1h14v6H1zM3 3v2h6V3zM11 3v2h2V3zM1 9h14v6H1zM3 11v2h6v-2zM11 11v2h2v-2z" />
    </svg>
  )
}

interface Tag {
  label: string
  node?: ReactNode
  tone?: string | null
  accent?: boolean
  /** Значок без квадратной плашки (маскот Милли). */
  bare?: boolean
}

/** Сборку собрала Милли (30.09.2026): её маскот первой меткой, как на сайте. */
const milliTag = (): Tag => ({ label: 'Милли', accent: true, bare: true, node: <Milli size={18} /> })

function sideTag(side: string | null): Tag | null {
  const s = side ? SIDE_LABEL[side] : null
  if (!s || !side) return null
  return { label: s.label, accent: true, node: <Glyph d={SIDE_GLYPH[side]!} /> }
}

function loaderTag(l: string): Tag {
  const src = loaderIconSrc(l)
  return { label: loaderLabel(l), tone: loaderTone(l), node: src ? <MrIcon src={src} size={12} /> : null }
}

function catTag(c: string): Tag {
  const src = categoryIconSrc(c)
  return { label: capFirst(c), node: src ? <MrIcon src={src} size={12} /> : null }
}

const versionsTag = (label: string): Tag => ({ label, node: <Glyph d={GLYPH.versions!} /> })

/** Квадратная плашка значка: цвет загрузчика, акцент стороны или нейтральная. */
export function TagGlyph({ node, tone, accent }: { node: ReactNode; tone?: string | null; accent?: boolean }) {
  return (
    <i
      className={'mr-tg' + (accent ? ' is-accent' : tone ? ' is-tone' : '')}
      aria-hidden="true"
      style={tone && !accent ? ({ '--mk-tone': tone } as CSSProperties) : undefined}
    >
      {node}
    </i>
  )
}

export function Tags({ tags, className }: { tags: Tag[]; className?: string }) {
  if (!tags.length) return null
  return (
    <ul className={'mr-tags' + (className ? ' ' + className : '')} aria-label="Метки">
      {tags.map((t, i) => (
        <li
          key={t.label + i}
          className={'mr-tag' + (t.accent ? ' is-accent' : t.tone ? ' has-tone' : '') + (t.bare ? ' is-bare' : '')}
          style={t.tone ? ({ '--mk-tone': t.tone } as CSSProperties) : undefined}
        >
          {t.node ? t.bare ? t.node : <TagGlyph node={t.node} tone={t.tone} accent={t.accent} /> : null}
          <span>{t.label}</span>
        </li>
      ))}
    </ul>
  )
}

/* ── Заглушка логотипа ─────────────────────────────────────────
   Не буква на зелёном (владелец 30.09.2026: «читы вообще не оформлены»), а
   блок Minecraft на цвете раздела: блок выбирается по slug, поэтому у каждой
   вещи свой и он не меняется между заходами. */

export function Fallback({ slug, section, title }: { slug: string; section: string; title: string }) {
  const vis = SECTION_VISUAL[section as SectionSlug] || SECTION_VISUAL.mods
  return (
    <span className="mr-fallback" data-title={title} style={{ '--mr-fb': vis.tint } as CSSProperties}>
      <img src={blockArt(blockFor(slug || title))} alt="" draggable={false} loading="lazy" />
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

/**
 * Карточка сайта → строка лаунчера. Своя сборка готова сразу; чужой материал
 * узнаёт источник в фоне (только в приложении — в браузере ставить нечем) или
 * по первому нажатию.
 */
export function useCardHit(card: SiteCard) {
  const [hit, setHit] = useState<ModHit | null | undefined>(() => peekHit(card))
  useEffect(() => {
    if (hit !== undefined || !hasTauri()) return
    let alive = true
    void resolveHit(card).then((h) => alive && setHit(h))
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
  /** «На хостинг» — после главной кнопки. */
  extra?: ReactNode
  label: string
  plus: boolean
  done: boolean
  busy: boolean
  onMain: () => void
  onNew?: () => void
  newBusy?: boolean
}) {
  const compact = useContext(CompactCtx)
  return (
    <div className="mr-actions">
      {onNew && !compact ? (
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
      {/* «На хостинг» — после главной кнопки, как на сайте. */}
      {extra}
    </div>
  )
}

const CONTENT = new Set(['mod', 'resourcepack', 'shader', 'datapack'])
const SITE_ONLY_KINDS = new Set(['plugin', 'serverpack', 'addon'])

function Bound({ h, kind, want, onFired, extra }: { h: ModHit; kind: string; want: Want | null; onFired: () => void; extra?: ReactNode }) {
  const game = useCatalogCtx().store((s) => s.version)
  const a = useModAction(h, kind === 'modpack' ? game : null, kind)
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
        <HostingMark />
        На хостинг
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
  // Реклама хостинга в каждой карточке (владелец 30.09.2026): «На хостинг» у
  // всего, что хостинг принимает, — и у серверных модов; у клиентских нет.
  if (!hostable(sec, card)) return null
  if (card.mrHit && card.mrHit.cfid !== undefined)
    return <ServerButton target={{ kind: 'curseforge', projectId: String(card.mrHit.cfid), title }} primary={primary} />
  if (card.mrHit) {
    const projectId = card.mrHit.pid || card.mrHit.slug
    return projectId ? <ServerButton target={{ kind: 'modrinth', projectId, title }} primary={primary} /> : null
  }
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
  const paid = usePaidCard(card)
  const content = CONTENT.has(sec.kind)
  // Вещь Millida без источника на Modrinth ставится своим файлом каталога.
  const native = () =>
    nativeKind(sec)
      ? void installMillidaItem({ slug: card.slug, title: displayName(card.title), kind: sec.kind, paid: isPaid(card.pricing, card.priceKopecks) })
      : openOnSite(sec.slug, card.slug)
  // Платное без доступа: сначала покупка, после неё — та же установка.
  if (paid.locked)
    return (
      <BuyBar
        card={card}
        extra={server}
        onOwned={() => void resolve().then((h) => (h ? setWant('add') : native()))}
      />
    )
  // Сборка Милли из каталога: файла на зеркале нет, есть код — ставится как «Сборка по коду».
  const code = sec.kind === 'modpack' ? aiPackCode(card) : null
  if (code)
    return (
      <ActBar
        label="Установить"
        plus={false}
        done={false}
        busy={busy}
        onMain={() => {
          setBusy(true)
          void installPackCode(code, displayName(card.title), {}, card.slug).finally(() => setBusy(false))
        }}
        extra={server}
      />
    )
  if (hit) return <Bound h={hit} kind={sec.kind} want={want} onFired={() => setWant(null)} extra={server} />
  if (hit === null && nativeKind(sec)) return <NativeBar card={card} sec={sec} extra={server} />
  const go = (w: Want) => {
    if (hit === null) {
      native()
      return
    }
    setBusy(true)
    void resolve().then((h) => {
      setBusy(false)
      if (h) setWant(w)
      else native()
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
export function RowActions(props: { card: SiteCard; sec: SiteSection; hit: ModHit | null | undefined; resolve: () => Promise<ModHit | null> }) {
  const { target } = useCatalogCtx()
  const compact = useContext(CompactCtx)
  const server = useServerButton(props.card, props.sec)
  if (target.kind === 'server') return <div className="mr-actions">{server}</div>
  // В сборку не ставятся: плагины и серверные сборки — на сервер, аддоны — Bedrock.
  // Вместо «Установить», за которым отказ, — «На сервер» и страница на сайте.
  if (SITE_ONLY_KINDS.has(props.sec.kind))
    return (
      <div className="mr-actions">
        {server}
        {server && compact ? null : <button
          className={'btn sm ' + (server ? 'secondary' : 'primary')}
          data-track="open_site"
          onClick={(e) => {
            e.stopPropagation()
            openOnSite(props.sec.slug, props.card.slug)
          }}
        >
          <Icon id="i-ext" />
          На сайте
        </button>}
      </div>
    )
  return <Actions {...props} server={server} />
}

/* ── Строка и карточка ──────────────────────────────────────── */

export interface RowProps {
  card: SiteCard
  sec: SiteSection
  /** Своя сборка (MCSborki, Arcania) — её страница в хабе. */
  onOpenPack?: (slug: string) => boolean | void
  /** Место в ленте — для аналитики. */
  pos?: number
  /** Раздел ленты: в «Все» у карточки первой меткой стоит её раздел, как на сайте. */
  list?: string
}

/** Тип карточки для аналитики: платная сборка — premium, карта — map. */
const trackKind = (card: SiteCard, sec: SiteSection) => (card.premium ? 'premium' : sec.kind === 'world' ? 'map' : sec.kind)

/**
 * Клик по плитке — страница материала в самом лаунчере (владелец 30.09.2026:
 * «должна быть возможность зайти в любой предмет»). Своя сборка каталога
 * (MCSborki, Arcania) — её страница хаба с «Играть» и сервером сборки.
 */
function useOpen({ card, sec, onOpenPack }: RowProps) {
  // Своя сборка (Arcania): её страницу греем, пока карточка на экране, — открывается сразу.
  useEffect(() => {
    if (!card.launcherOnly || !onOpenPack) return
    const t = window.setTimeout(() => prefetchPack(card.slug), 400)
    return () => window.clearTimeout(t)
  }, [card.slug])
  return (e: MouseEvent<HTMLElement>) => {
    if (!rowClickOpens(e)) return
    // Нет её в хабе (платные по подписке, новые) — обычная страница материала.
    if (card.launcherOnly && onOpenPack && onOpenPack(card.slug) !== false) return
    openItem({ kind: 'card', section: sec.slug, card })
  }
}

function rowTags(card: SiteCard): Tag[] {
  const tags: Tag[] = []
  if (card.aiGenerated === true) tags.push(milliTag())
  const side = sideTag(card.side)
  if (side) tags.push(side)
  for (const l of card.loaders.slice(0, 3)) tags.push(loaderTag(l))
  const range = versionRange(card.versions)
  if (range) tags.push(versionsTag(range))
  for (const c of card.categories.slice(0, 3)) tags.push(catTag(c))
  return tags
}

/** Цена платной сборки — только если её прислал сервер витрины; иначе пусто. */
function usePrice(card: SiteCard): string {
  const pack = useLobby((s) => (card.premium ? s.premium.find((p) => (p.slug || p.id) === card.slug) : undefined))
  return pack ? priceLabel(pack) : ''
}

/** «Brotatsun64, DoctorWafflePhD, 321retro» → «Brotatsun64 и ещё 2»: длинный список авторов ломал строку. */
export function shortAuthor(a: string): string {
  const names = a.split(/\s*[,;&]\s*|\s+and\s+|\s+и\s+/).map((x) => x.trim()).filter(Boolean)
  if (names.length <= 1) return a.length > 28 ? a.slice(0, 26) + '…' : a
  return names[0] + ' и ещё ' + (names.length - 1)
}

export function SiteRow(props: RowProps) {
  const { card, sec } = props
  const { hit, resolve } = useCardHit(card)
  const open = useOpen(props)
  const name = displayName(card.title)
  const dl = Math.max(ownDownloads(card) || 0, card.sourceDownloads || 0, card.mrHit?.dl || 0) || null
  const price = usePrice(card)
  // У наших сборок логотипа нет, есть обложка — она и встаёт в квадрат 96×96
  // (правка владельца 24.09.2026: «вместо букв I, L, C — обложка сборки»).
  const logo = card.icon || card.cover
  return (
    <article
      className={['card mr-row', card.premium ? 'is-premium' : '', partnerFrame(card.partner)].filter(Boolean).join(' ')}
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
          {isExclusive(card.slug) ? <span className="mr-prem excl">Эксклюзив</span> : null}
          {card.author ? <span className="mr-by" title={card.author}>от {shortAuthor(card.author)}</span> : null}
          {dl ? (
            <span className="mr-dl" title={fmtNum(dl) + ' ' + plural(dl, 'скачивание', 'скачивания', 'скачиваний')}>
              <Icon id="i-download" />
              {fmtNum(dl)}
            </span>
          ) : null}
        </div>
        {card.summary ? <p className="mr-desc">{card.summary}</p> : null}
        <Tags tags={rowTags(card)} />
      </div>
      <div className="mr-side">
        <PriceMark card={card} fallback={price} />
        <RowActions card={card} sec={sec} hit={hit} resolve={resolve} />
      </div>
    </article>
  )
}

/**
 * Плитка ленты (владелец 30.09.2026: «карточки слишком большие — минимум три в
 * ряд в неполном окне»): обложка 16:9, значок, название, автор, одна строка
 * описания, две метки, скачивания и одна главная кнопка. Всё остальное —
 * «Новая сборка», «На сервер», версии — на странице материала.
 */
/**
 * Плитка ленты (06.10.2026, владелец: «как человеку понять, что мне скачивать — на Modrinth лучше»):
 * три в ряд; сверху — скриншот, только если он настоящий (не растянутый логотип); ниже значок,
 * название и автор, описание в две строки — что это за вещь, метки (категория и загрузчики),
 * скачивания и тихая «В сборку».
 */
export function SiteGalleryCard(props: RowProps) {
  const { card, sec } = props
  const { hit, resolve } = useCardHit(card)
  const open = useOpen(props)
  const name = displayName(card.title)
  // Обложка = логотип или крошечная картинка — растянутые пиксели; такую не показываем.
  const [tiny, setTiny] = useState(false)
  // Моды, плагины, дата-паки выбирают по описанию — там плитки одинаковые, без картинки сверху
  // (смесь «с картинкой / без» рвала ряды). Картинка — где смотрят глазами: шейдеры, текстуры, сборки, карты.
  // Карточки — вид «с картинкой» (переключатель над лентой): картинка у всех, нет скриншота — значок на размытом фоне.
  const visual = true
  const shot = visual && card.cover && card.cover !== card.icon && !tiny ? card.cover : null
  const tags: Tag[] = []
  if (card.aiGenerated === true) tags.push(milliTag())
  if (props.list === 'all') tags.push({ label: sec.title })
  if (card.edition === 'BEDROCK') tags.push({ label: 'Bedrock' })
  if (card.categories[0]) tags.push(catTag(card.categories[0]))
  for (const l of card.loaders.filter((x) => x !== 'minecraft').slice(0, 2)) tags.push(loaderTag(l))
  const range = versionRange(card.versions)
  if (range && tags.length < 2) tags.push(versionsTag(range))
  // Скачивания — у всех (владелец 06.10.2026): наши, а если их мало — первоисточника.
  const dl = Math.max(ownDownloads(card) || 0, card.sourceDownloads || 0, card.mrHit?.dl || 0) || null
  const logo = card.icon || card.cover
  const badge = isExclusive(card.slug) ? <span className="ph-card-tag excl">Эксклюзив</span> : card.premium ? <span className="ph-card-tag prem">Премиум</span> : null
  return (
    <CompactCtx.Provider value={true}>
      <article
        className={['card mr-gal', shot ? 'has-shot' : 'no-shot', card.premium ? 'is-premium' : '', partnerFrame(card.partner)].filter(Boolean).join(' ')}
        data-track="row_open"
        data-kind={trackKind(card, sec)}
        data-id={card.slug}
        data-pos={props.pos}
        onClick={open}
      >
        {/* В «визуальных» разделах полоса картинки есть у всех — иначе ряды разной высоты:
            нет скриншота — логотип на своей размытой копии. */}
        {!shot && visual && logo ? (
          <span className="mr-gal-cover" aria-hidden="true">
            <span className="mr-gal-iconcover">
              {img(logo)}
              {img(logo)}
            </span>
            {badge}
          </span>
        ) : null}
        {shot ? (
          <span className="mr-gal-cover" aria-hidden="true">
            <img
              src={shot}
              alt=""
              loading="lazy"
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth: w, naturalHeight: h } = e.currentTarget
                // Крошечная или квадратная (логотип, растянутый в обложку) — не скриншот.
                if (w < 360 || (h > 0 && Math.abs(w / h - 1) < 0.2)) setTiny(true)
              }}
              onError={() => setTiny(true)}
            />
            {badge}
          </span>
        ) : null}
        <span className="mr-gal-body">
          <span className="mr-gal-head">
            <span className="mr-gal-icon" aria-hidden="true">
              {logo ? img(logo) : <Fallback slug={card.slug} section={sec.slug} title={name} />}
            </span>
            <span className="mr-gal-names">
              <h3 className="mr-gal-title">{name}</h3>
              <span className="mr-gal-author">
                <span className="mr-gal-by" title={card.author || undefined}>{card.author ? 'от ' + shortAuthor(card.author) : sec.title}</span>
                {dl ? (
                  <span className="mr-gal-dl" title="Скачиваний">
                    <Icon id="i-download" />
                    {fmtNum(dl)}
                  </span>
                ) : null}
              </span>
            </span>
            {shot || (visual && logo) ? null : badge}
          </span>
          {card.summary ? <span className="mr-gal-summary">{card.summary}</span> : null}
          <Tags tags={tags.slice(0, 3)} className="mr-gal-tags" />
          <span className="mr-gal-foot">
            <span className="mr-gal-stat">
              <PriceMark card={card} />
            </span>
            <RowActions card={card} sec={sec} hit={hit} resolve={resolve} />
          </span>
        </span>
      </article>
    </CompactCtx.Provider>
  )
}

/* ── Заглушки на время запроса ──────────────────────────────── */

/**
 * Заглушки той же разметки и тех же классов, что настоящие карточки: высота строк
 * задаётся шрифтом, как у текста, — когда приходят данные, ничего не сдвигается
 * (владелец 10.10.2026: «после скелетона всё как будто двигается»).
 */
export function RowSkeleton({ gallery, n = 6, actions = true }: { gallery?: boolean; n?: number; actions?: boolean }) {
  const bar = (w: number | string, k?: number) => <span key={k} className="skel-text" style={{ width: typeof w === 'number' ? w + 'px' : w }} />
  return (
    <>
      {Array.from({ length: n }, (_, i) =>
        gallery ? (
          <div key={i} className="card mr-gal has-shot cat-skel" aria-hidden="true">
            <span className="mr-gal-cover skel"></span>
            <span className="mr-gal-body">
              <span className="mr-gal-head">
                <span className="mr-gal-icon skel"></span>
                <span className="mr-gal-names">
                  <span className="mr-gal-title">{bar(['62%', '48%', '70%'][i % 3]!)}</span>
                  <span className="mr-gal-author">{bar(['38%', '30%', '44%'][i % 3]!)}</span>
                </span>
              </span>
              <span className="mr-gal-summary">
                {bar('96%')}
                <br />
                {bar(['70%', '54%', '80%'][i % 3]!)}
              </span>
              <ul className="mr-tags mr-gal-tags">
                <li className="mr-tag">{bar(84)}</li>
                <li className="mr-tag">{bar(56)}</li>
              </ul>
              <span className="mr-gal-foot">
                <span className="mr-gal-stat"></span>
                {actions ? (
                  <span className="mr-actions">
                    <span className="btn sm secondary skel-btn"></span>
                  </span>
                ) : null}
              </span>
            </span>
          </div>
        ) : (
          <div key={i} className="card mr-row cat-skel" aria-hidden="true">
            <span className="mr-icon skel"></span>
            <div className="mr-body">
              <div className="mr-titleline">
                <span className="mr-title">{bar(160 + ((i * 47) % 120))}</span>
              </div>
              <p className="mr-desc">{bar('78%')}</p>
              <ul className="mr-tags">
                <li className="mr-tag">{bar(70)}</li>
                <li className="mr-tag">{bar(54)}</li>
              </ul>
            </div>
            <div className="mr-side">
              <span className="mr-actions">
                <span className="btn sm secondary skel-btn"></span>
              </span>
            </div>
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
