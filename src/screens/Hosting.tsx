import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { HostingManage } from './HostingManage'
import { WALLET_URL, api, hasMillidaAccount, openExt } from '../lib/api'
import { track } from '../lib/telemetry'
import { HostPlanPicker } from '../components/HostPlanPicker'
import { useAccounts } from '../state/accounts'
import { loadMillidaProfile, logoutToLogin } from '../lib/session'
import { hasTauri } from '../ipc/tauri'
import { addServer } from '../ipc/commands'
import { useProfiles } from '../state/profiles'
import { rememberServerName } from '../state/playStats'
import { useHasMillida } from '../state/auth'
import { joinWithAuth, showLaunchError } from '../lib/launch'
import { setScreen, showToast } from '../state/ui'
import { Head } from '../components/Head'
import { openChat, useFriends } from '../state/friends'
import { encodeInvite } from '../lib/invite'
import { usePolling } from '../lib/usePolling'
import { copyText } from '../lib/clipboard'

const HOST_ST: Record<string, [string, string]> = {
  RUNNING: ['Работает', 'acc'],
  STARTING: ['Запускается', 'warn'],
  STOPPING: ['Останавливается', 'warn'],
  STOPPED: ['Остановлен', 'off'],
  SUSPENDED: ['Приостановлен', 'danger'],
  QUEUED: ['В очереди', 'warn'],
  SLEEPING: ['Спит', 'off'],
  CRASHED: ['Упал', 'danger'],
  INSTALLING: ['Устанавливается', 'warn'],
}

export interface HostServer {
  id: string
  name?: string
  slug?: string
  status?: string
  address?: string
  icon?: string
  core?: string
  version?: string
  preset?: string
  planName?: string
  planCode?: string
  planRamMb?: number
  ramMb?: number
  maxPlayers?: number
  planMaxPlayers?: number
  playersOnline?: number
  inviteUrl?: string
  pendingRestart?: string[]
  planPriceKopecks?: number | null
  expiresAt?: string | null
  worldDeleteAt?: string | null
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

type View = 'initial' | 'gate' | 'loading' | 'error' | 'empty' | 'list'

const MODDED_CORE = /forge|fabric|quilt|curse|ftb|modrinth|mohist|magma|arclight|catserver|banner|sponge/i

const isModded = (s: HostServer) => MODDED_CORE.test((s.core || '') + ' ' + (s.preset || ''))

function HostSkeleton() {
  return (
    <div className="card skel-card">
      <div className="skel-row">
        <span className="skel" style={{ width: '34px', height: '34px', borderRadius: '8px' }}></span>
        <span className="skel skel-line" style={{ width: '180px' }}></span>
        <span className="skel skel-line" style={{ width: '90px', height: '22px', borderRadius: '999px' }}></span>
        <span style={{ marginLeft: 'auto' }}></span>
        <span className="skel skel-line" style={{ width: '150px', height: '30px', borderRadius: '999px' }}></span>
      </div>
      <div className="skel skel-line" style={{ width: '220px', marginTop: '12px' }}></div>
      <div className="kpi-row">
        {[0, 1, 2].map((i) => (
          <div className="kpi" key={i}>
            <div className="skel skel-line" style={{ width: '60px', height: '10px' }}></div>
            <div className="skel skel-line" style={{ width: '80px', height: '18px', margin: '8px 0' }}></div>
            <div className="skel" style={{ height: '6px', borderRadius: '999px' }}></div>
          </div>
        ))}
      </div>
      <div className="skel-row" style={{ marginTop: '20px' }}>
        {[150, 130, 140, 160].map((w, i) => (
          <span key={i} className="skel skel-line" style={{ width: w + 'px', height: '38px', borderRadius: '12px' }}></span>
        ))}
      </div>
    </div>
  )
}

export function Hosting({ on }: { on: boolean }) {
  const [view, setView] = useState<View>('initial')
  const [err, setErr] = useState('')
  const [list, setList] = useState<HostServer[]>([])
  const [manageId, setManageId] = useState<string | null>(null)
  const [inviteFor, setInviteFor] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ mode: 'create' | 'upgrade'; serverId?: string; currentCode?: string | null } | null>(null)
  const friends = useFriends((s) => s.friends)
  const millida = useHasMillida()
  const loadedRef = useRef(false)
  const accList = useAccounts((s) => s.list)
  const millidaAcc = accList.find((a) => a.kind === 'millida' || a.kind === 'tg')
  const balance = ((millidaAcc?.balance || 0) / 100) | 0

  useEffect(() => {
    if (!inviteFor) return
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.host-invite-wrap')) return
      setInviteFor(null)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [inviteFor])

  const invite = async (uid: string, nick: string, s: HostServer) => {
    setInviteFor(null)
    const addr = s.address || ''
    if (!addr) {
      showToast('Сервер ещё запускается — адрес появится позже', 'error')
      return
    }
    const text = encodeInvite(addr, s.name || 'Мой сервер')
    try {
      await api('/friends/chat/' + encodeURIComponent(uid), { method: 'POST', body: JSON.stringify({ text }) })
    } catch {}
    await openChat(uid, nick)
    showToast('Приглашение отправлено: ' + nick)
  }

  const load = async (silent?: boolean) => {
    if (!hasMillidaAccount()) {
      setView('gate')
      return
    }
    if (!silent) setView('loading')
    let data: HostServer[]
    try {
      data = await api('/hosting/servers/me')
    } catch (e) {
      if (silent) return
      setErr('' + e)
      setView('error')
      return
    }
    const arr = Array.isArray(data) ? data : []
    loadedRef.current = arr.length > 0
    setList(arr)
    setView(arr.length ? 'list' : 'empty')
    try {
      const primary = arr.find((s) => s.address)
      if (primary) localStorage.setItem('m-host-pin', JSON.stringify({ name: primary.name || 'Мой сервер', addr: primary.address }))
      else localStorage.removeItem('m-host-pin')
    } catch {}
  }

  useEffect(() => {
    if (!on) return
    void load(loadedRef.current)
    if (hasMillidaAccount()) void loadMillidaProfile()
  }, [on])

  usePolling(() => void load(true), 20000, { enabled: on, hiddenMs: 0, immediate: false })

  const act = async (sid: string, path: string, label: string, ok: string) => {
    showToast(label)
    try {
      await api('/hosting/servers/' + sid + path, { method: 'POST' })
      showToast(ok)
      setTimeout(() => void load(), 1200)
    } catch (e) {
      showToast('Ошибка: ' + e)
      void load()
    }
  }

  const card = (s: HostServer) => {
    const st = HOST_ST[s.status || ''] || ['—', 'off']
    // planRamMb is the plan cap; ramMb without a cap is allocated memory, not usage.
    const ramCap = s.planRamMb || 0
    const ramUsed = s.ramMb || 0
    const hasRamUse = ramCap > 0 && ramUsed > 0
    const ramGb = (mb: number) => (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1).replace('.', ',')
    const totalRamMb = ramCap || ramUsed || 0
    const ramPct = hasRamUse ? Math.min(100, Math.round((ramUsed / ramCap) * 100)) : 0
    const maxP = s.maxPlayers || s.planMaxPlayers || 0
    const running = s.status === 'RUNNING'
    const addr = s.address || ''
    const copy = async (text: string) => {
      showToast((await copyText(text)) ? 'Адрес скопирован: ' + addr : 'Скопируй адрес вручную: ' + addr)
    }
    const join = () => {
      if (!addr) {
        showToast('Сервер ещё запускается')
        return
      }
      if (!hasTauri()) {
        showToast('Вход на сервер — в приложении')
        return
      }
      const { selected, profiles } = useProfiles.getState()
      const prof = selected || (profiles[0] || { name: '' }).name || ''
      if (!prof) {
        showToast('Сначала создай сборку под свой сервер')
        setScreen('mods')
        return
      }
      showToast('Заходим на твой сервер…')
      addServer(prof, s.name || 'Мой сервер', addr).catch(() => {})
      rememberServerName(addr, s.name || 'Мой сервер')
      joinWithAuth(prof, null, addr, s.name || 'Мой сервер').catch((e) => showLaunchError(e))
    }
    const cfg: [string, string, string][] = []
    if (s.core) cfg.push(['i-blocks', 'Ядро', s.core + (s.version ? ' ' + s.version : '')])
    else if (s.version) cfg.push(['i-blocks', 'Версия', s.version])
    if (s.preset) cfg.push(['i-box', 'Сборка', s.preset])
    if (s.planName || s.planCode) cfg.push(['i-star', 'Тариф', s.planName || s.planCode || ''])
    if (totalRamMb) cfg.push(['i-monitor', 'Память', ramGb(totalRamMb) + ' ГБ'])
    if (maxP) cfg.push(['i-users', 'Слотов', String(maxP)])
    return (
      <div className="card host-card" style={{ padding: '22px', marginBottom: '14px' }} data-sid={s.id} data-addr={addr} key={s.id}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {s.icon ? (
            <img
              src={s.icon}
              alt=""
              onError={(e) => {
                e.currentTarget.src = '/millida-logo.svg'
              }}
              style={{ width: '34px', height: '34px', borderRadius: '8px', objectFit: 'cover' }}
            />
          ) : !s.planPriceKopecks ? (
            <span className="host-ico free">
              <img src="/millida-logo.svg" alt="" />
            </span>
          ) : (
            <span className="host-ico">
              <Icon id="i-server-cog" />
            </span>
          )}
          <h2 style={{ fontSize: '19px', fontWeight: 700 }}>{s.name || s.slug}</h2>
          <span className={'pill ' + st[1]}>
            <span className="dot"></span> {st[0]}
          </span>
          <span style={{ marginLeft: 'auto' }}></span>
          <button className="ip-pill host-ip" data-ip={addr} onClick={() => void copy(addr)}>
            {addr || '—'}
            <Icon id="i-copy" />
          </button>
        </div>

        {cfg.length ? (
          <div className="host-cfg">
            {cfg.map(([ic, k, v]) => (
              <div className="host-cfg-row" key={k}>
                <Icon id={ic} />
                <span className="host-cfg-k">{k}</span>
                <span className="host-cfg-v">{v}</span>
              </div>
            ))}
          </div>
        ) : null}

        {s.expiresAt && fmtDate(s.expiresAt) ? (
          <div className="host-expiry">
            <Icon id="i-clock" />
            Оплачен до {fmtDate(s.expiresAt)} · следующая оплата {fmtDate(s.expiresAt)}
          </div>
        ) : !s.planPriceKopecks && s.worldDeleteAt && fmtDate(s.worldDeleteAt) ? (
          <div className="host-expiry">
            <Icon id="i-clock" />
            Бесплатный тариф · мир хранится до {fmtDate(s.worldDeleteAt)}
          </div>
        ) : null}

        <div className="kpi-row">
          <div className="kpi">
            <div className="cap">Игроки</div>
            <div className="val">
              {s.playersOnline || 0}
              {maxP ? <span> / {maxP}</span> : null}
            </div>
            <div className="bar">
              <i style={{ width: (maxP ? Math.min(100, ((s.playersOnline || 0) / maxP) * 100) : 0) + '%' }}></i>
            </div>
          </div>
          <div className="kpi">
            <div className="cap">Память</div>
            <div className="val">
              {hasRamUse ? (
                <>
                  {ramGb(ramUsed)} <span>/ {ramGb(ramCap)} ГБ</span>
                </>
              ) : totalRamMb ? (
                <>
                  {ramGb(totalRamMb)} <span>ГБ выделено</span>
                </>
              ) : (
                '—'
              )}
            </div>
            <div className="bar">
              <i style={{ width: (hasRamUse ? ramPct : totalRamMb ? 100 : 0) + '%' }}></i>
            </div>
          </div>
          <div className="kpi">
            <div className="cap">Статус</div>
            <div className="val" style={{ fontSize: '15px' }}>
              {st[0]}
            </div>
            <div className="bar">
              <i className={'st-' + st[1]} style={{ width: running ? '100%' : '35%' }}></i>
            </div>
          </div>
        </div>
        <div className="host-actions">
          {running ? (
            <button className="btn md primary host-join" onClick={join}>
              <Icon id="i-play" /> Зайти на сервер
            </button>
          ) : (
            <button
              className="btn md primary host-start"
              disabled={s.status === 'STARTING' || s.status === 'INSTALLING'}
              onClick={() => void act(s.id, '/start', 'Запускаем сервер…', 'Сервер запускается')}
            >
              <Icon id="i-play" /> Запустить
            </button>
          )}
          <button className="btn md secondary host-manage-btn" onClick={() => setManageId(s.id)}>
            <Icon id="i-server-cog" /> Управлять
          </button>

          <div className="host-invite-wrap">
            <button
              className="btn md secondary host-invite"
              onClick={(e) => {
                e.stopPropagation()
                setInviteFor(inviteFor === s.id ? null : s.id)
              }}
            >
              <Icon id="i-users" /> Пригласить друга
            </button>
            {inviteFor === s.id ? (
              <div className="host-invite-pop" onClick={(e) => e.stopPropagation()}>
                <div className="host-invite-cap">Кого позвать на сервер</div>
                {friends.length ? (
                  friends.map((f) => (
                    <button
                      key={f.userId}
                      className="host-invite-friend"
                      onClick={() => void invite(f.userId, f.nickname || '', s)}
                    >
                      <Head nick={f.nickname} size={40} />
                      <span className="host-invite-nick">{f.nickname || ''}</span>
                      <span className={'host-invite-dot' + (f.online ? ' on' : '')}></span>
                    </button>
                  ))
                ) : (
                  <p className="faint-note" style={{ padding: '6px 8px', margin: 0 }}>
                    Добавь друзей в разделе «Друзья» — сможешь звать их сюда.
                  </p>
                )}
              </div>
            ) : null}
          </div>

          {running ? (
            <>
              <button
                className="btn md ghost host-restart"
                title="Перезапустить"
                onClick={() => void act(s.id, '/restart', 'Перезапускаем…', 'Сервер перезапускается')}
              >
                <Icon id="i-restart" />
              </button>
              <button
                className="btn md ghost host-stop"
                title="Остановить"
                onClick={() => void act(s.id, '/stop', 'Останавливаем…', 'Сервер остановлен')}
              >
                <Icon id="i-power" />
              </button>
            </>
          ) : null}

          <button
            className="btn md ghost host-upgrade"
            onClick={() => setPicker({ mode: 'upgrade', serverId: s.id, currentCode: s.planCode })}
          >
            <Icon id="i-arrow-up" /> Улучшить тариф
          </button>
          {isModded(s) ? (
            <button
              className="btn md ghost host-modpack"
              onClick={() => {
                setScreen('mods')
                showToast('Выбери модпак — поставим на сервер или себе')
              }}
            >
              Установить модпак
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const manageServer = manageId ? list.find((s) => s.id === manageId) : null
  if (manageServer) {
    return (
      <section className={'screen' + (on ? ' on' : '')} id="s-hosting">
        <HostingManage
          server={manageServer}
          onBack={() => setManageId(null)}
          onRefreshList={() => void load(true)}
          onUpgrade={(sid, code) => setPicker({ mode: 'upgrade', serverId: sid, currentCode: code })}
        />
        {picker ? (
          <HostPlanPicker
            mode={picker.mode}
            serverId={picker.serverId}
            currentCode={picker.currentCode}
            freeServer={null}
            onOpenServer={(id) => setManageId(id)}
            onClose={() => setPicker(null)}
            onDone={() => setTimeout(() => void load(true), 1500)}
          />
        ) : null}
      </section>
    )
  }

  return (
    <section className={'screen' + (on ? ' on' : '')} id="s-hosting">
      <div className="page-head">
        <h1>Мой сервер</h1>
        <div className="right" style={{ gap: '10px' }}>
          {millida ? (
            <span className="host-bal">
              Баланс: <b>{balance.toLocaleString('ru-RU')} ₽</b>
              <button
                className="btn sm ghost"
                onClick={() => {
                  track('store_open', { where: 'wallet_topup' })
                  openExt(WALLET_URL)
                }}
              >
                <Icon id="i-wallet" /> Пополнить
              </button>
            </span>
          ) : null}
          {(view === 'list' || view === 'empty') && millida ? (
            <button className="btn sm primary" onClick={() => setPicker({ mode: 'create' })}>
              <Icon id="i-plus" /> Новый сервер
            </button>
          ) : null}
          <button
            className="btn sm ghost"
            id="hostPanel"
            onClick={() => openExt('https://millida.net/hosting')}
          >
            Веб-панель
            <Icon id="i-ext" />
          </button>
        </div>
      </div>

      <div id="hostBody">
        {view === 'initial' || view === 'loading' ? <HostSkeleton /> : null}
        {view === 'gate' ? (
          <div className="card gate-card">
            <div className="gate-ic">
              <Icon id="i-server" />
            </div>
            <div className="gate-title">Твой сервер — в аккаунте Millida</div>
            <p className="faint-note gate-text">
              Войди в Millida — увидишь свои серверы Millida Hosting, сможешь запускать, останавливать и заходить на них
              прямо из лаунчера.
            </p>
            <button className="btn md primary gate-btn" id="hostLoginCta" onClick={() => logoutToLogin()}>
              Войти в Millida
            </button>
          </div>
        ) : null}
        {view === 'error' ? (
          <div className="card" style={{ padding: '20px' }}>
            <p className="faint-note">
              {'Не удалось загрузить серверы: ' + err + '. '}
              <a
                href="#"
                id="hostRetry"
                onClick={(ev) => {
                  ev.preventDefault()
                  void load()
                }}
              >
                Повторить
              </a>
            </p>
          </div>
        ) : null}
        {view === 'empty' ? (
          <div className="card" style={{ padding: '26px', maxWidth: '560px' }}>
            <div className="eyebrow" style={{ marginBottom: '8px' }}>
              Своего сервера ещё нет
            </div>
            <p style={{ fontSize: '13.5px', color: 'var(--m-fg-muted)', lineHeight: 1.6, marginBottom: '16px' }}>
              Сервер на Millida Hosting — от 219 ₽ в месяц: 2 ГБ памяти, моды и бэкапы. Запускается за минуту, друзья
              заходят по короткому адресу.
            </p>
            <button className="btn md primary" id="hostCreate" onClick={() => setPicker({ mode: 'create' })}>
              <Icon id="i-plus" /> Создать сервер
            </button>
          </div>
        ) : null}
        {view === 'list' ? list.map(card) : null}
      </div>

      {picker ? (
        <HostPlanPicker
          mode={picker.mode}
          serverId={picker.serverId}
          currentCode={picker.currentCode}
          freeServer={
            picker.mode === 'create'
              ? (list.find((s) => !s.planPriceKopecks) ?? null)
              : null
          }
          onOpenServer={(id) => setManageId(id)}
          onClose={() => setPicker(null)}
          onDone={() => setTimeout(() => void load(true), 1500)}
        />
      ) : null}
    </section>
  )
}
