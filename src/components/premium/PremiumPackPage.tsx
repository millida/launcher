import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../Icon'
import { openImage } from '../ImageLightbox'
import { mirrorAsset } from '../../lib/api'
import { fmtN } from '../../lib/format'
import { untilText } from '../../lib/premium'
import type { PremiumPackDetail, PremiumPlan, PremiumSubscription } from '../../lib/premium'
import type { SnapshotServer } from '../../lib/snapshot'
import { PremiumAccessCard, PremiumPrimaryAction } from './PremiumBuy'
import { gb } from './packView'
import type { PackView } from './packView'
import { exclusivesOf, iconOf, parseReqs, splitTitle, storyOf } from './premiumPackData'
import { StudioModal, packWord, useStudioCount } from './PremiumStudio'
import type { Chapter, Story } from './premiumPackData'
import { Hours } from '../playhub/Hours'
import type { HubPack } from '../playhub/data'
import { MediaStrip } from '../catalog/MediaStrip'
import { PremiumMore } from './PremiumMore'
import { Back, Gallery as ItemGallery, Hero as ItemHero } from '../catalog/ItemPage'
import '../../styles/pixel/catalog-item.css'
import '../../styles/pixel/premium-pack.css'

type PageTab = 'desc' | 'gallery' | 'specs'

/**
 * Страница премиум-сборки — флагман витрины (приказ владельца 04.10.2026:
 * «премиум должен ощущаться премиумом — от героя до каждой кнопки»).
 *
 * Данные, загрузку и все действия (покупка, установка, ключ, хостинг) по-
 * прежнему держит PackPage: сюда приходит готовая модель, здесь — только
 * подача. Порядок: кинематографичный герой с главной кнопкой → вкладки-якоря
 * → «Главное» → кадры → история по главам → состав → обновления →
 * требования; справа липкая карточка доступа.
 */

export interface PackFact {
  value: string
  label: string
}

export interface PackUpdate {
  date: string | null
  text: string
}

export interface PremiumPackModel {
  pack: HubPack
  full: PremiumPackDetail
  view: PackView | null
  detail: PremiumPackDetail | null
  plans: PremiumPlan[]
  plan: PremiumPlan | null
  sub: PremiumSubscription | null
  facts: PackFact[]
  shots: string[]
  /** Id ролика YouTube. */
  video: string | null
  cover: string | null
  mcVersion: string | null
  loader: string | null
  /** Размер клиентского архива, байты. */
  size: number | null
  updates: PackUpdate[]
  includes: string[]
  author: string | null
  installed: string | null
  /** Запуск установленной сборки. */
  onPlay: (build: string) => void
  /** Доступ появился (оплата, ключ): перечитать деталь. */
  onOwned: () => void
  server: SnapshotServer | null
  onServer: (s: SnapshotServer) => void
  /** Есть куда поставить на хостинг. */
  onHost?: () => void
  /** «Назад» к списку сборок. */
  onBack?: () => void
  /** Модалки страницы (хостинг). */
  children?: ReactNode
}

const YT_POSTER = (id: string) => 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg'

const scrollToId = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/* ---------------- история ---------------- */

function ChapterView({ c, n }: { c: Chapter; n: number }) {
  return (
    <article className={'ppx-ch' + (c.image ? ' img' : ' flat')} id={c.id}>
      {c.image ? (
        <button className="ppx-ch-art" data-track="desc_image" aria-label={c.image.alt || 'Открыть кадр'} onClick={() => openImage(mirrorAsset(c.image!.src) || c.image!.src)}>
          <img src={mirrorAsset(c.image.src)} alt={c.image.alt} loading="lazy" draggable={false} />
          {c.image.caption ? <span>{c.image.caption}</span> : null}
        </button>
      ) : null}
      <div className="ppx-ch-body">
        <span className="ppx-ch-n">
          <Icon id={iconOf(c.title, c.text[0] || c.items[0] || '')} />
          {String(n).padStart(2, '0')}
        </span>
        <h3>{c.title}</h3>
        {c.text.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
        {c.items.length ? (
          <ul>
            {c.items.map((x) => (
              <li key={x}>
                <Icon id="i-check" />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </article>
  )
}

/** Описание всегда раскрыто целиком (владелец 04.10.2026: «Читать полностью» не нужно). */
function StoryBlock({ story, includes }: { story: Story; includes: string[] }) {
  return (
    <section className="ppx-sec" id="ppx-about">
      <SecHead eyebrow="История" title="О сборке" />
      {story.lead.length ? (
        <div className="ppx-lead">
          {story.lead.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      ) : null}
      <div className="ppx-chs">
        {story.chapters.map((c, i) => (
          <ChapterView key={c.id} c={c} n={i + 1} />
        ))}
      </div>
      {includes.length ? (
        <ul className="ppx-inc">
          {includes.map((x) => (
            <li key={x}>
              <Icon id="i-check" />
              {x}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function SecHead({ eyebrow, title, aside }: { eyebrow: string; title: string; aside?: ReactNode }) {
  return (
    <header className="ppx-sec-head">
      {/* Надкаталог («ГАЛЕРЕЯ», «ИСТОРИЯ») повторял вкладки — остаётся только заголовок. */}
      <div data-eyebrow={eyebrow}>
        <h2>{title}</h2>
      </div>
      {aside}
    </header>
  )
}

/* ---------------- требования ---------------- */

function SpecsBlock({ m, reqsText, version, loaderVersion }: { m: PremiumPackModel; reqsText: string | null; version: string | null; loaderVersion: string | null }) {
  const [tech, setTech] = useState(false)
  const reqs = parseReqs(reqsText)
  // Игроку — размер и свежесть; версии и загрузчик — под «Для моддеров» (правило 11).
  const rows: [string, string][] = []
  if (m.size) rows.push(['Скачать', gb(m.size)])
  const fresh = m.updates[0]?.date || m.full.updatedAt
  if (fresh && untilText(fresh)) rows.push(['Обновлено', untilText(fresh)])
  const techRows: [string, string][] = []
  if (m.mcVersion) techRows.push(['Minecraft', m.mcVersion])
  if (m.loader) techRows.push(['Загрузчик', m.loader + (loaderVersion ? ' ' + loaderVersion : '')])
  if (version) techRows.push(['Версия сборки', version])
  if (!rows.length && !techRows.length && !reqsText) return null
  return (
    <section className="ppx-sec" id="ppx-specs">
      <SecHead eyebrow="Твой ПК" title="Требования" />
      {reqs ? (
        <div className="ppx-reqs">
          {(
            [
              ['Минимум', reqs.min, ''],
              ['Рекомендуем', reqs.rec, ' rec'],
            ] as const
          ).map(([title, list, cls]) =>
            list.length ? (
              <div className={'ppx-req' + cls} key={title}>
                <span className="ppx-kicker">{title}</span>
                <dl>
                  {list.map((r) => (
                    <div key={r.label}>
                      <dt>{r.label}</dt>
                      <dd>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null,
          )}
        </div>
      ) : reqsText ? (
        <p className="ppx-reqs-text">{reqsText}</p>
      ) : null}
      {rows.length || (tech && techRows.length) ? (
        <dl className="ppx-spec">
          {[...rows, ...(tech ? techRows : [])].map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {techRows.length ? (
        <button className="btn sm ghost ppx-more" aria-expanded={tech} data-track="pack_tech" onClick={() => setTech(!tech)}>
          Для моддеров <Icon id={tech ? 'i-chev-u' : 'i-chev-d'} />
        </button>
      ) : null}
    </section>
  )
}

/* ---------------- страница ---------------- */

/** Свой порядок кадров (владелец 04.10.2026): у Arcania 3-й кадр первым, 2-й вторым, 1-й в конец. */
function shotOrder(slug: string, shots: string[]): string[] {
  if (!slug.toLowerCase().startsWith('arcania') || shots.length < 3) return shots
  return [shots[2]!, shots[1]!, ...shots.slice(3), shots[0]!]
}

export function PremiumPackPage(m: PremiumPackModel) {
  const { full, view } = m
  const slug = m.pack.slug || ''
  const [tab, setTab] = useState<PageTab>('desc')
  const side = useRef<HTMLElement>(null)
  // Вход в премиум-сборку — золотая пиксельная волна, как зелёная при смене вкладок.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('millida:wave'))
  }, [m.pack.id])

  // Липкая колонка доступа: короткая карточка липнет сверху, высокая — низом,
  // когда её край дошёл до низа окна. Иначе низ карточки (правовая строка,
  // хостинг) на 760 px не увидеть до конца страницы.
  useEffect(() => {
    const el = side.current
    if (!el) return
    let box: HTMLElement | null = el.parentElement
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
    if (!box) return
    const scroller = box
    const fit = () => {
      const cs = getComputedStyle(scroller)
      const room = scroller.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      // Снизу оставляем место круглой кнопке поддержки (52 px + отступ): иначе она ложилась на карточку.
      el.style.top = Math.min(14, room - el.offsetHeight - 86) + 'px'
    }
    // Пока карточка доступа под круглой кнопкой поддержки (страница ещё не долистана
    // до липкого места) — кнопка прячется, чтобы не закрывать цены тарифов.
    const tuck = () => {
      const fab = document.querySelector<HTMLElement>('.msf, .mlf')
      if (!fab) return
      const a = el.getBoundingClientRect()
      const b = fab.getBoundingClientRect()
      const over = a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
      fab.classList.toggle('is-tucked', over)
    }
    fit()
    tuck()
    const late = window.setTimeout(tuck, 400) // кнопка поддержки монтируется после страницы
    const ro = new ResizeObserver(() => (fit(), tuck()))
    ro.observe(el)
    ro.observe(scroller)
    scroller.addEventListener('scroll', tuck, { passive: true })
    return () => {
      ro.disconnect()
      window.clearTimeout(late)
      scroller.removeEventListener('scroll', tuck)
      document.querySelector('.msf, .mlf')?.classList.remove('is-tucked')
    }
  }, [])

  const story = useMemo(() => storyOf(view?.description), [view])
  const exclusives = useMemo(() => exclusivesOf(story, full.tagline), [story, full.tagline])
  const [studioOpen, setStudioOpen] = useState(false)
  const shots = useMemo(() => shotOrder(slug, m.shots), [slug, m.shots.join('|')])
  useEffect(() => setTab('desc'), [m.pack.id])
  const openFeature = (id: string) => {
    setTab('desc')
    requestAnimationFrame(() => scrollToId(id))
  }

  const extra = view as (PackView & { icon?: string | null; loaderVersion?: string | null }) | null
  const { version } = splitTitle(full.title, view?.version)
  const partner = view?.partner ?? m.detail?.partner ?? null
  const studioCount = useStudioCount(partner?.slug)
  const studio = partner?.name || m.author
  // Карточка доступа и главная кнопка героя — агента покупки (PremiumBuy.tsx):
  // одна модель состояния, общая память об оплате.
  const access = {
    pack: full,
    detail: m.detail,
    plans: m.plans,
    plan: m.plan,
    sub: m.sub,
    installed: m.installed,
    onPlay: m.onPlay,
    onOwned: m.onOwned,
  }
  const server = m.server
  const [pickId, setPickId] = useState<string | null>(null)
  const heroCta = <PremiumPrimaryAction {...access} pickId={pickId} />

  const hasStory = !!(story.chapters.length || story.lead.length || m.includes.length)
  const tabs: [PageTab, string, number | null][] = [
    ['desc', 'Описание', null],
    ...(shots.length ? [['gallery', 'Галерея', shots.length] as [PageTab, string, number]] : []),
    ['specs', 'Требования', null],
  ]

  // Та же страница, что у бесплатных сборок (PackPage → ItemPage): полоса-обложка,
  // значок, название, факты и кнопка в шапке, вкладки и колонка справа — только
  // в золоте премиума (владелец 06.10.2026: «то же самое, только в стилистике премиум»).
  const art = m.cover || shots[0] || (m.video ? YT_POSTER(m.video) : null)
  const iconSrc = extra?.icon || m.cover || shots[0] || null
  const heroFacts: ReactNode[] = [
    <span className="ppx-ci-badge">
      <Icon id="i-crown" />
      {exclusives.length ? 'Премиум · Эксклюзив' : 'Премиум'}
    </span>,
    ...m.facts
      .filter((f) => f.label !== 'модов')
      .map((f) => (
        <>
          {f.label === 'скачиваний' ? <Icon id="i-download" /> : null}
          <b>{f.value}</b> {f.label === 'скачать' ? 'размер' : f.label}
        </>
      )),
  ]
  const by =
    studio && partner && partner.slug ? (
      <button className="ppx-ci-studio" aria-label={'Все сборки ' + studio} data-sound="open" data-track="studio_open" onClick={() => setStudioOpen(true)}>
        от <b>{studio}</b>
        <span className="ppx-verified" aria-hidden="true">
          <Icon id="i-check" />
        </span>
        {studioCount ? (
          <span className="ppx-studio-n">
            · {studioCount} {packWord(studioCount)}
          </span>
        ) : null}
        <Icon id="i-chev-r" className="icon ppx-studio-go" />
      </button>
    ) : studio ? (
      'от ' + studio
    ) : null

  return (
    <div className="ppx ci pp-ci ppx-ci" data-section="pack_page" data-kind="premium" data-id={slug || m.pack.id}>
      {m.onBack ? <Back label="Сборки модов" onBack={m.onBack} /> : null}
      <ItemHero
        // Премиум — тот же каркас, что у бесплатных; отличие — тёплый золотой свет
        // из-под обложки и золотые акценты, без мигающих рамок и искр (владелец 06.10.2026).
        className="ppx-ci-hero"
        cover={art ? <img src={art} alt="" draggable={false} /> : null}
        glow={iconSrc}
        icon={iconSrc ? <img src={iconSrc} alt="" draggable={false} /> : <Icon id="i-crown" />}
        title={full.title}
        by={by}
        facts={heroFacts}
        cta={<div className="mr-actions">{heroCta}</div>}
      />

      {/* «Только в Millida» (владелец 06.10.2026: «мало эксклюзивности»): то, чего нет ни в одной
          другой сборке, — сразу под шапкой, золотыми плитками; клик — глава в «Описании». */}
      {exclusives.length ? (
        <section className="ppx-excl" aria-label="Только в Millida">
          <div className="ppx-excl-h">
            <span className="ppx-excl-badge">
              <Icon id="i-crown" /> Эксклюзив Millida
            </span>
            <span className="ppx-excl-sub">Есть только здесь</span>
          </div>
          <div className="ppx-excl-row">
            {exclusives.map((x) => (
              <button key={x.chapter} type="button" className="ppx-excl-tile" data-track="pack_feature" onClick={() => openFeature(x.chapter)}>
                <span className="ppx-excl-ic">
                  <Icon id={x.icon} />
                </span>
                <b>{x.tab}</b>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="ci-grid">
        <main className="ci-main">
          <div className="segs mr-subtypes ci-tabs" role="tablist">
            {tabs.map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={'seg' + (tab === k ? ' on' : '')} data-track={'pack_tab_' + k} onClick={() => setTab(k)}>
                {label}
                {n ? <span className="ci-n">{n}</span> : null}
              </button>
            ))}
          </div>

          {tab === 'desc' ? (
            <>
              {shots.length || m.video ? <MediaStrip urls={shots} video={m.video} onAll={() => setTab('gallery')} /> : null}
              {hasStory ? (
                <article className="card ci-box ppx-ci-story">
                  <StoryBlock story={story} includes={m.includes} />
                </article>
              ) : null}
            </>
          ) : tab === 'gallery' ? (
            <ItemGallery urls={shots} />
          ) : (
            <article className="card ci-box ppx-ci-story">
              <SpecsBlock m={m} reqsText={story.reqs} version={version} loaderVersion={extra?.loaderVersion || null} />
            </article>
          )}
        </main>

        <aside className="ci-aside ppx-side" ref={side}>
          <div className="pab-slot" id="ppx-access">
            <PremiumAccessCard
              {...access}
              hideMainWhenOpen
              hideMain
              pickId={pickId}
              onPickId={setPickId}
              onHost={m.onHost}
              slots={{
                server: server ? (
                  <button className="btn sm secondary" data-track="pack_server" data-src="pack_page" onClick={() => m.onServer(server)}>
                    <Icon id="i-server" /> Сервер сборки
                    {server.isOnline ? (
                      <span className="ph-hero-srv-n">
                        <span className="ph-dot" aria-hidden="true"></span>
                        {fmtN(server.online)}
                      </span>
                    ) : null}
                  </button>
                ) : null,
                extra: <Hours build={m.installed} />,
              }}
            />
          </div>
        </aside>
      </div>

      <PremiumMore current={slug} />

      {studioOpen && partner ? <StudioModal studio={partner} current={slug} onClose={() => setStudioOpen(false)} /> : null}
      {m.children}
    </div>
  )
}
