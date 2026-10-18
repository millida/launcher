import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../Icon'
import { HostPlanPicker } from '../HostPlanPicker'
import { ServerIcon, StatusBadge, buildLabel } from '../hosting/HostKit'
import { api, hasMillidaAccount } from '../../lib/api'
import { backdropClose } from '../../lib/dismiss'
import { logoutToLogin } from '../../lib/session'
import { setScreen, showToast } from '../../state/ui'
import { track } from '../../lib/telemetry'
import { errText, host, P } from '../../screens/hosting/api'
import type { HostServer } from '../../screens/Hosting'
import type { HostingPack } from './data'
import '../../styles/pixel/playhub.css'
import { useT } from '../../i18n'

/**
 * «На сервер» — одно окно на весь лаунчер (приказ владельца 23.09.2026 и
 * 24.09.2026, 18:35): страница сборки, строки «Ресурсов» и вкладка контента
 * панели сервера ставят через него.
 *
 * - нет сервера — «Создать сервер» с пометкой, что поставим потом;
 * - один сервер — сразу «Поставить X на <сервер>?»;
 * - несколько — выбор сервера (неподходящие — с причиной, выбрать нельзя).
 *
 * Пути установки — те же, что у сайта и панели хостинга:
 * - материал каталога Millida (`catalog`: раздел + адрес) — `GET
 *   /hosting/servers/compatible` решает, какие серверы подходят, `POST
 *   /hosting/servers/:id/install-catalog` ставит (файл под ядро и версию
 *   подбирает бэкенд; как `hosting-catalog-install.tsx` сайта);
 * - Modrinth / CurseForge по номеру проекта — `POST /installs`;
 * - наша сборка хостинга — `POST /installs/partner` по ключу (GET /hosting/packs).
 * Сборка и карта заменяют мир — сервер останавливаем, мир уходит в копию.
 */
export type HostTarget =
  | { kind: 'modrinth'; projectId: string; title: string }
  | { kind: 'partner'; pack: HostingPack; title: string }
  | { kind: 'catalog'; section: string; slug: string; title: string }
  | { kind: 'curseforge'; projectId: string; title: string; map?: boolean }

type Step = 'pick' | 'stop' | 'run' | 'done'

const RUNNING = ['RUNNING', 'STARTING']
const LIVE = ['RUNNING', 'STARTING', 'STOPPING']

/** Ответ `/hosting/servers/compatible` — как `CatalogCompatibleResult` сайта. */
interface Compat {
  item: { title: string; kind: string; replacesWorld: boolean; changesCore: boolean }
  servers: {
    id: string
    name: string
    address: string
    coreLabel: string
    version: string
    status: string
    online: boolean
    compatible: boolean
    reason: string | null
    fileVersion: string | null
  }[]
}

/** Сервер в списке окна: общий вид для обоих ответов. */
interface Row {
  id: string
  name: string
  sub: string
  status: string
  icon?: string
  ok: boolean
  reason: string | null
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function HostInstall({
  target,
  serverId,
  onClose,
  onDone,
}: {
  target: HostTarget
  /** Панель сервера: ставим на этот сервер, без выбора. */
  serverId?: string
  onClose: () => void
  /** Установка принята — панель обновляет список «Сейчас на сервере». */
  onDone?: () => void
}) {
  const t = useT()
  const signed = hasMillidaAccount()
  const [list, setList] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [step, setStep] = useState<Step>('pick')
  const [error, setError] = useState('')
  const [picker, setPicker] = useState(false)
  // Материал меняет мир (карта, сборка): ответ `compatible` или 409 confirm_replace.
  const [replaces, setReplaces] = useState(target.kind === 'partner' || (target.kind === 'curseforge' && !!target.map))
  const alive = useRef(true)
  useEffect(
    () => () => {
      alive.current = false
    },
    [],
  )
  const needCode = target.kind === 'partner' && target.pack.requireKey

  const load = () => {
    if (!signed) return
    setFailed(false)
    const ask: Promise<Row[]> =
      target.kind === 'catalog'
        ? api<Compat>('/hosting/servers/compatible?' + new URLSearchParams({ section: target.section, slug: target.slug }).toString()).then(
            (r) => {
              if (r && r.item && r.item.replacesWorld) setReplaces(true)
              return (r && Array.isArray(r.servers) ? r.servers : []).map((s) => ({
                id: s.id,
                name: s.name,
                sub: [s.address, s.coreLabel + ' ' + s.version, s.compatible && s.fileVersion ? t('встанет {version}', { version: s.fileVersion }) : '']
                  .filter(Boolean)
                  .join(' · '),
                status: s.status,
                ok: s.compatible,
                reason: s.compatible ? null : s.reason,
              }))
            },
          )
        : api<HostServer[]>('/hosting/servers/me').then((l) =>
            (Array.isArray(l) ? l : []).map((s) => ({
              id: s.id,
              name: s.name || s.slug || t('Мой сервер'),
              sub: [s.address, buildLabel(s)].filter((x) => x && x !== '—').join(' · '),
              status: s.status || '',
              icon: s.icon,
              ok: true,
              reason: null,
            })),
          )
    ask
      .then((arr) => {
        const rows = serverId ? arr.filter((s) => s.id === serverId) : arr
        setList(rows)
        const fit = rows.filter((s) => s.ok)
        setSel((cur) => cur || (fit.length === 1 || serverId ? (fit[0] || rows[0])?.id || null : null))
      })
      .catch(() => setFailed(true))
  }
  useEffect(load, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && step === 'pick' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [step])

  const server = (list || []).find((s) => s.id === sel) || null
  const single = !!list && list.length === 1

  /** Мир не заменить на работающем сервере: останавливаем и ждём, пока встанет. */
  const stopFirst = async (id: string, status: string) => {
    if (!LIVE.includes(status)) return
    setStep('stop')
    await api(P(id) + '/stop', { method: 'POST' })
    for (let i = 0; i < 30; i++) {
      await wait(2000)
      const fresh = await api<HostServer>(P(id)).catch(() => null)
      if (!fresh || !LIVE.includes(fresh.status || '')) break
    }
  }

  const run = async () => {
    if (!server || !server.ok) return
    setError('')
    setStep('run')
    try {
      if (target.kind === 'modrinth') {
        await host.install(server.id, { projectId: target.projectId, source: 'modrinth' })
      } else if (target.kind === 'curseforge') {
        if (target.map) await stopFirst(server.id, server.status)
        setStep('run')
        await host.install(server.id, { projectId: target.projectId, source: 'curseforge' })
      } else if (target.kind === 'catalog') {
        if (replaces) await stopFirst(server.id, server.status)
        setStep('run')
        await api(P(server.id) + '/install-catalog', {
          method: 'POST',
          body: JSON.stringify({ section: target.section, slug: target.slug, ...(replaces ? { replaceWorld: true } : {}) }),
        })
      } else {
        // Партнёрскую сборку бэкенд не ставит на работающий сервер: она
        // заменяет мир и файлы. Останавливаем сами, мир уходит в копию.
        if (RUNNING.includes(server.status)) await api(P(server.id) + '/stop', { method: 'POST' })
        await api(P(server.id) + '/installs/partner', {
          method: 'POST',
          body: JSON.stringify({ packKey: target.pack.key, backup: true, ...(needCode ? { code: code.trim() } : {}) }),
        })
      }
      if (!alive.current) return
      track('hosting_action', { action: 'install', kind: target.kind, section: target.kind === 'catalog' ? target.section : '' })
      onDone?.()
      // Панель сервера: хватит тоста — список «Сейчас на сервере» уже обновился.
      if (serverId) {
        showToast(replaces ? t('«{name}» заменит мир — ставим', { name: target.title }) : t('«{name}» встанет при запуске сервера', { name: target.title }), 'ok')
        onClose()
        return
      }
      setStep('done')
    } catch (e) {
      if (!alive.current) return
      // Бэкенд просит подтвердить замену мира — показываем предупреждение и
      // даём нажать ещё раз, уже с заменой.
      if (/confirm_replace|заменит мир|http 409/i.test(String(e)) && !replaces) {
        setReplaces(true)
        setStep('pick')
        return
      }
      setError(errText(e))
      setStep('pick')
    }
  }

  const openServer = () => {
    onClose()
    setScreen('hosting')
  }

  const busy = step === 'run' || step === 'stop'
  const heading =
    step === 'done' ? t('Готово') : single && server ? t('Поставить на «{name}»?', { name: server.name }) : t('Куда поставить?')

  let body
  if (!signed)
    body = (
      <div className="hi-empty">
        <Icon id="i-server" />
        <b>{t('Серверы привязаны к аккаунту Millida')}</b>
        <button className="btn md primary" data-track="login" onClick={() => logoutToLogin()}>
          <Icon id="i-login" /> {t('Войти')}
        </button>
      </div>
    )
  else if (step === 'done')
    body = (
      <div className="hi-empty">
        <Icon id="i-check" />
        <b>{t('Ставим на «{name}»', { name: server?.name || t('сервер') })}</b>
        <span className="sub">{replaces ? t('Прежний мир сохранён копией') : t('Встанет при запуске сервера')}</span>
        <div className="hi-acts">
          <button className="btn md secondary" data-track="close" onClick={onClose}>
            {t('Готово')}
          </button>
          {serverId ? null : (
            <button className="btn md primary" data-track="open_server" onClick={openServer}>
              <Icon id="i-server" /> {t('Открыть сервер')}
            </button>
          )}
        </div>
      </div>
    )
  else if (list && !list.length && !failed)
    // Серверов нет: создаём, а что ставить — помним (правка 24.09.2026, 18:35).
    body = (
      <div className="hi-empty">
        <Icon id="i-server" />
        <b>{t('Своего сервера пока нет')}</b>
        <span className="sub">{t('Создадим — и поставим')}</span>
        <button className="btn md primary" data-track="server_create" onClick={() => setPicker(true)}>
          <Icon id="i-plus" /> {t('Создать сервер')}
        </button>
      </div>
    )
  else
    body = (
      <>
        <div className="hi-list" data-private>
          {list === null && !failed ? [0, 1].map((i) => <span key={i} className="skel hi-skel"></span>) : null}
          {failed ? (
            <div className="hi-note">
              {t('Хостинг не ответил')}
              <button className="btn sm secondary" data-track="retry" onClick={load}>
                <Icon id="i-restart" /> {t('Повторить')}
              </button>
            </div>
          ) : null}
          {(list || []).map((s) => (
            <button
              key={s.id}
              className={'hi-srv' + (sel === s.id ? ' on' : '') + (s.ok ? '' : ' off')}
              aria-pressed={sel === s.id}
              disabled={!s.ok || busy}
              data-track="host_pick"
              data-kind="own_server"
              data-id={s.id}
              onClick={() => setSel(s.id)}
            >
              <ServerIcon icon={s.icon} size={36} />
              <span className="hi-srv-main">
                <b>{s.name}</b>
                <span>{s.reason || s.sub}</span>
              </span>
              <StatusBadge status={s.status} />
            </button>
          ))}
          {list && !serverId ? (
            <button className="hi-srv new" data-track="server_create" disabled={busy} onClick={() => setPicker(true)}>
              <span className="hi-plus">
                <Icon id="i-plus" />
              </span>
              <span className="hi-srv-main">
                <b>{t('Новый сервер')}</b>
              </span>
            </button>
          ) : null}
        </div>
        {needCode ? (
          <input
            className="input hi-code"
            value={code}
            spellCheck={false}
            placeholder={t('Код активации сборки')}
            onChange={(e) => setCode(e.target.value)}
          />
        ) : null}
        {replaces && server && server.ok ? <span className="hi-warn">{t('Мир сервера заменится, прежний уйдёт в копию')}</span> : null}
        {error ? <span className="hi-err">{error}</span> : null}
        <div className="hi-acts">
          <button className="btn md secondary" data-track="cancel" disabled={busy} onClick={onClose}>
            {t('Отмена')}
          </button>
          <button
            className="btn md primary"
            disabled={!server || !server.ok || busy || (needCode && code.trim().length < 4)}
            data-track="host_install_run"
            onClick={() => void run()}
          >
            {busy ? <span className="spin" /> : <Icon id="i-download" />}{' '}
            {step === 'stop' ? t('Останавливаем…') : step === 'run' ? t('Ставим…') : replaces ? t('Заменить мир') : t('Поставить')}
          </button>
        </div>
      </>
    )

  return createPortal(
    <>
      <div className="modal-bg open vis" {...backdropClose(() => !busy && onClose())}>
        <div className="modal mw-sm hi">
          <h3>{heading}</h3>
          <span className="sub">{target.title}</span>
          {body}
        </div>
      </div>
      {picker ? (
        <HostPlanPicker
          mode="create"
          then={target.title}
          onClose={() => setPicker(false)}
          onOpenServer={(id) => {
            setSel(id)
            setPicker(false)
            load()
          }}
          onDone={() => setTimeout(load, 1500)}
        />
      ) : null}
    </>,
    document.body,
  )
}
