import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { MODRINTH_API, api, mirrorAsset } from '../../lib/api'
import { fmtN } from '../../lib/format'
import { renderMarkdown } from '../../lib/markdown'
import { installedPack } from '../../lib/lobbyPlay'
import { loadPremium, loadPremiumPack, untilText } from '../../lib/premium'
import type { PremiumPackDetail, PremiumPlan, PremiumSubscription } from '../../lib/premium'
import { BuyButton, CancelLine, PriceLine } from '../premium/PremiumBuy'
import { installModpack } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { useProfiles } from '../../state/profiles'
import { runInstall, useInstalls } from '../../state/installs'
import { showToast } from '../../state/ui'
import { track } from '../../lib/telemetry'
import { actionSource } from '../../lib/uiTrack'
import { keyCatalogPack, keyMrModpack } from '../../lib/installKeys'
import type { SnapshotServer } from '../../lib/snapshot'
import { Carousel } from './Carousel'
import { Hours } from './Hours'
import { PackHealthLine } from './PackHealthLine'
import { HostInstall } from './HostInstall'
import type { HostTarget } from './HostInstall'
import { hostingPackFor, loadHostingPacks } from './data'
import type { HubPack } from './data'
import { LOADER, gb, modsFromText } from '../premium/packView'
import type { DescBlock, PackView } from '../premium/packView'

/**
 * Страница сборки — одна для всех: премиум, бесплатные нашего каталога и
 * сборки Modrinth (приказ владельца 23.09.2026, 18:32: «клик по любой сборке —
 * полная страница, как у Arcania»).
 *
 * Порядок — по ресёрчу analysis/2026-09-23_premium-pack-page.md: медиа в
 * шапке (трейлер или обложка), название и одна строка сути, 3–5 фактов
 * крупно, ряд «цена + кнопка» (как у Epic), кадры каруселью, описание,
 * обновления. Чего источник не прислал, того на странице нет.
 */

/** GET /catalog/items/:slug — карточка сайта: счётчики и история версий. */
interface CatalogItem {
  downloads?: number
  updatedAt?: string
  files?: { version: string; fileName: string; releasedAt?: string; changelog?: string | null }[]
}

interface MrProject {
  body?: string
  downloads?: number
  followers?: number
  game_versions?: string[]
  loaders?: string[]
  updated?: string
  gallery?: { url: string; raw_url?: string; featured?: boolean; ordering?: number }[]
}

interface MrVersion {
  version_number: string
  name?: string
  date_published: string
  game_versions?: string[]
}

interface Update {
  date: string | null
  text: string
}

const cache = new Map<string, Promise<unknown>>()
function once<T>(key: string, load: () => Promise<T>): Promise<T | null> {
  let hit = cache.get(key) as Promise<T | null> | undefined
  if (!hit) {
    // Прод иногда отвечает 502 на первый запрос: один повтор через секунду
    // дешевле, чем пустая страница сборки.
    hit = load()
      .catch(() => new Promise<T>((ok, fail) => setTimeout(() => load().then(ok, fail), 1200)))
      .catch(() => {
        cache.delete(key)
        return null
      })
    cache.set(key, hit)
  }
  return hit
}

const getJson = <T,>(url: string) => fetch(url).then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(r.status)))

/** Ролик YouTube по любой форме ссылки: watch?v=, youtu.be/, embed/, shorts/. */
export function youtubeId(url: string | null | undefined): string | null {
  if (!url) return null
  const m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/.exec(url)
  return m ? m[1]! : null
}

function Desc({ blocks, markdown }: { blocks?: DescBlock[] | null; markdown?: string }) {
  const [full, setFull] = useState(false)
  let body: ReactNode = null
  if (blocks && blocks.length)
    body = blocks.map((b, i) =>
      b.type === 'heading' ? (
        <h3 key={i}>{b.text}</h3>
      ) : b.type === 'list' ? (
        <ul key={i}>
          {(b.items || []).map((x) => (
            <li key={x}>
              <Icon id="i-check" />
              {x}
            </li>
          ))}
        </ul>
      ) : b.type === 'image' ? (
        b.src ? <img key={i} className="pk-desc-img" src={mirrorAsset(b.src)} alt={b.alt || ''} loading="lazy" draggable={false} /> : null
      ) : b.type === 'paragraph' ? (
        <p key={i}>{b.text}</p>
      ) : null,
    )
  else if (markdown) body = <div className="md">{renderMarkdown(markdown)}</div>
  if (!body) return null
  return (
    <section className="pp-block">
      <h2>О сборке</h2>
      <div className={'pp-desc' + (full ? ' full' : '')}>{body}</div>
      {!full ? (
        <button className="btn sm secondary pp-more" data-track="desc_more" onClick={() => setFull(true)}>
          Читать полностью <Icon id="i-chev-d" />
        </button>
      ) : null}
    </section>
  )
}

/** Шапка: превью ролика до клика, по клику — плеер. Без ролика — обложка. */
function Media({ video, cover }: { video: string | null; cover: string | null }) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => setPlaying(false), [video])
  // Встраивание YouTube в webview без клика ненадёжно (плеер отвечает ошибкой
  // конфигурации), а чёрный прямоугольник хуже обложки: до клика — картинка.
  if (video && playing)
    return (
      <iframe
        className="pp-video"
        src={'https://www.youtube-nocookie.com/embed/' + video + '?autoplay=1&playsinline=1&rel=0&loop=1&playlist=' + video}
        title="Трейлер"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    )
  const poster = cover || (video ? 'https://i.ytimg.com/vi/' + video + '/hqdefault.jpg' : null)
  return (
    <>
      {poster ? <img className="pp-cover" src={poster} alt="" draggable={false} /> : null}
      {video ? (
        <button className="pp-play" aria-label="Трейлер" data-sound="open" data-track="trailer" onClick={() => setPlaying(true)}>
          <Icon id="i-play" />
        </button>
      ) : null}
    </>
  )
}

/** Установка сборки Modrinth — тем же путём, что строка каталога (ModRow). */
function MrInstallButton({ pack }: { pack: HubPack }) {
  const slug = pack.slug || ''
  const task = useInstalls((s) => s.tasks[keyMrModpack(slug)])
  const running = !!task && task.state === 'run'
  const start = () => {
    if (!hasTauri()) {
      showToast('Установка сборок — в приложении', 'error')
      return
    }
    runInstall({
      key: keyMrModpack(slug),
      title: pack.title,
      running: 'Скачивание…',
      run: () => installModpack(slug),
      onDone: (p) => {
        track('catalog_install', { kind: 'modpack', id: slug, source: actionSource('pack_page').source, section: 'pack_page' })
        useProfiles.getState().setSelected(p.name)
        void useProfiles.getState().refresh()
        showToast('Сборка «' + p.name + '» готова к запуску', 'ok', 'achievement')
      },
    })
  }
  return (
    <button className="btn lg primary pp-cta" data-track="install" data-src="pack_page" disabled={running} onClick={start}>
      <Icon id="i-download" />{' '}
      {running ? (task.pct > 0 ? task.label + ' ' + Math.round(task.pct) + '%' : task.label) : 'Установить'}
    </button>
  )
}

interface Fact {
  value: string
  label: string
}

export function PackPage({
  pack,
  server,
  onBack,
  onPlay,
  onServer,
}: {
  pack: HubPack
  server: SnapshotServer | null
  onBack: () => void
  /** Запуск: имя установленной сборки на компьютере. */
  onPlay: (build: string) => void
  onServer: (s: SnapshotServer) => void
}) {
  const profiles = useProfiles((s) => s.profiles)
  const mr = pack.origin === 'modrinth'
  const slug = pack.slug || ''
  const [view, setView] = useState<PackView | null>(null)
  const [item, setItem] = useState<CatalogItem | null>(null)
  const [detail, setDetail] = useState<PremiumPackDetail | null>(null)
  const [project, setProject] = useState<MrProject | null>(null)
  const [versions, setVersions] = useState<MrVersion[]>([])
  const [plans, setPlans] = useState<PremiumPlan[]>([])
  const [sub, setSub] = useState<PremiumSubscription | null>(null)
  const [installed, setInstalled] = useState<string | null>(null)
  const [hostTarget, setHostTarget] = useState<HostTarget | null>(null)
  const [hostOpen, setHostOpen] = useState(false)
  const doneKey = mr ? keyMrModpack(slug) : keyCatalogPack(slug)
  const justInstalled = useInstalls((s) => !!slug && !!s.done[doneKey])

  useEffect(() => {
    let alive = true
    setView(null)
    setItem(null)
    setDetail(null)
    setProject(null)
    setVersions([])
    setHostTarget(null)
    if (mr) {
      const base = MODRINTH_API + '/v2/project/' + encodeURIComponent(slug)
      void once('mr:' + slug, () => getJson<MrProject>(base)).then((p) => alive && setProject(p))
      void once('mrv:' + slug, () => getJson<MrVersion[]>(base + '/version')).then(
        (l) => alive && setVersions(Array.isArray(l) ? l : []),
      )
      if (pack.serverOk !== false) setHostTarget({ kind: 'modrinth', projectId: slug, title: pack.title })
    } else if (slug) {
      void once('pv:' + slug, () => api<PackView>('/catalog/packs/' + encodeURIComponent(slug))).then(
        (d) => alive && setView(d),
      )
      void once('ci:' + slug, () => api<CatalogItem>('/catalog/items/' + encodeURIComponent(slug))).then(
        (d) => alive && setItem(d),
      )
      void loadHostingPacks().then((list) => {
        const hp = hostingPackFor(pack, list)
        if (alive && hp) setHostTarget({ kind: 'partner', pack: hp, title: pack.title })
      })
    }
    if (pack.premium) {
      if (pack.source === 'premium')
        void loadPremiumPack(pack.id)
          .then((d) => alive && setDetail(d))
          .catch(() => {})
      void loadPremium()
        .then((s) => {
          if (!alive) return
          setPlans(s.plans || [])
          setSub(s.subscription || null)
        })
        .catch(() => {})
    }
    return () => {
      alive = false
    }
  }, [pack.id])

  useEffect(() => {
    let alive = true
    void installedPack(slug || null, profiles).then((n) => alive && setInstalled(n))
    return () => {
      alive = false
    }
  }, [slug, profiles, justInstalled])

  const full: PremiumPackDetail = detail ? { ...pack, ...detail } : { ...pack }

  // Кадры: премиум-адрес → карточка сборки каталога → Modrinth (полный размер).
  const mrShots = (project?.gallery || [])
    .slice()
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || (a.ordering || 0) - (b.ordering || 0))
    .map((g) => mirrorAsset(g.raw_url || g.url) || g.url)
  // У Modrinth обложка карточки — уменьшенная копия первого кадра галереи:
  // в шапку идёт этот кадр в полном размере, а в карусели его уже нет.
  const mrHead = mr && mrShots.length ? mrShots[0]! : null
  const shots = (
    full.screenshots && full.screenshots.length ? full.screenshots : view?.gallery || (mrHead ? mrShots.slice(1) : mrShots)
  ).filter((s) => s && s !== full.coverUrl)
  const video = youtubeId(full.videoUrl || view?.video)
  const cover = view?.banner || mrHead || full.coverUrl || shots[0] || null

  const mcVersion = full.mcVersion || view?.game || null
  const loader = full.loader || (view?.loader ? LOADER[view.loader] || view.loader : null)
  const mods = typeof full.modsCount === 'number' && full.modsCount > 0 ? full.modsCount : modsFromText(view?.description)
  const downloads = project?.downloads ?? item?.downloads ?? full.downloads ?? null
  const client = (view?.files || []).find((f) => f.side === 'client')

  const facts: Fact[] = []
  if (mods) facts.push({ value: fmtN(mods), label: 'модов' })
  if (mcVersion) facts.push({ value: mcVersion, label: loader || 'версия' })
  if (typeof full.online === 'number' && full.online > 0) facts.push({ value: fmtN(full.online), label: 'играют сейчас' })
  else if (server && server.isOnline) facts.push({ value: fmtN(server.online), label: 'онлайн сервера' })
  if (downloads) facts.push({ value: fmtN(downloads), label: 'скачиваний' })
  if (project?.followers) facts.push({ value: fmtN(project.followers), label: 'подписчиков' })
  if (client && client.size > 0) facts.push({ value: gb(client.size), label: 'скачать' })

  // Обновления: премиум-патчи → версии нашего каталога → версии Modrinth.
  const updates: Update[] = []
  if (full.patches && full.patches.length) for (const x of full.patches) updates.push({ date: x.date || null, text: x.text })
  else if (item?.files && item.files.length) {
    const seen = new Set<string>()
    for (const f of item.files) {
      if (seen.has(f.version)) continue
      seen.add(f.version)
      updates.push({ date: f.releasedAt || null, text: 'Версия ' + f.version + (f.changelog ? ' — ' + f.changelog : '') })
    }
  } else
    for (const v of versions)
      updates.push({
        date: v.date_published,
        text: (v.name || v.version_number) + (v.game_versions && v.game_versions.length ? ' · ' + v.game_versions[v.game_versions.length - 1] : ''),
      })
  const shown = updates.slice(0, 3)

  const includes = full.includes && full.includes.length ? full.includes : []
  const plan = (full.plans && full.plans[0]) || plans.find((x) => x.id === (sub && sub.planId)) || plans[0] || null
  const author = full.author || view?.author || null

  let cta: ReactNode
  if (installed)
    cta = (
      <button className="btn lg primary pp-cta" data-sound="open" data-track="play" data-src="pack_page" onClick={() => onPlay(installed)}>
        <Icon id="i-play" /> Играть
      </button>
    )
  else if (mr) cta = <MrInstallButton pack={pack} />
  else
    cta = (
      <>
        <PriceLine pack={full} plan={plan} sub={sub} />
        <span className="pp-cta-wrap">
          <BuyButton pack={full} plan={plan} sub={sub} />
        </span>
      </>
    )

  return (
    <div className="pp" data-section="pack_page" data-kind={pack.premium ? 'premium' : 'pack'} data-id={slug || pack.id}>
      <header className="pp-head">
        <Media video={video} cover={cover} />
        <button className="btn sm secondary ph-back pp-back" data-track="back" onClick={onBack}>
          <Icon id="i-chev-l" /> Каталог
        </button>
        <div className="pp-title">
          {pack.premium ? (
            <span className="ph-card-tag gold">
              <Icon id="i-crown" /> Премиум
            </span>
          ) : (
            <span className="ph-card-tag">{mr ? 'Modrinth' : 'Бесплатно'}</span>
          )}
          <h1>{full.title}</h1>
          {full.tagline ? <span className="pp-line">{full.tagline}</span> : null}
          {author ? <span className="pp-author">Собрал {author}</span> : null}
        </div>
      </header>

      {facts.length ? (
        <div className="pp-facts">
          {facts.slice(0, 5).map((f) => (
            <div className="pp-fact" key={f.label}>
              <b>{f.value}</b>
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="pp-cols">
        <div className="pp-main">
          <Carousel shots={shots} />

          {includes.length ? (
            <section className="pp-block">
              <h2>Что входит</h2>
              <ul className="pp-inc">
                {includes.map((x) => (
                  <li key={x}>
                    <Icon id="i-check" />
                    {x}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <Desc blocks={view?.description} markdown={project?.body} />

          {shown.length ? (
            <section className="pp-block">
              <h2>Обновления</h2>
              <ul className="pp-patches">
                {shown.map((x, k) => (
                  <li key={k}>
                    {x.date && untilText(x.date) ? <span>{untilText(x.date)}</span> : null}
                    {x.text}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <aside className={'pp-buy' + (pack.premium ? ' gold' : '')}>
          {cta}
          {slug ? <PackHealthLine slug={slug} title={full.title} /> : null}
          {hostTarget ? (
            <button className="btn md secondary pp-srv" data-sound="open" data-track="host_install" onClick={() => setHostOpen(true)}>
              <Icon id="i-server-cog" /> Поставить на хостинг
            </button>
          ) : null}
          {server ? (
            <button className="btn md secondary pp-srv" data-track="pack_server" data-src="pack_page" onClick={() => onServer(server)}>
              <Icon id="i-server" /> Сервер сборки
              {server.isOnline ? (
                <span className="ph-hero-srv-n">
                  <span className="ph-dot" aria-hidden="true"></span>
                  {fmtN(server.online)}
                </span>
              ) : null}
            </button>
          ) : null}
          <Hours build={installed} />
          {pack.premium ? <CancelLine sub={sub} /> : null}
          <span className="pp-legal">
            {full.ageRating ? <b>{full.ageRating}</b> : null}
            Не продукт Mojang
          </span>
        </aside>
      </div>

      {hostOpen && hostTarget ? <HostInstall target={hostTarget} onClose={() => setHostOpen(false)} /> : null}
    </div>
  )
}
