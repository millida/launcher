import { cloneElement, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { SECTION_VISUAL } from '../catalog/sections'
import { api, hasMillidaAccount } from '../../lib/api'
import { fmtN } from '../../lib/format'
import { priceLabel } from '../../lib/premium'
import { setScreen } from '../../state/ui'
import { noteMyServers } from '../../state/playInvite'
import type { LobbyMode } from '../../state/lobbyMode'
import type { HostServer } from '../../screens/Hosting'
import { HostPlanPicker } from '../HostPlanPicker'
import { ONEBLOCK_ART } from './modeIcon'
import { ONEBLOCK_PACK, isExclusive, isOwnServerPack, ownServerTagline } from './data'
import { ANARCHY, OWN_SERVER_MODE } from '../../lib/ownServer'
import { AnarchyArt, anarchyOnlineShown } from './AnarchyTile'
import { headCells } from './placement'
import type { FeaturedSpot } from './featured'
import { useAnarchy } from '../../lib/anarchy'
import { usePromo, type ForYouCard } from '../../state/promo'
import type { HubPack } from './data'
import { trackImpression } from '../../lib/uiTrack'
import { track } from '../../lib/telemetry'
import { loadListing } from '../catalog/site'
import type { SiteCard, SiteSlug } from '../catalog/site'
import {
  RECS_EXPERIMENT,
  RECS_LOG_KEY,
  RECS_UID_KEY,
  RECS_WEIGHTS,
  affinityOf,
  dayIndex,
  exposureOf,
  feedSeed,
  hashStr,
  logClick,
  logSeen,
  mixFeed,
  parseLog,
  recentKeys,
  rng,
  variantOf,
} from '../../lib/recsMix'
import type { FeedItem, FeedWhy, RecsLog } from '../../lib/recsMix'
import { readSignals } from '../../lib/recsSignals'

/**
 * «Рекомендуем» (бывшее «Для тебя»; владелец 30.09.2026, 15:06 — тот же блок,
 * что на millida.net/katalog): четыре ряда карточек вида «Мои сборки» с меткой
 * типа на обложке. Первыми всегда баннер хостинга, эксклюзивы (Arcania Labs
 * первой) и наш OneBlock, дальше лента — карты на прохождение с друзьями и
 * сборки; их порядок меняется раз в сутки, у всех игроков одинаково.
 */

/**
 * Четыре ряда по 5 клеток (владелец 30.09.2026, 15:06 — как «Рекомендуем» на
 * millida.net/katalog): хостинг на две клетки, эксклюзивы, наш OneBlock, дальше
 * лента. Узкое окно прячет лишние ряды само (fy-grid).
 */
const SHOWN = 15
/** Эксклюзивов в голове: Arcania и ещё один, второй меняется по дням (владелец 30.09.2026, 15:42). */
const EXCL = 2
/**
 * Разделы ленты — как на millida.net/katalog: сборки, карты, ресурс-паки,
 * шейдеры, моды, датапаки. Серверов в ленте нет — только наш OneBlock в голове.
 */
// Только сборки (07.10.2026): карты, моды, паки и шейдеры живут в каталоге — в библиотеке они мешали выбору и не продают.
const FEED_SECTIONS: SiteSlug[] = []
const SECTION_TAG: Record<string, string> = {
  modpacks: 'Сборка',
  maps: 'Карта',
  'texture-packs': 'Ресурс-пак',
  shaders: 'Шейдер',
  mods: 'Мод',
  'data-packs': 'Дата-пак',
}
const LOADER: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }
/** Порог качества ленты, как на сайте: картинка и тысяча скачиваний. */
const MIN_DOWNLOADS = 1000

type FeedData = { kind: 'pack'; pack: HubPack } | { kind: 'card'; section: string; card: SiteCard }

function store<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

/** Постоянный id этого компьютера для группы A/B и зерна ленты; с аккаунтом не связан. */
function recsUid(): string {
  return store(() => {
    let id = localStorage.getItem(RECS_UID_KEY)
    if (!id || !/^[a-z0-9]{8,32}$/.test(id)) {
      id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36)
      localStorage.setItem(RECS_UID_KEY, id)
    }
    return id
  }, 'anon')
}
const readLog = () => store(() => parseLog(localStorage.getItem(RECS_LOG_KEY)), parseLog(null))
const writeLog = (log: RecsLog) => store(() => localStorage.setItem(RECS_LOG_KEY, JSON.stringify(log)), undefined)

const img = (src: string | null | undefined) =>
  src ? (
    <img
      src={src}
      alt=""
      decoding="async"
      draggable={false}
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
    />
  ) : null

interface CardProps {
  wide?: boolean
  /** Аналитика: тип карточки (pack|premium|map|mode|own_server|hosting), её id и место в ряду. */
  kind: string
  id: string
  pos?: number
  art: ReactNode
  tag: string
  gold?: boolean
  excl?: boolean
  /** Наш сервер (OneBlock): зелёная метка и свечение — не путать с эксклюзивами. */
  own?: boolean
  /** Раздел каталога (slug сайта): значок и цвет метки типа. */
  section?: string
  title: string
  meta?: ReactNode
  onClick: () => void
}

function Card({ art, tag, gold, excl, own, section, title, meta, onClick, wide, kind, id, pos }: CardProps) {
  const vis = section ? SECTION_VISUAL[section as keyof typeof SECTION_VISUAL] : undefined
  return (
    <button
      className={'ph-card fy-card' + (wide ? ' fy-wide' : '') + (gold || excl ? ' is-excl' : '') + (own ? ' is-own' : '')}
      data-sound="nav"
      data-kind={kind}
      data-id={id}
      data-pos={pos}
      data-src="foryou"
      onClick={onClick}
    >
      <span className="ph-card-art">
        {art}
        {/* Метка на обложке (владелец 30.09.2026): эксклюзив — корона, тип — значок и цвет раздела. */}
        <span
          className={'ph-card-tag' + (own ? ' own' : gold ? ' gold' : excl ? ' excl' : vis ? ' sec' : '')}
          style={!gold && !excl && vis ? ({ '--tag-c': vis.tint } as CSSProperties) : undefined}
        >
          {own ? <Icon id="i-play" /> : gold || excl ? <Icon id="i-crown" /> : vis ? <PxIcon name={vis.px} size={14} className="px-icon" /> : null}
          {tag}
        </span>
        {/* Наши сборки переведены (08.10.2026): «На русском» на каждой Arcania Labs. */}
        {gold || excl ? <span className="ph-card-ru">На русском</span> : null}
      </span>
      <span className="ph-card-body">
        <b>{title}</b>
        {meta ? <span className="ph-card-meta">{meta}</span> : null}
      </span>
    </button>
  )
}

const Skel = () => (
  <span className="ph-card skel-card" aria-hidden="true">
    <span className="ph-card-art skel"></span>
    <span className="ph-card-body">
      <span className="skel skel-line" style={{ width: '60%' }}></span>
      <span className="skel skel-line" style={{ width: '35%', height: 9 }}></span>
    </span>
  </span>
)

/** Лицо OneBlock — фон и логотип баннера «Режимов», как на mcru.me. */
function ObArt() {
  return (
    <span className="fy-ob">
      <img src={ONEBLOCK_ART.bg} alt="" draggable={false} />
      <img className="fy-ob-logo" src={ONEBLOCK_ART.logo} alt="" draggable={false} />
    </span>
  )
}

type Pick = { key: string; why: FeedWhy | 'preview' | 'server'; node: ReactElement<CardProps> }

export function ForYou({
  bare,
  on,
  arcania,
  exclusives = [],
  premiumWait,
  packs,
  oneblockOnline,
  anarchyOnline,
  featured = { kind: 'anarchy' },
  onPack,
  onMode,
  onItem,
  onMore,
}: {
  /** Без головы ряда (хостинг, анархия, OneBlock) — они в баннере библиотеки (HubHero). */
  bare?: boolean
  /** «Ещё» — последняя клетка ряда: весь каталог во вкладке «Ресурсы». */
  onMore?: () => void
  on: boolean
  arcania: HubPack | null
  /** Платные сборки Millida, Arcania первой: голова ленты после хостинга. */
  exclusives?: HubPack[]
  /** Премиум ещё грузится — на месте Arcania скелет. */
  premiumWait: boolean
  /** Бесплатные сборки Millida от самых популярных. */
  packs: HubPack[]
  oneblockOnline: number | null
  anarchyOnline: number | null
  /** Whose turn the anarchy card is: on PrisonRPG's turn its pack takes the cell. */
  featured?: FeaturedSpot<HubPack>
  /** Запуск своего сервера — сейчас баннер ведёт в хостинг, оставлено для совместимости. */
  onPlay?: (m: LobbyMode) => void
  onPack: (p: HubPack) => void
  onMode: (cat: string) => void
  onMap?: (name: string) => void
  /** Материал каталога из ленты — его страница в каталоге Millida. */
  onItem: (section: string, card: SiteCard) => void
}) {
  const fyHead = usePromo((s) => s.promo.forYou)
  const an = useAnarchy()
  const [list, setList] = useState<HostServer[] | 'none' | null>(null)
  const [picker, setPicker] = useState(false)
  const [cards, setCards] = useState<Record<string, SiteCard[]>>({})
  const load = async () => {
    if (!hasMillidaAccount()) {
      setList('none')
      return
    }
    try {
      const r = await api<HostServer[]>('/hosting/servers/me')
      const arr = Array.isArray(r) ? r : []
      noteMyServers(arr)
      setList(arr.length ? arr : 'none')
    } catch (e) {
      console.warn('[hub] servers/me', e)
      setList((l) => l || 'none')
    }
  }
  useEffect(() => {
    if (on) void load()
  }, [on])

  // Пулы ленты — популярное каталога Millida по разделам (кэш каталога лаунчера).
  useEffect(() => {
    if (!on) return
    let alive = true
    void Promise.all(
      FEED_SECTIONS.map((section) =>
        loadListing({ section, sort: 'popular', page: 1, perPage: 30 })
          .then((l) => [section, l.items] as const)
          .catch(() => [section, [] as SiteCard[]] as const),
      ),
    ).then((rows) => alive && setCards(Object.fromEntries(rows)))
    return () => {
      alive = false
    }
  }, [on])

  // Кто смотрит и какой сегодня день: группа A/B, зерно, журнал, сигналы.
  const day = dayIndex()
  const ab = useMemo(() => {
    const uid = recsUid()
    const variant = variantOf(uid)
    const log = readLog()
    const sig = readSignals()
    return {
      variant,
      seed: feedSeed(uid, day, variant),
      recent: recentKeys(log, day),
      exposure: exposureOf(log, day),
      affinity: affinityOf({ visits: sig.visits, installs: sig.installs }),
    }
  }, [day])

  // а) Баннер хостинга на две клетки — всегда один и тот же, как реклама
  // (владелец 24.09.2026, 17:47). Нажатие — в хостинг, там все свои серверы.
  const nServers = Array.isArray(list) ? list.length : 0
  const own: ReactNode = (
    <button
      key="own"
      className="ph-card fy-wide fy-host"
      data-sound="open"
      data-track="foryou_hosting"
      data-kind="hosting"
      data-id={nServers ? 'my_servers' : 'create_server'}
      data-pos={0}
      data-src="foryou"
      onClick={() => setScreen('hosting')}
    >
      <img className="fy-host-art" src="/lobby/duo@2x.webp" alt="" draggable={false} />
      <span className="fy-host-body">
        <span className="ph-card-tag">Хостинг Millida</span>
        <b>Играть по сети с другом</b>
        <span className="btn md primary fy-host-cta">{nServers ? 'Мои серверы · ' + nServers : 'Создать бесплатно'}</span>
      </span>
    </button>
  )

  // б) Эксклюзивы: Arcania Labs первой, за ней ещё две платные сборки.
  const rest0 = exclusives.filter((p) => p !== arcania && p.id !== arcania?.id)
  const rot = rest0.length ? Math.floor(rng(hashStr(ab.seed + ':head'))() * rest0.length) : 0
  const head = [arcania, ...rest0.slice(rot), ...rest0.slice(0, rot)].filter((p): p is HubPack => !!p).slice(0, EXCL)
  const labs: ReactNode[] = head.length
    ? head.map((p, i) => (
        <Card
          key={'excl:' + p.id}
          kind="premium"
          id={p.slug || p.id}
          pos={fyHead.length + i}
          tag="Arcania Labs"
          gold
          excl
          art={img(p.coverUrl)}
          title={p.title}
          meta={priceLabel(p) || 'Премиум'}
          onClick={() => onPack(p)}
        />
      ))
    : premiumWait
      ? [<Skel key="labs" />]
      : []

  // Лента — смеситель (lib/recsMix.ts): интерес к разделам, исследование,
  // новизна по дням и журналу показов, не больше двух одного раздела подряд.
  const headKey = head.map((p) => p.id).join(',')
  const rotated = useMemo<Pick[]>(() => {
    const packKey = (p: HubPack) => 'modpacks/' + (p.slug || p.id)
    const taken = new Set(head.map(packKey))
    if (featured.kind === 'prisonrpg' && fyHead.includes(ANARCHY.mode)) taken.add(packKey(featured.pack))
    // Черновики для тестировщика — всегда в начале: иначе ротация прятала проверяемую сборку.
    const previews = packs.filter((p) => p.preview && !taken.has(packKey(p)))
    // Our partner servers stand right after them: a pack without downloads yet would sink below the fold.
    const servers = packs.filter((p) => !p.preview && isOwnServerPack(p.slug) && !taken.has(packKey(p)))
    const sections: Record<string, FeedItem<FeedData>[]> = {
      modpacks: packs
        .filter((p) => !p.preview && !isOwnServerPack(p.slug) && p.slug !== ONEBLOCK_PACK && !/one\s?-?block/i.test(p.slug || p.title))
        .slice(0, 40)
        .map((p) => ({
          key: packKey(p),
          section: 'modpacks',
          ok: !!p.coverUrl && (p.origin === 'millida' || (p.downloads || 0) >= MIN_DOWNLOADS),
          data: { kind: 'pack', pack: p },
        })),
    }
    for (const sec of FEED_SECTIONS)
      sections[sec] = (cards[sec] || [])
        .filter((c) => !/one\s?-?block/i.test(c.slug + ' ' + c.title))
        .map((c) => ({
          key: sec + '/' + c.slug,
          section: sec,
          ok: !!(c.cover || c.icon) && Math.max(c.downloads || 0, c.sourceDownloads || 0) >= MIN_DOWNLOADS,
          data: { kind: 'card', section: sec, card: c },
        }))
    const n = SHOWN - headCells(fyHead) - EXCL - 1 - previews.length - servers.length
    const feed = mixFeed<FeedData>({
      sections,
      personal: [],
      n: Math.max(0, n),
      seed: ab.seed,
      weights: RECS_WEIGHTS[ab.variant],
      affinity: ab.affinity,
      exposure: ab.exposure,
      recent: ab.recent,
      taken,
    })
    const packCard = (p: HubPack, why: FeedWhy | 'preview' | 'server'): Pick => ({
      key: packKey(p),
      why,
      node: (
        <Card
          key={'pack:' + p.id}
          kind={p.premium ? 'premium' : 'pack'}
          id={p.slug || p.id}
          tag={isOwnServerPack(p.slug) ? 'Наш сервер' : isExclusive(p.slug) ? 'Arcania Labs' : 'Сборка'}
          own={isOwnServerPack(p.slug)}
          excl={isExclusive(p.slug)}
          section="modpacks"
          art={img(p.coverUrl)}
          title={p.title}
          meta={ownServerTagline(p.slug) || [p.loader, p.mcVersion].filter(Boolean).join(' · ') || p.tagline}
          onClick={() => onPack(p)}
        />
      ),
    })
    const siteCard = (section: string, c: SiteCard, key: string, why: FeedWhy): Pick => ({
      key,
      why,
      node: (
        <Card
          key={key}
          kind={section}
          id={c.slug}
          tag={SECTION_TAG[section] || 'Каталог'}
          section={section}
          art={img(c.cover || c.icon)}
          title={c.title}
          meta={[LOADER[(c.loaders[0] || '').toLowerCase()], c.versions[0]].filter(Boolean).join(' · ') || undefined}
          onClick={() => onItem(section, c)}
        />
      ),
    })
    return [
      ...previews.map((p) => packCard(p, 'preview')),
      ...servers.map((p) => packCard(p, 'server')),
      ...feed.map((f) => (f.item.data.kind === 'pack' ? packCard(f.item.data.pack, f.why) : siteCard(f.item.data.section, f.item.data.card, f.item.key, f.why))),
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ab, cards, packs, headKey, onPack, onItem, fyHead, featured.kind])

  // Хостинг занимает две клетки, OneBlock и «Ещё» — по одной.
  // Без головы — ровно два ряда по шесть: премиум, лента и «Ещё».
  const rest = (bare ? 12 : SHOWN - headCells(fyHead)) - 1 - labs.length
  // Без головы (библиотека): наши сборки по популярности подряд, без смесителя разделов — он резал ряд до двух.
  const plain = useMemo<Pick[]>(() => {
    if (!bare) return []
    const taken = new Set(head.map((p) => p.id))
    return packs
      .filter((p) => !taken.has(p.id) && !p.preview && !isOwnServerPack(p.slug) && p.slug !== ONEBLOCK_PACK && !!p.coverUrl)
      .map((p) => ({
        key: 'modpacks/' + (p.slug || p.id),
        why: 'popular' as FeedWhy,
        node: (
          <Card
            key={'mp:' + p.id}
            kind="pack"
            id={p.slug || p.id}
            tag="Сборка"
            section="modpacks"
            art={img(p.coverUrl)}
            title={p.title}
            meta={[p.loader, p.mcVersion].filter(Boolean).join(' · ') || p.tagline}
            onClick={() => onPack(p)}
          />
        ),
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bare, packs, headKey])
  const shown = (bare ? plain : rotated).slice(0, rest)
  const off = (bare ? 0 : fyHead.length) + labs.length

  // OneBlock — наш сервер, первым в ряду (владелец 30.09.2026, 21:04): он не
  // эксклюзив-сборка, у него своя зелёная метка.
  const obNode = (
        <Card
          key="oneblock"
          pos={fyHead.indexOf(OWN_SERVER_MODE)}
          kind="mode"
          id="ONEBLOCK"
          tag="Наш сервер"
          own
          art={<ObArt />}
          title="OneBlock"
          meta={
            oneblockOnline && oneblockOnline >= 20 ? (
              <>
                <span className="ph-dot" aria-hidden="true"></span>
                {fmtN(oneblockOnline)} играют
              </>
            ) : (
              'Выживи на одном блоке'
            )
          }
          onClick={() => onMode('ONEBLOCK')}
        />
      )

  const anNode =
    featured.kind === 'prisonrpg' ? (
      <Card
        key="prisonrpg"
        pos={fyHead.indexOf(ANARCHY.mode)}
        kind="pack"
        id={featured.pack.slug || featured.pack.id}
        tag="Наш сервер"
        own
        section="modpacks"
        art={img(featured.pack.coverUrl)}
        title={featured.pack.title}
        meta={
          anarchyOnlineShown(featured.pack.online) ? (
            <>
              <span className="ph-dot" aria-hidden="true"></span>
              {fmtN(featured.pack.online)} играют
            </>
          ) : (
            ownServerTagline(featured.pack.slug) || featured.pack.tagline
          )
        }
        onClick={() => onPack(featured.pack)}
      />
    ) : featured.kind === 'wait' ? (
      <Skel key="anarchy" />
    ) : (
    <Card
      key="anarchy"
      pos={fyHead.indexOf(ANARCHY.mode)}
      kind="own_server"
      id={ANARCHY.mode}
      tag="Наш сервер"
      own
      art={<AnarchyArt />}
      title={an.name}
      meta={
        anarchyOnlineShown(anarchyOnline) ? (
          <>
            <span className="ph-dot" aria-hidden="true"></span>
            {fmtN(anarchyOnline)} играют
          </>
        ) : (
          an.tagline
        )
      }
      onClick={() => onMode(ANARCHY.mode)}
    />
    )
  const headNodes: Record<ForYouCard, ReactNode> = { hosting: own, [ANARCHY.mode]: anNode, [OWN_SERVER_MODE]: obNode }

  // Показ блока для CTR: один раз на набор карточек, когда ряд собран. Тот же
  // показ пишет журнал новизны (не повторять завтра) и группу A/B.
  const ownKey = list === null ? null : 'hosting'
  const shownKey = shown.map((x) => x.key).join(',')
  useEffect(() => {
    if (!on || !ownKey || !packs.length) return
    trackImpression('foryou', [ownKey, ...head.map((p) => 'premium:' + (p.slug || p.id)), ...shown.map((x) => x.key)], 'playhub')
    writeLog(logSeen(readLog(), shown.filter((x) => x.why !== 'server' && x.why !== 'preview').map((x) => x.key), day))
    track('impression', { section: 'recs_view', exp: RECS_EXPERIMENT, variant: ab.variant, cards: shown.length, surface: 'playhub' })
  }, [on, ownKey, shownKey, head.map((p) => p.id).join(',')])

  const onClickCapture = (e: import('react').MouseEvent<HTMLDivElement>) => {
    const b = (e.target as Element | null)?.closest?.<HTMLElement>('[data-src="foryou"]')
    if (!b) return
    const pos = Number(b.dataset.pos) || 0
    const x = pos >= off ? shown[pos - off] : null
    if (x && x.key.includes('/') && !x.key.startsWith('server/')) writeLog(logClick(readLog(), x.key, day))
    track('ui_click', {
      id: 'recs_click',
      exp: RECS_EXPERIMENT,
      variant: ab.variant,
      why: x ? x.why : b.dataset.kind || '',
      section: x ? x.key.split('/')[0]! : b.dataset.kind || '',
      pos,
    })
  }

  return (
    <>
      <div className="hub-grid fy-grid" data-section="foryou" onClickCapture={onClickCapture}>
        {bare ? null : fyHead.map((k) => headNodes[k])}
        {labs}
        {shown.map((x, i) => cloneElement(x.node, { pos: off + i }))}
        {onMore ? (
          <button className="ph-card fy-card fy-more" data-sound="nav" data-track="foryou_more" onClick={onMore}>
            <span className="fy-more-ic">
              <Icon id="i-chev-r" />
            </span>
            <b>Ещё</b>
            <span className="ph-card-meta">Весь каталог</span>
          </button>
        ) : null}
        {!packs.length && rotated.length < rest ? Array.from({ length: rest - rotated.length }, (_, i) => <Skel key={'sk' + i} />) : null}
      </div>
      {picker ? (
        <HostPlanPicker
          mode="create"
          focus="free"
          freeServer={null}
          onOpenServer={() => setScreen('hosting')}
          onClose={() => setPicker(false)}
          onDone={() => setTimeout(() => void load(), 1500)}
        />
      ) : null}
    </>
  )
}
