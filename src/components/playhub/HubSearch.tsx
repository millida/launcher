import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { fmtN } from '../../lib/format'
import { usePlayStats } from '../../state/playStats'
import { serverMode } from '../../state/lobbyMode'
import type { LobbyMode } from '../../state/lobbyMode'
import { searchServers } from './data'
import type { HubPack, LiveMode } from './data'
import type { SnapshotServer } from '../../lib/snapshot'
import { hoursText } from './Hours'
import { track } from '../../lib/telemetry'

/**
 * Поиск серверов вкладки «Мои серверы»: имя или адрес. Серверы — из
 * рейтинга по имени и адресу (/rating/servers?search=), режимы и сборки —
 * если их передали. Адрес вида «mc.example.net» можно сразу запустить
 * кнопкой «Зайти» или строкой «Зайти на …». Анализ 24.09.2026: 77 % заходящих в
 * «Играть» открывают серверы, 64 % играют на конкретных крупных — им нужен
 * путь по имени, а не лента.
 */

const looksLikeAddr = (q: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{2,5})?$/i.test(q.trim())

/** Сервер без карточки рейтинга (адрес из поиска или из истории). */
export const addrMode = (addr: string, name?: string): LobbyMode => ({
  kind: 'server',
  slug: addr,
  name: name || addr,
  ip: addr,
  logo: null,
  banner: null,
  versions: [],
  licensed: false,
})

const has = (hay: string, q: string) => hay.toLowerCase().includes(q)

const NO_PACKS: HubPack[] = []
const NO_MODES: LiveMode[] = []

export function HubSearch({
  packs = NO_PACKS,
  modes = NO_MODES,
  placeholder = 'Сервер, сборка или режим',
  onServer,
  onMode,
  onPack,
}: {
  packs?: HubPack[]
  modes?: LiveMode[]
  placeholder?: string
  onServer: (m: LobbyMode) => void
  onMode?: (cat: string) => void
  onPack?: (p: HubPack) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState<SnapshotServer[] | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const query = q.trim().toLowerCase()

  useEffect(() => {
    setServers(null)
    if (query.length < 2) return
    let alive = true
    const t = window.setTimeout(() => {
      void searchServers(query).then((l) => alive && setServers(l))
    }, 280)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [query])

  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [open])

  const foundModes = useMemo(
    () => (query.length < 2 ? [] : modes.filter((m) => has(m.def.title, query) || has(m.def.cat, query)).slice(0, 3)),
    [query, modes],
  )
  const foundPacks = useMemo(
    () => (query.length < 2 ? [] : packs.filter((p) => has(p.title, query)).slice(0, 4)),
    [query, packs],
  )
  const addr = looksLikeAddr(q) ? q.trim() : ''
  const show = open && query.length >= 2
  const nothing = servers !== null && !servers.length && !foundModes.length && !foundPacks.length && !addr

  // Аналитика поиска: длина запроса и число найденных, сам текст не уходит.
  // Пишем, когда человек перестал печатать (~800 мс) и ответ уже пришёл.
  const results = servers === null ? null : servers.length + foundModes.length + foundPacks.length
  useEffect(() => {
    if (query.length < 2 || results === null) return
    const t = window.setTimeout(
      () => track('catalog_search', { section: 'hub', len: query.length, results, addr: addr ? 1 : 0 }),
      800,
    )
    return () => window.clearTimeout(t)
  }, [query, results])

  const pick = (fn: () => void) => {
    setOpen(false)
    setQ('')
    fn()
  }

  return (
    <div className="hs" ref={box}>
      <label className="input hs-field">
        <Icon id="i-search" />
        <input
          value={q}
          placeholder={placeholder}
          maxLength={80}
          onChange={(e) => {
            setQ(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
            if (e.key === 'Enter' && addr) pick(() => onServer(addrMode(addr)))
          }}
        />
        {q ? (
          <button type="button" className="hs-clear" aria-label="Очистить" data-track="search_clear" onClick={() => setQ('')}>
            <Icon id="i-x" />
          </button>
        ) : null}
        {addr ? (
          <button type="button" className="btn md primary hs-go" data-sound="open" data-track="join_address" data-kind="address" data-src="server_search" onClick={() => pick(() => onServer(addrMode(addr)))}>
            <Icon id="i-play" /> Зайти
          </button>
        ) : null}
      </label>
      {show ? (
        <div className="ph-card hs-pop" role="listbox" data-section="hub_search" data-src="server_search">
          {addr ? (
            <button className="hs-row" role="option" aria-selected={false} data-track="join_address" data-kind="address" onClick={() => pick(() => onServer(addrMode(addr)))}>
              <span className="hs-ic">
                <Icon id="i-server" />
              </span>
              <b>Зайти на {addr}</b>
            </button>
          ) : null}
          {servers === null ? (
            <span className="hs-row skel-row" aria-hidden="true">
              <span className="hs-ic skel"></span>
              <span className="skel skel-line" style={{ width: '40%' }}></span>
            </span>
          ) : (
            servers.map((s, i) => (
              <button
                key={s.slug}
                className="hs-row"
                role="option"
                aria-selected={false}
                data-track="server"
                data-kind="server"
                data-id={s.slug || s.ip}
                data-pos={i}
                onClick={() => pick(() => onServer(serverMode(s)))}>
                <span className="hs-ic">{s.logo ? <img src={s.logo} alt="" draggable={false} /> : <Icon id="i-server" />}</span>
                <b>{s.name}</b>
                <span className="hs-kind">Сервер</span>
                {s.isOnline && s.online >= 20 ? (
                  <span className="hs-meta">
                    <span className="ph-dot" aria-hidden="true"></span>
                    {fmtN(s.online)}
                  </span>
                ) : null}
              </button>
            ))
          )}
          {foundModes.map((m, i) => (
            <button
              key={m.def.cat}
              className="hs-row"
              role="option"
              aria-selected={false}
              data-track="mode"
              data-kind="mode"
              data-id={m.def.cat}
              data-pos={i}
              onClick={() => pick(() => onMode?.(m.def.cat))}>
              <span className="hs-ic">
                <Icon id="i-grid" />
              </span>
              <b>{m.def.title}</b>
              <span className="hs-kind">Режим</span>
            </button>
          ))}
          {foundPacks.map((p, i) => (
            <button
              key={p.id}
              className="hs-row"
              role="option"
              aria-selected={false}
              data-track="pack"
              data-kind={p.premium ? 'premium' : 'pack'}
              data-id={p.slug || p.id}
              data-pos={i}
              onClick={() => pick(() => onPack?.(p))}>
              <span className="hs-ic">{p.coverUrl ? <img src={p.coverUrl} alt="" draggable={false} /> : <Icon id="i-box2" />}</span>
              <b>{p.title}</b>
              <span className="hs-kind">Сборка</span>
            </button>
          ))}
          {nothing ? (
            <span className="hs-none">
              <Icon id="i-search" /> Ничего не нашли
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Недавние серверы — где человек уже играл (часы из статистики ядра), свежие
 * первыми. Нет истории — блока нет.
 */
export function MyServers({
  skip,
  title = 'Мои серверы',
  limit = 6,
  onPlay,
}: {
  skip?: string
  title?: string
  /** Сколько показать; больше одного ряда — сетка переносится. */
  limit?: number
  onPlay: (m: LobbyMode) => void
}) {
  const list = usePlayStats((s) => s.stats.servers)
  // Сервер из «Продолжить» здесь не повторяем.
  const recent = useMemo(
    () => [...list].filter((s) => s.key !== skip).sort((a, b) => b.last - a.last).slice(0, limit),
    [list, skip, limit],
  )
  if (!recent.length) return null
  return (
    <section className="ph-shelf ms">
      <div className="ph-shelf-head">
        <h2>{title}</h2>
      </div>
      <div className={'ms-row' + (limit > 6 ? ' all' : '')} data-section="my_servers" data-src="my_servers">
        {recent.map((s, i) => (
          <button
            key={s.key}
            className="ph-card ms-chip"
            data-sound="open"
            data-track="server"
            data-kind="server"
            data-id={s.key}
            data-pos={i}
            onClick={() => onPlay(addrMode(s.key, s.label || undefined))}>
            <span className="ms-ic">
              <Icon id="i-server" />
            </span>
            <span className="ms-text">
              <b>{s.label || s.key}</b>
              {s.seconds >= 60 ? <span>{hoursText(s.seconds)}</span> : null}
            </span>
            <Icon id="i-play" />
          </button>
        ))}
      </div>
    </section>
  )
}
