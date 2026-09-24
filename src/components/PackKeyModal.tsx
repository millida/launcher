import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { backdropClose } from '../lib/dismiss'
import { hasTauri } from '../ipc/tauri'
import { redeemPackKey } from '../ipc/commands'
import { openExt } from '../lib/api'
import { fmtN } from '../lib/format'
import { track } from '../lib/telemetry'
import { priceLabel } from '../lib/premium'
import { useLobby } from '../state/lobbyMode'
import { LOADER, gb, loadPackDownloads, loadPackView, modsFromText, packPluses, plusIcon } from './premium/packView'
import type { PackView } from './premium/packView'
import '../styles/pixel/packkey.css'

interface Props {
  slug: string
  title: string
  reason?: string
  onClose: () => void
  onUnlocked: () => void
}

/**
 * Адрес покупки с меткой лаунчера. Своего счётчика переходов под сборки у
 * millida.net нет (`/go/:key` знает только Discord), поэтому клик считается
 * дважды: событием телеметрии `pack_buy_click` и UTM-метками на сайте сборки.
 */
export function packBuyLink(url: string, slug: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set('utm_source', 'launcher')
    u.searchParams.set('utm_medium', 'key_banner')
    u.searchParams.set('utm_campaign', slug)
    return u.toString()
  } catch {
    return url
  }
}

interface Fact {
  value: string
  label: string
}

/**
 * Нет доступа к платной сборке — баннер сборки вместо сухого окна ключа
 * (правка владельца 24.09.2026, 16:39). Обложка, название, 3–5 фактов крупно,
 * плюсы значками, цена и «Купить» — всё из карточки самой сборки
 * (`/catalog/packs/:slug`, `/catalog/items/:slug`), ничего под Arcania не
 * зашито. Ниже — ввод ключа: после активации установка продолжается сама.
 *
 * В body, а не на месте вызова: окно открывается из строки каталога, а
 * затемнение кита позиционируется по ближайшему предку.
 */
export function PackKeyModal({ slug, title, onClose, onUnlocked }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<PackView | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [downloads, setDownloads] = useState<number | null>(null)
  const lobbyPack = useLobby((s) => s.premium.find((p) => (p.slug || p.id) === slug))

  useEffect(() => {
    if (!slug) return
    let alive = true
    void loadPackView(slug)
      .then((v) => alive && setView(v))
      .catch(() => {})
      .finally(() => alive && setLoaded(true))
    void loadPackDownloads(slug)
      .then((n) => alive && setDownloads(n))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [slug])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    if (busy || code.trim().length < 8) return
    if (!hasTauri()) {
      setError('Ключ активируется в приложении')
      return
    }
    setBusy(true)
    setError('')
    redeemPackKey(slug, code.trim())
      .then(() => {
        onClose()
        onUnlocked()
      })
      .catch((e) => setError(String(e).replace(/^pack-access:\s*/, '')))
      .finally(() => setBusy(false))
  }

  const name = view?.title || lobbyPack?.title || title
  const cover = view?.banner || view?.cover || lobbyPack?.coverUrl || view?.gallery?.[0] || null
  const buyUrl = view?.accessBuyUrl && /^https:\/\//.test(view.accessBuyUrl) ? view.accessBuyUrl : ''
  const price = lobbyPack ? priceLabel(lobbyPack) : ''

  const mods = modsFromText(view?.description) || (lobbyPack?.modsCount && lobbyPack.modsCount > 0 ? lobbyPack.modsCount : null)
  const game = view?.game || lobbyPack?.mcVersion || null
  const loader = view?.loader ? LOADER[view.loader] || view.loader : lobbyPack?.loader || null
  const client = (view?.files || []).find((f) => f.side === 'client')
  const dl = downloads ?? (lobbyPack?.downloads && lobbyPack.downloads > 0 ? lobbyPack.downloads : null)

  const facts: Fact[] = []
  if (mods) facts.push({ value: fmtN(mods), label: 'модов' })
  if (game) facts.push({ value: game, label: loader || 'версия' })
  if (client && client.size > 0) facts.push({ value: gb(client.size), label: 'скачать' })
  if (dl) facts.push({ value: fmtN(dl), label: 'скачиваний' })
  const pluses = packPluses(view?.description)

  const buy = () => {
    if (!buyUrl) return
    track('pack_buy_click', { slug, where: 'key_banner' })
    openExt(packBuyLink(buyUrl, slug))
  }

  return createPortal(
    <div className="modal-bg open vis" {...backdropClose(onClose)}>
      <div className="modal pkb" role="dialog" aria-label={name}>
        <div className="pkb-art">
          {cover ? <img src={cover} alt="" draggable={false} /> : <span className="pkb-art-ph skel" aria-hidden="true"></span>}
          <span className="pkb-tag">
            <Icon id="i-crown" /> Премиум
          </span>
          <button className="btn sm secondary pkb-x" aria-label="Закрыть" data-track="pack_key_close" onClick={onClose}>
            <Icon id="i-x" />
          </button>
        </div>

        <div className="pkb-body">
          <div className="pkb-head">
            <h3>{name}</h3>
            {view?.summary ? <p className="pkb-line">{view.summary}</p> : null}
          </div>

          {facts.length ? (
            <div className="pkb-facts">
              {facts.slice(0, 5).map((f) => (
                <div className="pkb-fact" key={f.label}>
                  <b>{f.value}</b>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          ) : !loaded ? (
            <div className="pkb-facts" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div className="pkb-fact skel" key={i}></div>
              ))}
            </div>
          ) : null}

          {pluses.length ? (
            <ul className="pkb-plus">
              {pluses.map((x) => (
                <li key={x}>
                  <Icon id={plusIcon(x)} />
                  {x}
                </li>
              ))}
            </ul>
          ) : null}

          {buyUrl || price ? (
            <div className="pkb-buy">
              {price ? <span className="pkb-price">{price}</span> : null}
              {buyUrl ? (
                <button className="btn lg primary pkb-cta" data-sound="open" data-track="pack_key_buy" data-kind="premium" data-id={slug} onClick={buy}>
                  Купить <Icon id="i-ext" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="pkb-key">
            <span className="pkb-key-why">
              <Icon id="i-lock" /> На этом аккаунте доступа нет
            </span>
            <div className="pkb-key-row">
              <input
                className="input"
                value={code}
                spellCheck={false}
                placeholder="Ввести ключ"
                aria-label="Ключ доступа"
                onChange={(e) => {
                  setCode(e.target.value)
                  if (error) setError('')
                }}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
              <button className="btn md secondary" disabled={busy || code.trim().length < 8} data-track="pack_key_activate" data-kind="premium" data-id={slug} onClick={submit}>
                <Icon id="i-key" /> {busy ? 'Проверяем…' : 'Активировать'}
              </button>
            </div>
            {error ? <span className="pkb-err">{error}</span> : null}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
