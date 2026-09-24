import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { HostingManage } from './HostingManage'
import { api, hasMillidaAccount, openExt } from '../lib/api'
import { HostPlanPicker } from '../components/HostPlanPicker'
import { loadMillidaProfile, logoutToLogin } from '../lib/session'
import { hasTauri } from '../ipc/tauri'
import { addServer, pinServerDat } from '../ipc/commands'
import { rememberServerName } from '../state/playStats'
import { useHasMillida } from '../state/auth'
import { noteHostingServers } from '../state/navHint'
import { joinStarted, joinWithAuth, showLaunchError } from '../lib/launch'
import { buildForServer } from '../lib/joinServer'
import { serverVersions } from '../lib/mcVersion'
import { anyGameRunning, isGameRunning } from '../state/game'
import { uiConfirm } from '../state/confirm'
import { setScreen, showToast } from '../state/ui'
import { Head } from '../components/Head'
import { openChat, useFriends } from '../state/friends'
import { encodeInvite } from '../lib/invite'
import { usePolling } from '../lib/usePolling'
import { noteMyServers } from '../state/playInvite'
import { InviteChip } from '../components/friends/InviteChip'
import { HostRoads, hostPlanFacts } from '../components/hosting/HostRoads'
import type { HostPlanLite } from '../components/hosting/HostRoads'
import { HostScene, HostStat } from '../components/hosting/HostScene'
import { BalancePill } from '../components/hosting/HostKit'
// Стиль экрана подключается здесь: App импортируется в main.tsx после кита и
// 12-pixel.css, поэтому порядок правил сохраняется.
import '../styles/pixel/hosting2.css'
import '../styles/pixel/hosting-scene.css'
import '../styles/pixel/hosting-panel.css'

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
  planDiskMb?: number
  planFullAccess?: boolean
  ramMb?: number
  maxPlayers?: number
  planMaxPlayers?: number
  playersOnline?: number
  inviteUrl?: string
  pendingRestart?: string[]
  planPriceKopecks?: number | null
  expiresAt?: string | null
  worldDeleteAt?: string | null
  lastSeenAt?: string | null
  diskUsedMb?: number
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}

type View = 'initial' | 'gate' | 'loading' | 'error' | 'empty' | 'list'

function HostSkeleton() {
  return (
    <div className="hsx-scene is-skel" aria-busy="true">
      <div className="hsx-green">
        <div className="hsx-id">
          <span className="skel" style={{ width: 56, height: 56 }}></span>
          <div className="hsx-id-txt">
            <span className="skel skel-line" style={{ width: 90 }}></span>
            <span className="skel skel-line" style={{ width: 200, height: 26, marginTop: 8 }}></span>
          </div>
        </div>
        <span className="skel skel-line" style={{ width: 260, height: 40 }}></span>
        <div className="hsx-acts">
          <span className="skel" style={{ width: 180, height: 52 }}></span>
          <span className="skel" style={{ width: 150, height: 52 }}></span>
        </div>
      </div>
      <div className="hsx-navy">
        {[0, 1].map((i) => (
          <span key={i} className="skel" style={{ height: 76 }}></span>
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
  const [picker, setPicker] = useState<{
    mode: 'create' | 'upgrade'
    serverId?: string
    currentCode?: string | null
    focus?: 'free' | 'paid'
  } | null>(null)
  const [plans, setPlans] = useState<HostPlanLite[]>([])
  const friends = useFriends((s) => s.friends)
  const millida = useHasMillida()
  const loadedRef = useRef(false)

  // Числа платных тарифов нужны и полосе продажи под карточкой сервера.
  useEffect(() => {
    if (!on) return
    let alive = true
    api('/hosting/plans')
      .then((r) => alive && setPlans(Array.isArray(r) ? r : []))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [on])

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
      // Текст ошибки нужен логам, а не игроку: на экране — фраза и «Повторить».
      console.error('[hosting] servers/me', e)
      setErr('' + e)
      setView('error')
      return
    }
    const arr = Array.isArray(data) ? data : []
    loadedRef.current = arr.length > 0
    noteHostingServers(arr.length)
    setList(arr)
    setView(arr.length ? 'list' : 'empty')
    // «Позвать играть» из друзей ждёт сервер: как только у него есть адрес,
    // приглашение уходит само (state/playInvite).
    noteMyServers(arr)
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
      console.error('[hosting] ' + path, e)
      showToast('Не получилось — попробуй ещё раз', 'error')
      void load()
    }
  }

  const facts = hostPlanFacts(plans)
  const planRub = (k: number) => Math.round(k / 100).toLocaleString('ru-RU')
  const planGb = (mb: number) => (mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1).replace('.', ',')

  const joinServer = async (s: HostServer) => {
    const addr = s.address || ''
    if (!addr) {
      showToast('Сервер ещё запускается')
      return
    }
    if (!hasTauri()) {
      showToast('Вход на сервер — в приложении')
      return
    }
    const sname = s.name || 'Мой сервер'
    // Свой сервер тоже не пустит клиент чужой версии: сборку выбираем (или
    // предлагаем создать) под версию, на которой он крутится.
    const wanted = serverVersions(s.version ? [s.version] : [])
    const prof = await buildForServer({ ip: addr, name: sname, licensed: false, versions: wanted }, wanted)
    if (!prof) return
    addServer(prof, sname, addr).catch(() => {})
    rememberServerName(addr, sname)
    if (anyGameRunning()) {
      // Вторая копия ради входа на сервер почти всегда не нужна: игра уже
      // запущена, и сервер достаточно закрепить в её списке.
      void pinServerDat(prof, sname, addr).catch(() => {})
      void uiConfirm(
        isGameRunning(prof)
          ? 'Игра уже запущена — «' + sname + '» закреплён первым в списке серверов, зайди прямо из неё. Запустить вторую копию игры?'
          : 'Уже запущена другая сборка. «' + sname + '» закреплён в списке серверов сборки «' + prof + '». Запустить её второй копией?',
        {
          title: 'Игра уже запущена',
          confirmLabel: 'Запустить вторую копию',
          cancelLabel: 'Не запускать',
          danger: false,
        },
      ).then((ok) => {
        if (!ok) return
        joinWithAuth(prof, null, addr, sname, { confirmed: true })
          .then((res) => {
            if (joinStarted(res)) showToast('Заходим на твой сервер…')
          })
          .catch((e) => showLaunchError(e))
      })
      return
    }
    joinWithAuth(prof, null, addr, sname)
      .then((res) => {
        if (joinStarted(res)) showToast('Заходим на твой сервер…')
      })
      .catch((e) => showLaunchError(e))
  }

  const card = (s: HostServer) => {
    const ramCap = s.planRamMb || 0
    const ramMb = s.ramMb || 0
    const maxP = s.maxPlayers || s.planMaxPlayers || 0
    const onl = s.playersOnline || 0
    const running = s.status === 'RUNNING'
    const addr = s.address || ''
    const coreTag = [s.core, s.version].filter(Boolean).join(' ')
    const planFree = !s.planPriceKopecks
    // Полоса продажи: живые числа платных тарифов и одна кнопка. Верхний тариф
    // её не показывает — предлагать там нечего.
    const canUpsell = facts.ramHigh > 0 && (planFree || (s.planRamMb || 0) < facts.ramHigh)
    const note =
      s.expiresAt && fmtDate(s.expiresAt)
        ? 'Оплачен до ' + fmtDate(s.expiresAt)
        : planFree && s.worldDeleteAt && fmtDate(s.worldDeleteAt)
          ? 'Мир хранится до ' + fmtDate(s.worldDeleteAt)
          : undefined
    return (
      <div className="host-card hsx-card" data-sid={s.id} data-addr={addr} key={s.id}>
        <HostScene
          name={s.name || s.slug || 'Мой сервер'}
          status={s.status || ''}
          address={addr}
          icon={s.icon}
          free={planFree}
          tag={coreTag}
          note={note}
          actions={
            <>
              {/* Карточка в списке: одна главная кнопка, «Управлять» и «Позвать».
                  Перезапуск и остановка без подписей отсюда ушли в «Управлять» —
                  там они с подписью и с подтверждением (приказ 23.09.2026). */}
              {running ? (
                <button className="btn lg primary host-join hsx-main" onClick={() => void joinServer(s)}>
                  <Icon id="i-play" /> Играть
                </button>
              ) : (
                <button
                  className="btn lg primary host-start hsx-main"
                  disabled={s.status === 'STARTING' || s.status === 'INSTALLING'}
                  onClick={() => void act(s.id, '/start', 'Запускаем сервер…', 'Сервер запускается')}
                >
                  <Icon id="i-play" /> Запустить
                </button>
              )}
              <button className="btn lg secondary host-manage-btn" onClick={() => setManageId(s.id)}>
                <Icon id="i-server-cog" /> Управлять
              </button>
              <div className="host-invite-wrap">
                <button
                  className="btn lg secondary host-invite"
                  onClick={(e) => {
                    e.stopPropagation()
                    setInviteFor(inviteFor === s.id ? null : s.id)
                  }}
                >
                  <Icon id="i-users" /> Позвать
                </button>
                {inviteFor === s.id ? (
                  <div className="host-invite-pop" onClick={(e) => e.stopPropagation()}>
                    <div className="host-invite-cap">Кого позвать</div>
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
                      <button className="btn sm secondary hs-invite-empty" onClick={() => setScreen('friends')}>
                        <Icon id="i-plus" /> Найти друзей
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          }
          stats={
            <>
              <HostStat
                block={32}
                big={
                  <>
                    {onl}
                    {maxP ? <small> / {maxP}</small> : null}
                  </>
                }
                small="игроков в сети"
                pct={maxP ? (onl / maxP) * 100 : null}
              />
              {/* ramMb у сервера — выделенная память, а не занятая (тип HostingServer
                  на сайте): живой расход — только в «Управлять», из /stats. */}
              {ramCap || ramMb ? <HostStat block={20} big={planGb(ramCap || ramMb) + ' ГБ'} small="памяти" /> : null}
              {canUpsell ? (
                <HostStat
                  block={1}
                  big={planFree ? 'Тарифы' : s.planName || 'Тариф'}
                  small={
                    (planFree && facts.minPrice > 0 ? 'от ' + planRub(facts.minPrice) + ' ₽ · ' : '') +
                    'до ' +
                    planGb(facts.ramHigh) +
                    ' ГБ'
                  }
                  onClick={() => setPicker({ mode: 'upgrade', serverId: s.id, currentCode: s.planCode, focus: 'paid' })}
                />
              ) : null}
            </>
          }
        />
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
          onPlay={() => void joinServer(manageServer)}
          onRefreshList={() => void load(true)}
          onUpgrade={(sid, code) => setPicker({ mode: 'upgrade', serverId: sid, currentCode: code })}
        />
        {picker ? (
          <HostPlanPicker
            mode={picker.mode}
            serverId={picker.serverId}
            currentCode={picker.currentCode}
            focus={picker.focus}
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
        <h1>Хостинг</h1>
        <div className="right" style={{ gap: '10px' }}>
          <InviteChip />
          {/* Баланс — компактной плашкой: кошелёк, сумма, «+» — пополнение. */}
          {millida ? <BalancePill /> : null}
          {view === 'list' && millida ? (
            <button className="btn sm secondary" onClick={() => setPicker({ mode: 'create', focus: 'paid' })}>
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
          // Сервер живёт в аккаунте Millida: обе дороги ведут на вход, после него
          // человек вернётся сюда и выберет тариф по-настоящему.
          <HostRoads paidId="hostLoginCta" freeId="hostLoginFree" onPaid={() => logoutToLogin()} onFree={() => logoutToLogin()} />
        ) : null}
        {view === 'error' ? (
          <div className="card hs-state" data-err={err}>
            <Icon id="i-alert" />
            <b>Серверы не загрузились</b>
            <button className="btn sm secondary" id="hostRetry" onClick={() => void load()}>
              <Icon id="i-restart" /> Повторить
            </button>
          </div>
        ) : null}
        {view === 'empty' ? (
          <HostRoads
            paidId="hostCreate"
            freeId="hostCreateFree"
            onPaid={() => setPicker({ mode: 'create', focus: 'paid' })}
            onFree={() => setPicker({ mode: 'create', focus: 'free' })}
          />
        ) : null}
        {view === 'list' ? list.map(card) : null}
      </div>

      {picker ? (
        <HostPlanPicker
          mode={picker.mode}
          serverId={picker.serverId}
          currentCode={picker.currentCode}
          focus={picker.focus}
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
