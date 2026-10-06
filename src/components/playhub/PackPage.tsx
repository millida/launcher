import { useEffect, useState } from 'react'
import { noteInstallKind } from '../../lib/recsSignals'
import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { MODRINTH_API, api, mirrorAsset } from '../../lib/api'
import { fmtN } from '../../lib/format'
import { renderMarkdown } from '../../lib/markdown'
import { installedPack } from '../../lib/lobbyPlay'
import { hasPlanChoice, liveSubscription, loadPremium, loadPremiumPack, untilText, viaCatalog } from '../../lib/premium'
import type { PremiumPackDetail, PremiumPlan, PremiumSubscription } from '../../lib/premium'
import { BuyButton, CancelLine, PlanButtons, PriceLine, hasAccess } from '../premium/PremiumBuy'
import { installModpack } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { useProfiles } from '../../state/profiles'
import { runInstall, useInstalls } from '../../state/installs'
import { showToast } from '../../state/ui'
import { track } from '../../lib/telemetry'
import { actionSource } from '../../lib/uiTrack'
import { keyCatalogPack, keyMrModpack } from '../../lib/installKeys'
import type { SnapshotServer } from '../../lib/snapshot'
import { PackKeyField } from '../PackKeyModal'
import { ONEBLOCK_ART } from './modeIcon'
import { ONEBLOCK_PACK } from '../../lib/ownServer'
import { Hours } from './Hours'
import { PackHealthLine } from './PackHealthLine'
import { HostInstall } from './HostInstall'
import type { HostTarget } from './HostInstall'
import { hostingPackFor, loadHostingPacks } from './data'
import type { HubPack } from './data'
import { LOADER, gb, modsFromText, partnerFrame } from '../premium/packView'
import type { DescBlock, PackView } from '../premium/packView'
import { PremiumPackPage } from '../premium/PremiumPackPage'
import { PackInstallButton } from '../premium/PackInstall'
import { Guard } from '../Guard'
import { MediaStrip } from '../catalog/MediaStrip'
import { Back, Compat, Gallery, Hero, Tabs } from '../catalog/ItemPage'
import type { Tab } from '../catalog/ItemPage'
import { fmtNum, plural, relativeTime } from '../catalog/site'
import { weave, weaveMarkdown } from '../catalog/weave'
import type { WeaveKind } from '../catalog/weave'
import { installReviewCandidate } from '../ModRow'
import { reviewCandidateFor } from '../../state/mods'

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

function Desc({ blocks, markdown, shots }: { blocks?: DescBlock[] | null; markdown?: string; shots: string[] }) {
  let body: ReactNode = null
  if (blocks && blocks.length)
    body = weave<DescBlock>(blocks, shots, descKind, (src) => ({ type: 'image', src })).map((b, i) =>
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
        b.src ? (
          <figure key={i} className="pk-desc-fig" data-align={b.align}>
            <img className="pk-desc-img" src={mirrorAsset(b.src)} alt={b.alt || ''} loading="lazy" draggable={false} />
            {b.caption ? <figcaption>{b.caption}</figcaption> : null}
          </figure>
        ) : null
      ) : b.type === 'paragraph' ? (
        <p key={i}>{b.text}</p>
      ) : null,
    )
  else if (markdown) body = <div className="md">{renderMarkdown(weaveMarkdown(markdown, shots))}</div>
  if (!body) return null
  return (
    <article className="card ci-box ci-desc">
      <div className="pp-desc full">{body}</div>
    </article>
  )
}

const descKind = (b: DescBlock): WeaveKind => (b.type === 'image' ? 'media' : b.type === 'heading' ? 'head' : 'text')

/** Шапка: превью ролика до клика, по клику — плеер. Без ролика — обложка. */
function Media({ video, cover, ob }: { video: string | null; cover: string | null; ob?: boolean }) {
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
  // Наш OneBlock: осенний арт баннера «Режимов» вместо старой обложки.
  if (ob)
    return (
      <>
        <img className="pp-cover pp-ob-bg" src={ONEBLOCK_ART.bg} alt="" draggable={false} />
        <img className="pp-ob-logo" src={ONEBLOCK_ART.logo} alt="" draggable={false} />
      </>
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
        noteInstallKind('modpack')
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
  const [tab, setTab] = useState<Tab>('desc')
  const [candidate, setCandidate] = useState<string | null>(null)
  const doneKey = mr ? keyMrModpack(slug) : keyCatalogPack(slug)
  const justInstalled = useInstalls((s) => !!slug && !!s.done[doneKey])
  const packTask = useInstalls((s) => (mr ? undefined : s.tasks[keyCatalogPack(slug)]))
  const packRunning = !!packTask && packTask.state === 'run'

  useEffect(() => {
    let alive = true
    setCandidate(null)
    if (!mr && slug) void reviewCandidateFor(slug).then((c) => alive && setCandidate(c ? c.version : null))
    return () => {
      alive = false
    }
  }, [pack.id])

  useEffect(() => {
    let alive = true
    setView(null)
    setItem(null)
    setDetail(null)
    setProject(null)
    setVersions([])
    setHostTarget(null)
    setTab('desc')
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
  const loaderIds = view?.loader ? [view.loader] : project?.loaders?.length ? project.loaders : full.loader ? [full.loader.toLowerCase()] : []
  const gameVersions = mcVersion ? [mcVersion] : project?.game_versions || []
  const updated = relativeTime(item?.updatedAt || project?.updated || null)
  const mods = typeof full.modsCount === 'number' && full.modsCount > 0 ? full.modsCount : modsFromText(view?.description)
  // Счётчик сайта (/catalog/items) у сборок с лаунчера сильно меньше настоящего: у Arcania 1 395
  // против 13 920 на карточке. Берём наибольший из источников — тот же, что видно в каталоге.
  const downloads = Math.max(project?.downloads ?? 0, item?.downloads ?? 0, full.downloads ?? 0, pack.downloads ?? 0) || null
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

  const includes = full.includes && full.includes.length ? full.includes : []
  const plan = (full.plans && full.plans[0]) || plans.find((x) => x.id === (sub && sub.planId)) || plans[0] || null
  const author = full.author || view?.author || null

  const reloadDetail = () => {
    void loadPremiumPack(pack.id)
      .then((d) => setDetail(d))
      .catch(() => {})
  }
  const keyEntry = !installed && !!slug && !!detail && hasPlanChoice(detail) && !!full.acceptsKeys && !hasAccess(full, sub)

  let cta: ReactNode
  if (installed)
    cta = (
      <button className="btn lg primary pp-cta" data-sound="open" data-track="play" data-src="pack_page" onClick={() => onPlay(installed)}>
        <Icon id="i-play" /> Играть
      </button>
    )
  else if (mr) cta = <MrInstallButton pack={pack} />
  else if (detail && hasPlanChoice(detail) && !hasAccess(full, sub))
    cta = (
      <PlanButtons
        pack={full}
        plans={detail.plans || []}
        wrap="pp-cta-wrap"
        onOwned={reloadDetail}
      />
    )
  // Бесплатная сборка каталога — обычная зелёная «Установить», без золота премиума.
  else if (!pack.premium && (viaCatalog(full) || hasAccess(full, sub)) && full.slug)
    cta = (
      <span className="pp-cta-wrap">
        <PackInstallButton pack={full} />
      </span>
    )
  else
    cta = (
      <>
        <PriceLine pack={full} plan={plan} sub={sub} />
        <span className="pp-cta-wrap">
          <BuyButton pack={full} plan={plan} sub={sub} />
        </span>
      </>
    )

  // Премиум — своя страница (PremiumPackPage): данные и действия те же, подача своя.
  if (pack.premium)
    return (
      <Guard what="Блок сборки">
        <PremiumPackPage
          pack={pack}
          full={full}
          view={view}
          detail={detail}
          plans={plans}
          plan={plan}
          sub={sub}
          facts={facts}
          shots={shots}
          video={video}
          cover={cover}
          mcVersion={mcVersion}
          loader={loader}
          size={client && client.size > 0 ? client.size : null}
          updates={updates}
          includes={includes}
          author={author}
          installed={installed}
          onPlay={onPlay}
          onOwned={reloadDetail}
          server={server}
          onServer={onServer}
          onHost={hostTarget ? () => setHostOpen(true) : undefined}
          onBack={onBack}
        >
          {hostOpen && hostTarget ? <HostInstall target={hostTarget} onClose={() => setHostOpen(false)} /> : null}
        </PremiumPackPage>
      </Guard>
    )

  const inline: ReactNode[] = []
  if (!pack.premium && mods) inline.push(<><b>{fmtNum(mods)}</b> {plural(mods, 'мод', 'мода', 'модов')}</>)
  if (downloads)
    inline.push(
      <>
        <Icon id="i-download" />
        <b>{fmtNum(downloads)}</b> {plural(downloads, 'скачивание', 'скачивания', 'скачиваний')}
      </>,
    )
  if (updated) inline.push(<>Обновлён {updated}</>)
  const icon = view?.cover || full.coverUrl || mrHead || cover

  return (
    <div className="ci" data-section="pack_page" data-kind={pack.premium ? 'premium' : 'pack'} data-id={slug || pack.id}>
      <Back label="Сборки" onBack={onBack} />
      <Hero
        className={[pack.premium ? 'is-premium' : '', partnerFrame(view?.partner ?? detail?.partner)].filter(Boolean).join(' ')}
        cover={<Media video={video} cover={cover} ob={slug === ONEBLOCK_PACK} />}
        badge={
          pack.premium ? (
            <span className="ph-card-tag gold">
              <Icon id="i-crown" /> Премиум
            </span>
          ) : (
            <span className="ph-card-tag">{mr ? 'Modrinth' : 'Бесплатно'}</span>
          )
        }
        icon={icon ? <img src={icon} alt="" draggable={false} /> : null}
        title={full.title}
        line={full.tagline}
        by={author ? 'Собрал ' + author : null}
        facts={inline}
        cta={
          hostTarget || server ? (
            <div className="mr-actions">
              {hostTarget ? (
                <button className="btn md secondary" data-sound="open" data-track="host_install" onClick={() => setHostOpen(true)}>
                  <Icon id="i-server-cog" /> Поставить на хостинг
                </button>
              ) : null}
              {server ? (
                <button className="btn md secondary" data-track="pack_server" data-src="pack_page" onClick={() => onServer(server)}>
                  <Icon id="i-server" /> Сервер сборки
                  {server.isOnline ? (
                    <span className="ph-hero-srv-n">
                      <span className="ph-dot" aria-hidden="true"></span>
                      {fmtN(server.online)}
                    </span>
                  ) : null}
                </button>
              ) : null}
            </div>
          ) : null
        }
      />

      {pack.premium && facts.length ? (
        <div className="pp-facts">
          {facts.slice(0, 5).map((f) => (
            <div className="pp-fact" key={f.label}>
              <b>{f.value}</b>
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="ci-grid">
        <main className="ci-main">
          <Tabs tab={tab} onTab={setTab} gallery={shots.length} versions={updates.length} />
          {tab === 'desc' && (shots.length || video) ? <MediaStrip urls={shots} video={video} onAll={() => setTab('gallery')} /> : null}
          {tab === 'desc' ? (
            <>
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
              <Desc blocks={view?.description} markdown={project?.body} shots={shots} />
            </>
          ) : tab === 'gallery' ? (
            <Gallery urls={shots} />
          ) : (
            <section className="card ci-box">
              <ul className="pp-patches">
                {updates.map((x, k) => (
                  <li key={k}>
                    {x.date && untilText(x.date) ? <span>{untilText(x.date)}</span> : null}
                    {x.text}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>

        <aside className="ci-aside">
          <div className={'pp-buy' + (pack.premium ? ' gold' : '')}>
            {cta}
            {candidate ? (
              <button
                className="btn md secondary"
                data-track="review_candidate"
                data-src="pack_page"
                disabled={packRunning}
                onClick={() => installReviewCandidate(slug, full.title, candidate)}
              >
                Проверить {candidate}
              </button>
            ) : null}
            {keyEntry ? (
              <div className="pkb-key">
                <PackKeyField
                  slug={slug}
                  onUnlocked={() => {
                    showToast('Ключ активирован')
                    reloadDetail()
                  }}
                />
              </div>
            ) : null}
            {slug ? <PackHealthLine slug={slug} title={full.title} /> : null}
            <Hours build={installed} />
            {pack.premium ? <CancelLine sub={liveSubscription(detail) ?? sub} /> : null}
            <span className="pp-legal">
              {full.ageRating ? <b>{full.ageRating}</b> : null}
              Не продукт Mojang
            </span>
          </div>
          <Compat versions={gameVersions} loaders={loaderIds} side={null} />
        </aside>
      </div>

      {hostOpen && hostTarget ? <HostInstall target={hostTarget} onClose={() => setHostOpen(false)} /> : null}
    </div>
  )
}
