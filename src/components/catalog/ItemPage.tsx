import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { Select } from '../Select'
import { openImage } from '../ImageLightbox'
import { renderMarkdown } from '../../lib/markdown'
import { MODRINTH_API, mirrorAsset, openExt } from '../../lib/api'
import { blocksToMarkdown } from '../../lib/millidaCatalog'
import { installFromCatalog } from '../../lib/catalogInstall'
import { loaderId } from '../../lib/format'
import { pickTargetName } from '../../lib/installKeys'
import { hasTauri } from '../../ipc/tauri'
import { cfFiles, cfProject } from '../../ipc/commands'
import { useMods } from '../../state/mods'
import { useProfiles } from '../../state/profiles'
import { SECTION_VISUAL } from './sections'
import type { SectionSlug } from './sections'
import { Fallback, MrIcon, RowActions, SiteGalleryCard, SourceMark, shortAuthor, useCardHit } from './SiteRow'
import { StarButton } from './StarButton'
import { PriceMark, usePaidCard } from './PaidActs'
import { useCatalogCtx } from './target'
import { MediaStrip } from './MediaStrip'
import { similarFor } from './similar'
import { RuDesc, stripAds } from './RuDesc'
import { SkinPage } from './SkinPage'
import { inTime } from '../../lib/deadline'
import { closeItem, openItem, useItem } from './itemStore'
import type { OpenItem } from './itemStore'
import {
  SIDE_LABEL,
  displayName,
  fmtNum,
  loadItem,
  loaderIconSrc,
  loaderLabel,
  loaderTone,
  ownDownloads,
  plural,
  realUpdated,
  relativeTime,
  sectionBySlug,
  siteUrl,
} from './site'
import type { ItemView, SiteCard, SiteSection, SiteSlug } from './site'
import { defaultPick, filesFor, loaderOptions, sizeLabel, spanOf, versionOptions } from './itemView'
import type { VerFile } from './itemView'
import { weaveMarkdown } from './weave'
import { foreignBody, planMedia, readsRussian, russianText, tagLabels } from './itemBody'
import '../../styles/pixel/catalog-item.css'
import { useMarketOffers, useT } from '../../i18n'

/*
 * Страница материала каталога внутри лаунчера (владелец 30.09.2026: «у
 * каждого предмета должна быть страница, куда можно зайти и что-то сделать —
 * установить, версии, описание, галерея»). Открывается поверх ленты раздела:
 * лента остаётся на месте, «Назад» и Esc возвращают к ней с той же прокруткой.
 *
 * Главная кнопка — та же, что у плитки (`RowActions`): покупка, «В сборку»,
 * «Установить», «На сервер» решаются в одном месте для ленты и страницы.
 */

type Source = 'millida' | 'modrinth' | 'curseforge'

interface ItemData {
  body: string
  /** Русский текст каталога: ИИ-статья, иначе пересказ, иначе краткое. Пусто — русского нет. */
  ru: string
  /** Тело статьи уже написано по-русски (ИИ-статья) — его и показываем, перевод не нужен. */
  ruArticle: boolean
  gallery: string[]
  files: VerFile[]
  tags: string[]
  license: string | null
  updated: string | null
  side: string | null
  website: string
  requires: { title: string; slug: string | null; section: string | null }[]
  similar: SiteCard[]
  /** Файлы ставятся по выбору версии (у Modrinth и CurseForge — только главной кнопкой). */
  pickable: boolean
}

const EMPTY: ItemData = { body: '', ru: '', ruArticle: false, gallery: [], files: [], tags: [], license: null, updated: null, side: null, website: '', requires: [], similar: [], pickable: false }

const sourceOf = (card: SiteCard): Source => (card.mrHit ? (card.mrHit.cfid !== undefined ? 'curseforge' : 'modrinth') : 'millida')

function similarCard(x: NonNullable<ItemView['similar']>[number]): SiteCard {
  return {
    slug: x.slug,
    section: x.section,
    title: x.title,
    summary: x.summary,
    cover: x.cover,
    icon: x.icon,
    side: null,
    author: null,
    downloads: x.downloads,
    versions: [],
    loaders: [],
    categories: [],
    publishedAt: null,
    updatedAt: null,
  }
}

async function loadMillida(card: SiteCard, sec: SiteSection): Promise<ItemData> {
  // Страница открыта — её запрос вперёд очереди строк ленты.
  const it = await loadItem(card.slug, false, true)
  const gallery = (it.gallery || []).filter(Boolean)
  const article = blocksToMarkdown((it.description as never) || null)
  return {
    body: article || it.summary || card.summary || '',
    ru: russianText(article, it.seoText, it.summary || card.summary),
    ruArticle: readsRussian(article),
    gallery,
    files: (it.files || []).map((f) => ({ id: f.id, name: f.version, gameVersions: f.gameVersions || [], loaders: f.loaders || [], size: f.size, date: f.releasedAt })),
    tags: (it.tags || []).slice(0, 8),
    license: it.license || null,
    updated: realUpdated(card, it.files || []),
    side: it.side || card.side,
    website: siteUrl(sec.slug, card.slug),
    // У сборок сервер отдаёт безымянные «Зависимость» без slug — это не подсказка игроку.
    requires: ((it.dependencies && it.dependencies.requires) || []).filter(
      (r, i, all) => !!r.slug && all.findIndex((x) => x.slug === r.slug) === i,
    ),
    similar: (it.similar || []).slice(0, 5).map(similarCard),
    pickable: true,
  }
}

interface MrVersion {
  id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  date_published: string
  files: { size: number }[]
}

async function loadModrinth(card: SiteCard): Promise<ItemData> {
  const slug = card.mrHit!.slug || card.slug
  const base = MODRINTH_API + '/v2/project/' + encodeURIComponent(slug)
  const [p, vers] = await Promise.all([
    fetch(base).then((r) => (r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)))),
    fetch(base + '/version').then((r) => (r.ok ? (r.json() as Promise<MrVersion[]>) : [])).catch(() => [] as MrVersion[]),
  ])
  return {
    ...EMPTY,
    body: p.body || card.summary,
    gallery: ((p.gallery || []) as { url: string }[]).map((g) => mirrorAsset(g.url) || g.url),
    files: (Array.isArray(vers) ? vers : []).slice(0, 60).map((v) => ({
      id: v.id,
      name: v.version_number || v.name,
      gameVersions: v.game_versions || [],
      loaders: v.loaders || [],
      size: (v.files && v.files[0] && v.files[0].size) || 0,
      date: v.date_published || null,
    })),
    tags: (p.categories || []).slice(0, 6),
    license: (p.license && p.license.id) || null,
    updated: p.updated || null,
    side: card.side,
    website: 'https://modrinth.com/project/' + slug,
  }
}

async function loadCurse(card: SiteCard): Promise<ItemData> {
  const cfid = card.mrHit!.cfid!
  const web = 'https://www.curseforge.com/projects/' + cfid
  if (!hasTauri()) return { ...EMPTY, body: card.summary, website: web }
  const [p, files] = await Promise.all([cfProject(cfid), cfFiles(cfid).catch(() => [])])
  return {
    ...EMPTY,
    body: p.description || p.summary,
    gallery: p.gallery.map((g) => mirrorAsset(g.url) || g.url),
    files: files
      .filter((f) => !f.server_pack)
      .slice(0, 60)
      .map((f) => ({ id: 'cf' + f.id, name: f.name || f.file_name, gameVersions: f.game_versions, loaders: f.loaders, size: f.size, date: f.date })),
    tags: p.categories.slice(0, 6),
    updated: p.updated || null,
    website: p.website || web,
  }
}

function useItemData(card: SiteCard, sec: SiteSection) {
  const [data, setData] = useState<ItemData | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let alive = true
    setData(null)
    setFailed(false)
    const src = sourceOf(card)
    // CurseForge (через ядро) и холодный сервер отвечают по 10–30 с: через 2,5 с показываем
    // суть из ленты, полное описание подменит её, когда придёт (владелец 10.10.2026: «описание
    // не грузится»). Не дольше 20 с — дальше «Повторить», а не вечная заглушка.
    const interim = window.setTimeout(
      () => alive && setData((d) => d ?? { ...EMPTY, body: card.summary, website: siteUrl(sec.slug, card.slug) }),
      2500,
    )
    const run = inTime(src === 'millida' ? loadMillida(card, sec) : src === 'modrinth' ? loadModrinth(card) : loadCurse(card), 20_000).finally(() =>
      window.clearTimeout(interim),
    )
    run.then((d) => alive && setData(d)).catch(() => alive && (setFailed(true), setData({ ...EMPTY, body: card.summary, website: siteUrl(sec.slug, card.slug) })))
    return () => {
      alive = false
    }
  }, [card.slug, sec.slug, tick])
  return { data, failed, retry: () => setTick((t) => t + 1) }
}

/** Сборка, в которую ставит «В сборку», — её версия и загрузчик выбираются первыми. */
function useTargetBuild(): { name: string; version: string; loader: string } | null {
  const scoped = useMods((s) => s.targetBuild)
  const profiles = useProfiles((s) => s.profiles)
  const selected = useProfiles((s) => s.selected)
  const name = pickTargetName(scoped, profiles.map((p) => p.name), selected || '')
  const p = profiles.find((x) => x.name === name)
  return p ? { name: p.name, version: p.version, loader: loaderId(p) } : null
}

/* ── Каркас страницы ─────────────────────────────────────────── */

export function Back({ label, onBack = closeItem }: { label: string; onBack?: () => void }) {
  const t = useT()
  return (
    <nav className="ci-crumbs" aria-label={t('Навигация')}>
      <button className="btn sm secondary ci-back" data-track="item_back" data-sound="close" onClick={onBack}>
        <Icon id="i-chev-l" />
        {t('Назад')}
      </button>
      <span className="ci-crumb">{label}</span>
    </nav>
  )
}

const SHOW_BANNER = false

export function Hero({
  cover,
  icon,
  glow,
  title,
  by,
  facts,
  cta,
  className,
  badge,
  line,
}: {
  /** Рамка партнёра и т.п. — к шапке. */
  className?: string | null
  /** Обложка полосой; нет обложки — нет полосы (владелец 06.10.2026: «не надо заглушку»). */
  cover: ReactNode | null
  icon: ReactNode
  /** Картинка значка — мягкое цветное свечение в шапке без обложки. */
  glow?: string | null
  title: string
  by: ReactNode
  facts: ReactNode[]
  cta: ReactNode
  badge?: ReactNode
  line?: string | null
}) {
  return (
    // Полосу-обложку сверху пробуем убрать у всех страниц (владелец 06.10.2026): кадры и так
    // в мини-плеере ниже. Вернуть — SHOW_BANNER = true.
    <header className={'card ci-hero' + (cover && SHOW_BANNER ? '' : ' is-flat') + (className ? ' ' + className : '')}>
      {cover && SHOW_BANNER ? (
        <div className="ci-banner">
          {cover}
          {badge}
        </div>
      ) : glow ? (
        <span className="ci-glow" aria-hidden="true" style={{ backgroundImage: 'url("' + glow + '")' }} />
      ) : null}
      <div className="ci-head">
        <span className="ci-icon">{icon}</span>
        <div className="ci-titles">
          <h1 className="ci-h1">{title}</h1>
          {line ? <span className="ci-line">{line}</span> : null}
          {by ? <span className="ci-by">{by}</span> : null}
          {facts.length ? <ul className="ci-facts">{facts.map((f, i) => <li key={i}>{f}</li>)}</ul> : null}
        </div>
        <div className="ci-cta">{cta}</div>
      </div>
    </header>
  )
}

function LoaderChip({ l }: { l: string }) {
  const src = loaderIconSrc(l)
  return (
    <span className="ci-chip" style={{ '--mk-tone': loaderTone(l) || undefined } as CSSProperties}>
      {src ? <MrIcon src={src} size={14} /> : null}
      {loaderLabel(l)}
    </span>
  )
}

export type Tab = 'desc' | 'gallery' | 'versions'

export function Tabs({ tab, onTab, gallery, versions, versionsLabel }: { tab: Tab; onTab: (t: Tab) => void; gallery: number; versions: number; versionsLabel?: string }) {
  const t = useT()
  const list: [Tab, string, number | null][] = [
    ['desc', t('Описание'), null],
    ['gallery', t('Галерея'), gallery],
    ['versions', versionsLabel ?? t('Версии'), versions],
  ]
  return (
    <div className="segs mr-subtypes ci-tabs" role="tablist">
      {list
        .filter(([k, , n]) => k === 'desc' || (n || 0) > 0)
        .map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={'seg' + (tab === k ? ' on' : '')} data-track={'item_tab_' + k} onClick={() => onTab(k)}>
            {label}
            {n ? <span className="ci-n">{n}</span> : null}
          </button>
        ))}
    </div>
  )
}

export function Gallery({ urls }: { urls: string[] }) {
  return (
    <div className="ci-gallery">
      {urls.map((u, i) => (
        <button key={u + i} className="ci-shot" data-track="item_shot" onClick={() => openImage(u)}>
          <img src={u} alt="" loading={i < 4 ? 'eager' : 'lazy'} draggable={false} />
        </button>
      ))}
    </div>
  )
}

/**
 * Описание без перевода Modrinth: русский текст каталога с кадрами по тексту, текст автора —
 * кнопкой. Русского нет — текст автора под своей пометкой.
 */
function DescBody({ body, ru, shots, author }: { body: string; ru: string; shots: string[]; author?: boolean }) {
  const t = useT()
  const [en, setEn] = useState(false)
  if (!ru && !body) return <p className="faint-note">{t('Без описания')}</p>
  const foreign = author ?? (!!body && body !== ru && !readsRussian(body))
  if (!ru || en)
    return (
      <>
        {en ? (
          <button className="ci-lang" data-track="item_desc_ru" onClick={() => setEn(false)}>
            {t('Показать по-русски')}
          </button>
        ) : foreign ? (
          <div className="ci-orig-h">{t('От автора (на английском)')}</div>
        ) : null}
        {renderMarkdown(weaveMarkdown(body, shots))}
      </>
    )
  return (
    <>
      {foreign ? (
        <button className="ci-lang" data-track="item_desc_en" onClick={() => setEn(true)}>
          {t('Оригинал на английском')}
        </button>
      ) : null}
      {renderMarkdown(ru)}
    </>
  )
}

function DescSkel() {
  return (
    <div className="ci-skel" aria-hidden="true">
      {[92, 100, 96, 70, 100, 84, 58].map((w, i) => (
        <span key={i} className="skel skel-line" style={{ width: w + '%' }} />
      ))}
    </div>
  )
}

/**
 * Выбор версии игры и загрузчика: список файлов сужается под выбор, «Поставить»
 * ставит именно этот файл. Сначала выбраны версия и загрузчик сборки, в
 * которую ставим, если под неё есть файл.
 */
function Picker({
  files,
  loaderAxis,
  pick,
  onPick,
  onInstall,
  locked,
}: {
  files: VerFile[]
  loaderAxis: boolean
  pick: { version: string | null; loader: string | null }
  onPick: (p: { version: string | null; loader: string | null }) => void
  onInstall?: (f: VerFile) => void
  locked: boolean
}) {
  const t = useT()
  const vers = versionOptions(files)
  const loaders = loaderAxis ? loaderOptions(files, pick.version) : []
  const fit = filesFor(files, pick.version, loaderAxis ? pick.loader : null)
  const file = fit[0] || null
  return (
    <section className="card ci-box ci-pick" aria-label={t('Версия')}>
      <h2 className="ci-box-h">{t('Версия')}</h2>
      {vers.length ? (
        <Select
          value={pick.version || ''}
          search={vers.length > 12}
          options={vers.map((v) => ({ value: v, label: 'Minecraft ' + v }))}
          onChange={(v) => {
            const ls = loaderAxis ? loaderOptions(files, v) : []
            onPick({ version: v, loader: pick.loader && ls.includes(pick.loader) ? pick.loader : ls[0] || null })
          }}
        />
      ) : null}
      {loaders.length > 1 ? (
        <div className="segs ci-loaders" role="group" aria-label={t('Загрузчик')}>
          {loaders.map((l) => {
            const src = loaderIconSrc(l)
            return (
              <button key={l} className={'seg' + (pick.loader === l ? ' on' : '')} aria-pressed={pick.loader === l} onClick={() => onPick({ ...pick, loader: l })}>
                {src ? <MrIcon src={src} size={14} /> : null}
                {loaderLabel(l)}
              </button>
            )
          })}
        </div>
      ) : loaders.length === 1 ? (
        <div className="ci-chips">
          <LoaderChip l={loaders[0]!} />
        </div>
      ) : null}
      {file ? (
        <div className="ci-file">
          <span className="ci-file-name">{file.name}</span>
          <span className="ci-file-size">{sizeLabel(file.size)}</span>
        </div>
      ) : (
        <div className="ci-file is-none">{t('Под этот выбор файла нет')}</div>
      )}
      {onInstall && file ? (
        <button className="btn md secondary ci-pick-go" data-track="install_version" disabled={locked} onClick={() => onInstall(file)}>
          {locked ? <Icon id="i-lock" /> : <Icon id="i-download" />}
          {t('Поставить {version}', { version: pick.version || file.name })}
        </button>
      ) : null}
    </section>
  )
}

function Versions({ files, onInstall, locked }: { files: VerFile[]; onInstall?: (f: VerFile) => void; locked: boolean }) {
  const t = useT()
  const [all, setAll] = useState(false)
  const shown = all ? files : files.slice(0, 15)
  return (
    <div className="ci-vers">
      {shown.map((f) => (
        <div key={f.id} className="ci-ver">
          <b className="ci-ver-name">{f.name}</b>
          <span className="ci-ver-game">{spanOf(f.gameVersions) || '—'}</span>
          <span className="ci-ver-ld">{f.loaders.filter((l) => l !== 'minecraft').slice(0, 2).map(loaderLabel).join(', ')}</span>
          <span className="ci-ver-size">{sizeLabel(f.size)}</span>
          <span className="ci-ver-date">{relativeTime(f.date)}</span>
          {onInstall ? (
            <button className="btn sm secondary" data-track="install_version" disabled={locked} onClick={() => onInstall(f)}>
              {locked ? <Icon id="i-lock" /> : null}
              {t('Поставить')}
            </button>
          ) : null}
        </div>
      ))}
      {files.length > shown.length ? (
        <button className="btn sm secondary ci-more" onClick={() => setAll(true)}>
          {t('Ещё {n}', { n: files.length - shown.length })}
        </button>
      ) : null}
    </div>
  )
}

export function Compat({ versions, loaders, side, extra }: { versions: string[]; loaders: string[]; side: string | null; extra?: ReactNode }) {
  const t = useT()
  const span = spanOf(versions)
  const s = side ? SIDE_LABEL[side] : null
  if (!span && !loaders.length && !s && !extra) return null
  return (
    <section className="card ci-box" aria-label={t('Совместимость')}>
      <h2 className="ci-box-h">{t('Совместимость')}</h2>
      <div className="ci-chips">
        {span ? (
          <span className="ci-chip">
            <PxIcon name="blocks" size={12} />
            {span}
          </span>
        ) : null}
        {loaders.filter((l) => l !== 'minecraft').map((l) => (
          <LoaderChip key={l} l={l} />
        ))}
        {s ? <span className="ci-chip is-accent">{s.label}</span> : null}
        {extra}
      </div>
    </section>
  )
}

/* ── Материал ленты (Millida, Modrinth, CurseForge) ─────────── */

function CardPage({ card, sec }: { card: SiteCard; sec: SiteSection }) {
  const t = useT()
  const ruContent = useMarketOffers('ru-content')
  const { target } = useCatalogCtx()
  const { hit, resolve } = useCardHit(card)
  // У карточек сайта полного описания часто нет (только короткое на английском) — берём
  // полное у Modrinth по найденному проекту (владелец 10.10.2026: «снаружи описание есть, внутри нет»).
  const [fullBody, setFullBody] = useState('')
  const [mrId, setMrId] = useState('')
  useEffect(() => {
    setFullBody('')
    setMrId('')
    let alive = true
    void resolve()
      .then((h) => {
        if (!h || h.cfid !== undefined || !(h.pid || h.slug)) return null
        if (alive) setMrId(h.pid || h.slug!)
        return fetch(MODRINTH_API + '/v2/project/' + encodeURIComponent(h.pid || h.slug!)).then((r) => (r.ok ? r.json() : null))
      })
      .then((p: { body?: string } | null) => {
        if (alive && p && p.body && p.body.length > 200) setFullBody(p.body)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [card.slug])
  const { data, failed, retry } = useItemData(card, sec)
  const paid = usePaidCard(card)
  const build = useTargetBuild()
  const [tab, setTab] = useState<Tab>('desc')
  const files = data ? data.files : []
  const [pick, setPick] = useState<{ version: string | null; loader: string | null }>({ version: null, loader: null })
  useEffect(() => setPick(defaultPick(files, build)), [data])
  useEffect(() => setTab('desc'), [card.slug])
  // «Похожие» по смыслу (similar.ts); не нашлись — запасной список сайта.
  const [like, setLike] = useState<SiteCard[] | null>(null)
  useEffect(() => {
    let alive = true
    setLike(null)
    void resolve()
      .then((h) => (h ? similarFor(h, sec.slug as SiteSlug) : []))
      .then((l) => alive && setLike(l))
      .catch(() => alive && setLike([]))
    return () => {
      alive = false
    }
  }, [card.slug])
  const similar = like && like.length >= 3 ? like : data ? data.similar : []
  const name = displayName(card.title)
  // Та же цифра, что на плитке ленты: наши скачивания или, если их мало, первоисточника.
  const dl = Math.max(ownDownloads(card) || 0, card.sourceDownloads || 0, card.mrHit?.dl || 0) || null
  const updated = relativeTime((data && data.updated) || realUpdated(card))
  // Файл по выбору ставится только своим путём каталога и только в сборку.
  const canPick = !!data && data.pickable && target.kind === 'build' && sec.source === 'listing' && sec.kind !== 'plugin' && sec.kind !== 'serverpack'
  const installFile = canPick ? (f: VerFile) => void installFromCatalog(sec.slug, card.slug, { fileId: f.id }) : undefined
  const loaderAxis = sec.loaderAxis && sec.kind !== 'shader'
  const vis = SECTION_VISUAL[sec.slug as SectionSlug] || SECTION_VISUAL.mods
  const facts: ReactNode[] = []
  if (dl)
    facts.push(
      <>
        <Icon id="i-download" />
        <b>{fmtNum(dl)}</b> {plural(dl, t('скачивание'), t('скачивания'), t('скачиваний'))}
      </>,
    )
  if (updated) facts.push(<>{t('Обновлён {when}', { when: updated })}</>)
  facts.push(
    <>
      <span className="ci-sec-ic" style={{ color: vis.tint }}>
        <PxIcon name={vis.px} size={12} />
      </span>
      {sec.title}
    </>,
  )
  const cover = card.cover || (data && data.gallery[0]) || null
  const shots = data ? data.gallery.filter((u) => u !== card.cover || data.gallery.length === 1) : []
  // Русский текст каталога забирает хвост галереи в себя; перевод Modrinth ставит картинки автора.
  const ruText = data && (data.ruArticle || !mrId) ? data.ru : ''
  const media = planMedia(ruText, shots)
  const tags = data ? tagLabels(data.tags, 8) : []
  return (
    <div className="ci" data-section="item" data-kind={sec.kind} data-id={card.slug}>
      <Back label={sec.title} />
      <Hero
        cover={cover ? <img src={cover} alt="" draggable={false} /> : null}
        glow={card.icon || null}
        icon={card.icon || card.cover ? <img src={card.icon || card.cover!} alt="" draggable={false} /> : <Fallback slug={card.slug} section={sec.slug} title={name} />}
        title={name}
        by={
          card.author ? (
            <>
              {t('от {author}', { author: shortAuthor(card.author) })}
              <SourceMark card={card} />
            </>
          ) : null
        }
        facts={facts}
        cta={
          <>
            <PriceMark card={card} />
            <RowActions card={card} sec={sec} hit={hit} resolve={resolve} />
            <StarButton wide section={sec.slug} card={card} />
          </>
        }
      />
      <div className="ci-grid">
        <main className="ci-main">
          <Tabs tab={tab} onTab={setTab} gallery={shots.length} versions={files.length} />
          {tab === 'desc' && media.strip.length ? <MediaStrip urls={media.strip} onAll={() => setTab('gallery')} /> : null}
          {tab === 'desc' ? (
            <article className="card ci-box ci-desc pj-body">
              {/* Перевод не ждёт карточку сайта: как только известен проект Modrinth — сразу он. */}
              {data && data.ruArticle && ruContent ? (
                renderMarkdown(media.body)
              ) : mrId && ruContent ? (
                <RuDesc projectId={mrId} englishBody={fullBody || (data ? data.body : '')} lead={card.summary} shots={shots} />
              ) : data === null ? (
                <>
                  {ruContent && card.summary && readsRussian(card.summary) ? <p className="ci-ru-lead">{card.summary}</p> : null}
                  {DescSkel()}
                </>
              ) : (
                <DescBody body={stripAds(ruContent ? fullBody || data.body : foreignBody(fullBody, data.body, card.summary))} ru={ruContent ? media.body : ''} shots={shots} author={ruContent ? undefined : !!fullBody} />
              )}
              {failed ? (
                <button className="btn sm secondary ci-retry" onClick={retry}>
                  <Icon id="i-restart" />
                  {t('Повторить')}
                </button>
              ) : null}
            </article>
          ) : tab === 'gallery' ? (
            <Gallery urls={shots} />
          ) : (
            <Versions files={filesFor(files, pick.version, loaderAxis ? pick.loader : null).length ? filesFor(files, pick.version, loaderAxis ? pick.loader : null) : files} onInstall={installFile} locked={paid.locked} />
          )}
        </main>
        <aside className="ci-aside">
          {files.length ? <Picker files={files} loaderAxis={loaderAxis} pick={pick} onPick={setPick} onInstall={installFile} locked={paid.locked} /> : null}
          <Compat
            versions={card.versions.length ? card.versions : [...new Set(files.flatMap((f) => f.gameVersions))]}
            loaders={card.loaders.length ? card.loaders : [...new Set(files.flatMap((f) => f.loaders))]}
            side={(data && data.side) || card.side}
          />
          {data && data.requires.length ? (
            <section className="card ci-box" aria-label={t('Нужно для работы')}>
              <h2 className="ci-box-h">{t('Нужно для работы')}</h2>
              <div className="ci-chips">
                {data.requires.map((r, i) => (
                  <button
                    key={i}
                    className="ci-chip is-link"
                    data-track="item_dep"
                    onClick={() =>
                      openItem({
                        kind: 'card',
                        section: r.section || sec.slug,
                        card: similarCard({ slug: r.slug!, section: r.section, title: r.title, summary: '', cover: null, icon: null, downloads: null }),
                      })
                    }
                  >
                    {displayName(r.title)}
                    <Icon id="i-chev-r" />
                  </button>
                ))}
              </div>
            </section>
          ) : null}
          {data && (tags.length || data.license) ? (
            <section className="card ci-box" aria-label={t('Метки')}>
              <div className="ci-chips">
                {tags.map((t) => (
                  <span key={t} className="ci-chip is-soft">
                    {t}
                  </span>
                ))}
                {data.license ? <span className="ci-chip is-soft">{data.license}</span> : null}
              </div>
            </section>
          ) : null}
          {data && data.website ? (
            <button className="btn sm ghost ci-site" data-track="item_site" onClick={() => openExt(data.website)}>
              <Icon id="i-ext" />
              {sourceOf(card) === 'millida' ? t('На millida.net') : sourceOf(card) === 'modrinth' ? 'Modrinth' : 'CurseForge'}
            </button>
          ) : null}
        </aside>
      </div>
      {similar.length ? (
        <section className="ci-similar" aria-label={t('Похожие')}>
          <h2 className="ci-sim-h">{t('Похожие')}</h2>
          <div className="mr-galgrid">
            {similar.map((c, i) => (
              <SiteGalleryCard key={c.slug} card={c} sec={c.section ? sectionBySlug(c.section) : sec} pos={i} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

/* ── Скин: рендер во весь рост и «В гардероб» ──────────────────── */

/** Страница открытого материала; Esc — назад к ленте. */
export function ItemPage({ it }: { it: OpenItem }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.modal-bg.open, .lightbox, [role="dialog"]')) return
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return
      closeItem()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  if (it.kind === 'skin') return <SkinPage key={it.skin.id} k={it.skin} />
  const sec = sectionBySlug(it.card.section && it.section === 'all' ? it.card.section : it.section)
  return <CardPage key={it.card.slug} card={it.card} sec={sec} />
}

/** Открыта ли страница материала — лента под ней прячется, но не размонтируется. */
export const useItemOpen = () => useItem((s) => s.cur)
