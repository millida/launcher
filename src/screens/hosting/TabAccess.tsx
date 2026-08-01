import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { Empty, Loading } from './kit'
import { HOST_PERMISSIONS, NOTIFY_CHANNELS, NOTIFY_EVENTS, host, errText } from './api'
import type { HostingApiKey, HostingShare } from './api'
import { copyText } from '../../lib/clipboard'

export function TabAccess({ serverId }: { serverId: string }) {
  const [shares, setShares] = useState<HostingShare[] | null>(null)
  const [keys, setKeys] = useState<HostingApiKey[] | null>(null)
  const [prefs, setPrefs] = useState<Record<string, string[]> | null>(null)
  const [email, setEmail] = useState('')
  const [perms, setPerms] = useState<string[]>(['control', 'console'])
  const [keyName, setKeyName] = useState('')
  const [freshKey, setFreshKey] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void host
      .shares(serverId)
      .then((r) => setShares(Array.isArray(r) ? r : []))
      .catch(() => setShares([]))
    void host
      .apiKeys(serverId)
      .then((r) => setKeys(Array.isArray(r) ? r : []))
      .catch(() => setKeys([]))
    void host
      .notifyPrefs(serverId)
      .then((r) => setPrefs(r?.events || {}))
      .catch(() => setPrefs({}))
  }, [serverId])

  const togglePerm = (p: string) => setPerms((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]))

  const addShare = async () => {
    if (!email.trim()) return
    setBusy('share')
    try {
      const list = await host.addShare(serverId, email.trim(), perms)
      setShares(Array.isArray(list) ? list : shares)
      setEmail('')
      showToast('Доступ выдан')
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const removeShare = async (s: HostingShare) => {
    if (!(await uiConfirm('Забрать доступ у ' + (s.nickname || s.email || 'участника') + '?', { confirmLabel: 'Забрать' }))) return
    try {
      const list = await host.removeShare(serverId, s.userId)
      setShares(Array.isArray(list) ? list : (shares || []).filter((x) => x.userId !== s.userId))
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const toggleSharePerm = async (s: HostingShare, perm: string) => {
    const next = s.permissions.includes(perm) ? s.permissions.filter((p) => p !== perm) : [...s.permissions, perm]
    try {
      const list = await host.updateShare(serverId, s.userId, next)
      setShares(Array.isArray(list) ? list : shares)
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const createKey = async () => {
    if (!keyName.trim()) return
    setBusy('key')
    try {
      const r = await host.createApiKey(serverId, keyName.trim(), perms)
      setFreshKey(r.token)
      setKeyName('')
      const list = await host.apiKeys(serverId)
      setKeys(Array.isArray(list) ? list : keys)
      showToast('Ключ создан — он показывается один раз')
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const revokeKey = async (k: HostingApiKey) => {
    if (!(await uiConfirm('Отозвать ключ «' + k.name + '»?', { confirmLabel: 'Отозвать' }))) return
    try {
      await host.revokeApiKey(serverId, k.id)
      setKeys((list) => (list || []).filter((x) => x.id !== k.id))
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const toggleNotify = async (event: string, channel: string) => {
    if (!prefs) return
    const current = prefs[event] || []
    const next = current.includes(channel) ? current.filter((c) => c !== channel) : [...current, channel]
    const events = { ...prefs, [event]: next }
    setPrefs(events)
    try {
      await host.setNotifyPrefs(serverId, events)
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  return (
    <>
      <div className="card" style={{ padding: '18px' }}>
        <div className="side-cap" style={{ padding: '0 2px 10px' }}>
          Кому открыт сервер
        </div>
        <div className="host-ask">
          <div className="input sm" style={{ flex: 1 }}>
            <input
              placeholder="Почта аккаунта Millida"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addShare()}
            />
          </div>
          <button className="btn sm primary" disabled={busy === 'share' || !email.trim()} onClick={() => void addShare()}>
            Дать доступ
          </button>
        </div>
        <div className="host-perms">
          {HOST_PERMISSIONS.map(([p, label]) => (
            <button key={p} className={'host-perm' + (perms.includes(p) ? ' on' : '')} onClick={() => togglePerm(p)}>
              {perms.includes(p) ? <Icon id="i-check" /> : null}
              {label}
            </button>
          ))}
        </div>

        {shares === null ? (
          <Loading />
        ) : shares.length ? (
          <div className="stack" style={{ marginTop: '12px' }}>
            {shares.map((s) => (
              <div className="host-share" key={s.userId}>
                <div className="fr-row" style={{ padding: 0 }}>
                  <span className="host-ico" style={{ width: 30, height: 30 }}>
                    <Icon id="i-user" />
                  </span>
                  <span className="fr-body">
                    <span className="fr-nick">{s.nickname || s.email || 'участник'}</span>
                    <span className="fr-status">{s.email || ''}</span>
                  </span>
                  <button className="btn sm ghost" title="Забрать доступ" onClick={() => void removeShare(s)}>
                    <Icon id="i-trash" />
                  </button>
                </div>
                <div className="host-perms">
                  {HOST_PERMISSIONS.map(([p, label]) => (
                    <button
                      key={p}
                      className={'host-perm' + (s.permissions.includes(p) ? ' on' : '')}
                      onClick={() => void toggleSharePerm(s, p)}
                    >
                      {s.permissions.includes(p) ? <Icon id="i-check" /> : null}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-users" text="Пока только ты. Дай доступ другу — сможет запускать сервер и держать консоль." />
        )}
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div className="side-cap" style={{ padding: '0 2px 10px' }}>
          Ключи для ботов и скриптов
        </div>
        <div className="host-ask">
          <div className="input sm" style={{ flex: 1 }}>
            <input
              placeholder="Название ключа — например «бот Discord»"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void createKey()}
            />
          </div>
          <button className="btn sm secondary" disabled={busy === 'key' || !keyName.trim()} onClick={() => void createKey()}>
            <Icon id="i-key" /> Создать
          </button>
        </div>
        {freshKey ? (
          <div className="host-cred-row" style={{ marginTop: '10px' }}>
            <span className="host-cred-k">Ключ</span>
            <code className="host-cred-v">{freshKey}</code>
            <button
              className="btn sm ghost"
              title="Копировать"
              onClick={() => void copyText(freshKey).then((ok) => showToast(ok ? 'Ключ скопирован' : 'Не удалось скопировать ключ'))}
            >
              <Icon id="i-copy" />
            </button>
          </div>
        ) : null}
        {keys === null ? (
          <Loading />
        ) : keys.length ? (
          <div className="stack" style={{ marginTop: '10px' }}>
            {keys.map((k) => (
              <div className="fr-row" key={k.id}>
                <span className="host-ico" style={{ width: 30, height: 30 }}>
                  <Icon id="i-key" />
                </span>
                <span className="fr-body">
                  <span className="fr-nick">{k.name}</span>
                  <span className="fr-status">
                    {k.prefix}… · {k.lastUsedAt ? 'использован ' + new Date(k.lastUsedAt).toLocaleDateString('ru-RU') : 'ещё не использован'}
                  </span>
                </span>
                <button className="btn sm ghost" title="Отозвать" onClick={() => void revokeKey(k)}>
                  <Icon id="i-trash" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-key" text="Ключей нет. Нужны, если сервером управляет свой бот." />
        )}
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div className="side-cap" style={{ padding: '0 2px 10px' }}>
          О чём предупреждать
        </div>
        {prefs === null ? (
          <Loading />
        ) : (
          <div className="host-notify">
            {NOTIFY_EVENTS.map(([ev, label]) => (
              <div className="host-notify-row" key={ev}>
                <span className="host-notify-k">{label}</span>
                <div className="host-perms">
                  {NOTIFY_CHANNELS.map(([ch, chLabel]) => {
                    const on = (prefs[ev] || []).includes(ch)
                    return (
                      <button key={ch} className={'host-perm' + (on ? ' on' : '')} onClick={() => void toggleNotify(ev, ch)}>
                        {on ? <Icon id="i-check" /> : null}
                        {chLabel}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
