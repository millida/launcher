import { cloneElement, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Icon } from '../Icon'
import { api, hasMillidaAccount } from '../../lib/api'
import { fmtN } from '../../lib/format'
import { priceLabel } from '../../lib/premium'
import { cfSearch } from '../../ipc/commands'
import type { CfHit } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { setScreen } from '../../state/ui'
import { noteMyServers } from '../../state/playInvite'
import type { LobbyMode } from '../../state/lobbyMode'
import type { HostServer } from '../../screens/Hosting'
import { HostPlanPicker } from '../HostPlanPicker'
import { modeScene } from '../iso/modeScenes'
import { dayNumber, pickIndex } from './rotation'
import type { HubPack } from './data'
import { trackImpression } from '../../lib/uiTrack'

/**
 * «Для тебя» (владелец 24.09.2026, 16:09): один ряд карточек того же вида,
 * что «Мои сборки», с меткой типа на обложке. Первыми всегда свой сервер и
 * Arcania Labs, дальше — OneBlock, карты на прохождение с друзьями и сборки
 * Millida; их порядок меняется раз в сутки, у всех игроков одинаково.
 * 6 карточек на 1200, 4 на 900 — лишние прячет CSS.
 */

/** Кооперативная карта: в названии или описании — игра вдвоём/с друзьями. */
const COOP = /co-?op|coop|multiplayer|2\s*players?|2-4|friends|вдвоём|с друзьями/i
/** Две строки по 5 (владелец 24.09.2026, 17:31); сервер — на две клетки. */
const SHOWN = 10

const img = (src: string | null | undefined) =>
  src ? (
    <img
      src={src}
      alt=""
      loading="lazy"
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
  title: string
  meta?: ReactNode
  onClick: () => void
}

function Card({ art, tag, gold, title, meta, onClick, wide, kind, id, pos }: CardProps) {
  return (
    <button
      className={'ph-card fy-card' + (wide ? ' fy-wide' : '')}
      data-sound="nav"
      data-kind={kind}
      data-id={id}
      data-pos={pos}
      data-src="foryou"
      onClick={onClick}
    >
      <span className="ph-card-art">
        {art}
        <span className={'ph-card-tag' + (gold ? ' gold' : '')}>{tag}</span>
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

/** Сцена OneBlock на небе — та же, что в «Рекомендуем» лобби. */
function SkyScene() {
  const a = useMemo(() => {
    const scene = modeScene('ONEBLOCK')
    const k = Math.max(1, Math.floor(Math.min(76 / scene.w, 76 / scene.h) * 2) / 2)
    return { scene, k }
  }, [])
  return (
    <span className="fy-sky">
      <img src={a.scene.url} width={a.scene.w * a.k} height={a.scene.h * a.k} alt="" draggable={false} />
    </span>
  )
}

type Pick = { key: string; node: ReactElement<CardProps> }

export function ForYou({
  on,
  arcania,
  premiumWait,
  packs,
  oneblockOnline,
  onPack,
  onMode,
  onMap,
}: {
  on: boolean
  arcania: HubPack | null
  /** Премиум ещё грузится — на месте Arcania скелет. */
  premiumWait: boolean
  /** Бесплатные сборки Millida от самых популярных. */
  packs: HubPack[]
  oneblockOnline: number | null
  /** Запуск своего сервера — сейчас баннер ведёт в хостинг, оставлено для совместимости. */
  onPlay?: (m: LobbyMode) => void
  onPack: (p: HubPack) => void
  onMode: (cat: string) => void
  onMap: (name: string) => void
}) {
  const [list, setList] = useState<HostServer[] | 'none' | null>(null)
  const [picker, setPicker] = useState(false)
  const [maps, setMaps] = useState<CfHit[]>([])

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

  // Карты на прохождение с друзьями — только в приложении (CurseForge идёт через ядро).
  useEffect(() => {
    if (!hasTauri()) return
    void cfSearch('co-op', 'world', '', '', 0, 248, 2)
      .then((l) => setMaps(l.filter((m) => COOP.test(m.name + ' ' + m.summary)).slice(0, 12)))
      .catch(() => {})
  }, [])

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

  // б) Arcania Labs.
  const labs: ReactNode = arcania ? (
    <Card
      key="labs"
      kind="premium"
      id={arcania.slug || arcania.id}
      pos={1}
      tag="Arcania Labs"
      gold
      art={img(arcania.coverUrl)}
      title={arcania.title}
      meta={priceLabel(arcania) || 'Премиум'}
      onClick={() => onPack(arcania)}
    />
  ) : premiumWait ? (
    <Skel key="labs" />
  ) : null

  // в, г, д — ротация по дню: какой вид первым и какие карты/сборки сегодня.
  const day = dayNumber()
  const rotated = useMemo<Pick[]>(() => {
    const pickN = <T,>(pool: T[], n: number, salt: number): T[] => {
      if (!pool.length) return []
      const i0 = pickIndex(day, pool.length, salt)
      const out: T[] = []
      for (let k = 0; k < Math.min(n, pool.length); k++) out.push(pool[(i0 + k * 3) % pool.length]!)
      return [...new Set(out)]
    }
    const mapCards: Pick[] = pickN(maps, 2, 11).map((m) => ({
      key: 'map:' + m.id,
      node: (
        <Card
          key={'map:' + m.id}
          kind="map"
          id={String(m.id)}
          tag="Карта"
          art={img(m.logo)}
          title={m.name}
          meta={
            <>
              {/* Без чисел CurseForge: «С друзьями 300 тыс» читалось как бред (17:53). */}
              <Icon id="i-users" /> Пройди с друзьями
            </>
          }
          onClick={() => onMap(m.name)}
        />
      ),
    }))
    // Карт нет (браузер, CurseForge молчит) — место отдаём сборкам.
    const packCards: Pick[] = pickN(packs.slice(0, 30), mapCards.length ? 5 : 7, 23).map((p) => ({
      key: 'pack:' + p.id,
      node: (
        <Card
          key={'pack:' + p.id}
          kind={p.premium ? 'premium' : 'pack'}
          id={p.slug || p.id}
          tag="Сборка"
          art={img(p.coverUrl)}
          title={p.title}
          meta={[p.loader, p.mcVersion].filter(Boolean).join(' · ') || p.tagline}
          onClick={() => onPack(p)}
        />
      ),
    }))
    const ob: Pick[] = [
      {
        key: 'oneblock',
        node: (
          <Card
            key="oneblock"
            kind="mode"
            id="ONEBLOCK"
            tag="Режим"
            art={<SkyScene />}
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
        ),
      },
    ]
    // OneBlock пока не выходит — в «Для тебя» его нет, он обычный режим
    // среди остальных (владелец 24.09.2026, 17:22).
    void ob
    const kinds = [mapCards, packCards]
    const s = day % 2
    const order = [kinds[s]!, kinds[(s + 1) % 2]!]
    const out: Pick[] = []
    for (let r = 0; r < 8; r++) for (const k of order) if (k[r]) out.push(k[r]!)
    return out
  }, [day, maps, packs, oneblockOnline, onMode, onMap, onPack])

  // Сервер занимает две клетки.
  const rest = SHOWN - (labs ? 3 : 2)
  const shown = rotated.slice(0, rest)
  const off = labs ? 2 : 1

  // Показ блока для CTR: один раз на набор карточек, когда ряд собран.
  const ownKey = list === null ? null : 'hosting'
  const shownKey = shown.map((x) => x.key).join(',')
  useEffect(() => {
    if (!on || !ownKey || !packs.length) return
    trackImpression('foryou', [ownKey, arcania ? 'premium:' + (arcania.slug || arcania.id) : null, ...shown.map((x) => x.key)], 'playhub')
  }, [on, ownKey, shownKey, arcania])

  return (
    <>
      <div className="hub-grid fy-grid" data-section="foryou">
        {own}
        {labs}
        {shown.map((x, i) => cloneElement(x.node, { pos: off + i }))}
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
