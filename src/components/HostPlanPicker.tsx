import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { WALLET_URL, api, openExt } from '../lib/api'
import { track } from '../lib/telemetry'
import { getMillidaAccount } from '../state/accounts'
import { showToast } from '../state/ui'

export interface HostPlan {
  code: string
  name: string
  tagline?: string
  ramMb?: number
  maxPlayers?: number
  diskMb?: number
  cpuCores?: number
  priceKopecks?: number
  priceYearKopecks?: number
}

const PLAY_KINDS: [string, string, string][] = [
  ['vanilla', 'i-blocks', 'Обычный'],
  ['modpack', 'i-box', 'Сборка модов'],
  ['map', 'i-grid', 'Карта'],
  ['minigames', 'i-users', 'Мини-игры'],
]

const gb = (mb?: number) => ((mb || 0) / 1024).toFixed((mb || 0) % 1024 === 0 ? 0 : 1).replace('.', ',')
const rub = (k?: number) => Math.round((k || 0) / 100).toLocaleString('ru-RU')

export interface CurseMap {
  id: number
  slug: string
  name: string
  summary?: string
  iconUrl?: string | null
  downloads?: number
}

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
}

function hostAddressPreview(nick: string): string {
  const slug = nick
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug.length >= 3 ? slug + '.millida.host' : ''
}

async function mapGameVersion(modId: number): Promise<string | null> {
  try {
    const p = await api('/hosting/catalog/curseforge/' + modId)
    const files: Array<{ gameVersions?: string[] }> = p?.files || []
    for (const f of files) {
      const v = (f.gameVersions || []).find((x) => /^\d+(\.\d+)+$/.test(x) || /^2\d\.\d/.test(x))
      if (v) return v
    }
  } catch {}
  return null
}

export function HostPlanPicker({
  mode,
  serverId,
  currentCode,
  freeServer,
  onClose,
  onDone,
  onOpenServer,
}: {
  mode: 'create' | 'upgrade'
  serverId?: string
  currentCode?: string | null
  freeServer?: { id: string; name?: string } | null
  onClose: () => void
  onDone: () => void
  onOpenServer?: (id: string) => void
}) {
  const [plans, setPlans] = useState<HostPlan[]>([])
  const [vis, setVis] = useState(false)
  const [name, setName] = useState('')
  const [playKind, setPlayKind] = useState('vanilla')
  const [busy, setBusy] = useState('')
  const [mapQuery, setMapQuery] = useState('')
  const [maps, setMaps] = useState<CurseMap[] | null>(null)
  const [mapPick, setMapPick] = useState<CurseMap | null>(null)
  const [mapErr, setMapErr] = useState('')
  const millidaAcc = getMillidaAccount()
  const balance = millidaAcc && millidaAcc.balance != null ? millidaAcc.balance : null
  const ownNick = (millidaAcc && millidaAcc.nick) || ''
  const autoAddress = ownNick && !name.trim() ? hostAddressPreview(ownNick) : ''

  useEffect(() => {
    const t = setTimeout(() => setVis(true), 10)
    api('/hosting/plans')
      .then((r) => setPlans((Array.isArray(r) ? r : []).filter((p: HostPlan) => p.code)))
      .catch(() => setPlans([]))
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (mode !== 'create' || playKind !== 'map') return
    let dead = false
    const t = setTimeout(() => {
      setMaps(null)
      setMapErr('')
      const qs = mapQuery.trim() ? '&query=' + encodeURIComponent(mapQuery.trim()) : ''
      api('/hosting/catalog/curseforge?type=map' + qs)
        .then((r) => {
          if (dead) return
          setMaps(Array.isArray(r?.hits) ? r.hits : [])
          if (r?.error) setMapErr(String(r.error))
          else if (r && r.enabled === false) setMapErr('Каталог карт сейчас недоступен')
        })
        .catch(() => {
          if (!dead) {
            setMaps([])
            setMapErr('Каталог карт сейчас недоступен')
          }
        })
    }, 350)
    return () => {
      dead = true
      clearTimeout(t)
    }
  }, [mode, playKind, mapQuery])

  const insufficient = (e: string) => /баланс|средств|insufficient|not enough|hosting:funds/i.test(e)

  const pick = async (p: HostPlan) => {
    if (busy) return
    const isFree = !p.priceKopecks
    setBusy(p.code)
    track('store_open', { where: mode === 'create' ? 'hosting_create' : 'hosting_plan', plan: p.code })
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = { playKind }
        if (!isFree) body.planCode = p.code
        if (name.trim()) body.name = name.trim()
        const srv = await api('/hosting/servers', { method: 'POST', body: JSON.stringify(body) })
        if (isFree && srv && srv.id) {
          await api('/hosting/servers/' + srv.id + '/settings', {
            method: 'PATCH',
            body: JSON.stringify({ onlineMode: false }),
          }).catch(() => {})
        }
        if (mapPick && srv && srv.id) {
          const ver = await mapGameVersion(mapPick.id)
          if (ver) {
            await api('/hosting/servers/' + srv.id + '/core', {
              method: 'PATCH',
              body: JSON.stringify({ version: ver }),
            }).catch(() => {})
          }
          await api('/hosting/servers/' + srv.id + '/installs', {
            method: 'POST',
            body: JSON.stringify({ projectId: String(mapPick.id), source: 'curseforge' }),
          })
          showToast('Сервер с картой «' + mapPick.name + '» создаётся')
        } else {
          showToast('Сервер создаётся — появится в списке через минуту')
        }
      } else {
        await api('/hosting/servers/' + serverId + '/plan', {
          method: 'POST',
          body: JSON.stringify({ code: p.code, period: 'month' }),
        })
        showToast('Тариф изменён на «' + p.name + '»')
      }
      onDone()
      onClose()
    } catch (e) {
      const msg = '' + e
      if (insufficient(msg)) {
        showToast('Не хватает средств на балансе Millida — пополни и повтори', 'error')
        openExt(WALLET_URL)
      } else {
        showToast('Не получилось: ' + msg, 'error')
      }
    } finally {
      setBusy('')
    }
  }

  return (
    <div
      className={'modal-bg open' + (vis ? ' vis' : '')}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" style={{ width: '620px' }}>
        <h2>{mode === 'create' ? 'Новый сервер' : 'Улучшить тариф'}</h2>
        <div className="sub">
          {mode === 'create'
            ? 'Выбери тариф — бесплатный запускается сразу, платный даёт больше памяти и не засыпает.'
            : 'Больше памяти и слотов, без сна. Списывается с баланса Millida.'}
        </div>

        {mode === 'create' ? (
          <>
            <div className="field" style={{ marginBottom: '12px' }}>
              <label>Название сервера (необязательно)</label>
              <div className="input">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={ownNick || 'Мой сервер'}
                  maxLength={40}
                />
              </div>
              <div className="faint-note" style={{ marginTop: '6px', fontSize: '12px' }}>
                {autoAddress
                  ? 'Оставь пустым — сервер будет называться «' + ownNick + '», адрес ' + autoAddress
                  : 'Оставь пустым — придумаем название и адрес сами'}
              </div>
            </div>
            <div className="field" style={{ marginBottom: '16px' }}>
              <label>Во что играем</label>
              <div className="segs">
                {PLAY_KINDS.map(([k, ic, lab]) => (
                  <button
                    key={k}
                    className={'seg' + (playKind === k ? ' on' : '')}
                    onClick={() => {
                      setPlayKind(k)
                      if (k !== 'map') setMapPick(null)
                    }}
                  >
                    <Icon id={ic} />
                    {lab}
                  </button>
                ))}
              </div>
            </div>

            {playKind === 'map' ? (
              <div className="field" style={{ marginBottom: '16px' }}>
                <label>{mapPick ? 'Карта: ' + mapPick.name : 'Выбери карту'}</label>
                <div className="input" style={{ marginBottom: '10px' }}>
                  <input
                    value={mapQuery}
                    onChange={(e) => setMapQuery(e.target.value)}
                    placeholder="Поиск: Diversity, Parkour, Escape…"
                    maxLength={60}
                  />
                </div>
                {mapErr ? (
                  <p className="faint-note" style={{ color: 'var(--danger)' }}>{mapErr}</p>
                ) : maps === null ? (
                  <p className="faint-note">Ищем карты…</p>
                ) : maps.length === 0 ? (
                  <p className="faint-note">Ничего не нашлось — попробуй другое название</p>
                ) : (
                  <div style={{ display: 'grid', gap: '8px', maxHeight: '230px', overflowY: 'auto' }}>
                    {maps.map((m) => (
                      <button
                        key={m.id}
                        className={'plan-card' + (mapPick?.id === m.id ? ' cur' : '')}
                        style={{ display: 'flex', gap: '10px', alignItems: 'center', textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => setMapPick(mapPick?.id === m.id ? null : m)}
                      >
                        {m.iconUrl ? (
                          <img src={m.iconUrl} alt="" width={36} height={36} style={{ borderRadius: '8px', flexShrink: 0 }} />
                        ) : null}
                        <span style={{ minWidth: 0 }}>
                          <span className="plan-name" style={{ display: 'block' }}>{m.name}</span>
                          <span className="plan-tag" style={{ display: 'block' }}>
                            {m.downloads ? m.downloads.toLocaleString('ru-RU') + ' загрузок' : ''}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="faint-note" style={{ marginTop: '8px' }}>
                  Версия сервера подстроится под карту автоматически, и мир развернётся при первом запуске.
                </p>
              </div>
            ) : null}

            {freeServer ? (
              <div className="field" style={{ marginBottom: '16px' }}>
                <p className="faint-note">
                  Бесплатный сервер у тебя уже есть — «{freeServer.name || 'без названия'}», он один на аккаунт.
                  Карту можно поменять прямо на нём, а второй сервер живёт на платном тарифе.
                </p>
                {onOpenServer ? (
                  <button
                    className="btn sm ghost"
                    style={{ marginTop: '8px' }}
                    onClick={() => {
                      onOpenServer(freeServer.id)
                      onClose()
                    }}
                  >
                    Открыть «{freeServer.name || 'мой сервер'}»
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        <div className="plan-wallet">
          <span>
            <Icon id="i-wallet" />
            Баланс Millida: <b>{balance === null ? '—' : rub(balance) + ' ₽'}</b>
          </span>
          <button className="btn sm ghost" onClick={() => openExt(WALLET_URL)}>
            Пополнить
          </button>
        </div>

        <div className="plan-list">
          {plans.length === 0 ? (
            <p className="faint-note" style={{ padding: '10px 0' }}>Загружаем тарифы…</p>
          ) : (
            plans.map((p) => {
              const free = !p.priceKopecks
              const isCur = currentCode && p.code === currentCode
              const freeBlocked = mode === 'create' && free && !!freeServer
              const needMap = mode === 'create' && playKind === 'map' && !mapPick
              return (
                <div className={'plan-card' + (isCur ? ' cur' : '')} key={p.code}>
                  <div className="plan-head">
                    <span className="plan-name">{p.name}</span>
                    {free && /бесплат/i.test(p.name) ? null : (
                      <span className="plan-price">{free ? 'Бесплатно' : rub(p.priceKopecks) + ' ₽/мес'}</span>
                    )}
                  </div>
                  {p.tagline ? <div className="plan-tag">{p.tagline}</div> : null}
                  <div className="plan-specs">
                    {p.ramMb ? <span><Icon id="i-monitor" /> {gb(p.ramMb)} ГБ</span> : null}
                    {p.maxPlayers ? <span><Icon id="i-users" /> {p.maxPlayers} слотов</span> : null}
                    {p.diskMb ? <span><Icon id="i-box" /> {gb(p.diskMb)} ГБ диск</span> : null}
                  </div>
                  <button
                    className={'btn sm ' + (isCur ? 'ghost' : 'primary')}
                    style={{ width: '100%', marginTop: '10px' }}
                    disabled={!!isCur || busy === p.code || freeBlocked || needMap}
                    onClick={() => void pick(p)}
                  >
                    {isCur ? null : free ? <Icon id="i-play" /> : <Icon id="i-wallet" />}
                    {isCur
                      ? 'Текущий тариф'
                      : busy === p.code
                        ? 'Оформляем…'
                        : freeBlocked
                          ? 'Бесплатный уже есть'
                          : needMap
                            ? 'Сначала выбери карту'
                            : free
                              ? 'Запустить бесплатно'
                              : 'Оплатить ' + rub(p.priceKopecks) + ' ₽'}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <button className="btn sm ghost" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}
