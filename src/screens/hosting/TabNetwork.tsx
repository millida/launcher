import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { ApplyField, Cap, Empty, Loading, Row } from './kit'
import { host, errText } from './api'
import type { HostingDatabaseInfo, HostingSftp, HostingSftpCredentials } from './api'
import { copyText } from '../../lib/clipboard'

export function TabNetwork({
  serverId,
  slug,
  address,
  customDomain,
  onChanged,
}: {
  serverId: string
  slug: string
  address: string
  customDomain: string | null
  onChanged: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [ports, setPorts] = useState<{ ports: { port: number; note?: string }[]; limit: number; address: string } | null>(null)
  const [db, setDb] = useState<HostingDatabaseInfo | null | undefined>(undefined)
  const [sftp, setSftp] = useState<HostingSftp | null>(null)
  const [sftpPass, setSftpPass] = useState<HostingSftpCredentials | null>(null)
  const [dns, setDns] = useState<string | null>(null)

  const load = () => {
    void host
      .ports(serverId)
      .then(setPorts)
      .catch(() => setPorts(null))
    void host
      .database(serverId)
      .then((d) => setDb(d))
      .catch(() => setDb(null))
    void host
      .sftp(serverId)
      .then(setSftp)
      .catch(() => setSftp(null))
  }
  useEffect(load, [serverId])

  const copy = async (text: string, label: string) => {
    if (await copyText(text)) showToast(label + ' скопирован')
    else showToast('Скопируй вручную: ' + text, 'error')
  }

  const changeAddress = async (next: string) => {
    const clean = next.trim().toLowerCase()
    if (!clean || clean === slug) return
    if (!(await uiConfirm('Сменить адрес на ' + clean + '.millida.host? Старый перестанет работать у всех, кто его сохранил.', { confirmLabel: 'Сменить' })))
      return
    setBusy('slug')
    try {
      await host.changeAddress(serverId, clean)
      showToast('Новый адрес: ' + clean + '.millida.host')
      onChanged()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const setDomain = async (domain: string) => {
    setBusy('domain')
    try {
      const r = await host.setDomain(serverId, domain.trim().toLowerCase())
      setDns(r?.dnsTarget || null)
      showToast(domain.trim() ? 'Домен привязан — осталось прописать запись у регистратора' : 'Домен отвязан')
      onChanged()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const addPort = async () => {
    setBusy('port')
    try {
      const r = await host.addPort(serverId)
      showToast('Порт выдан: ' + r.port)
      load()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const removePort = async (port: number) => {
    if (!(await uiConfirm('Освободить порт ' + port + '?', { confirmLabel: 'Освободить' }))) return
    try {
      await host.removePort(serverId, port)
      load()
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const createDb = async () => {
    setBusy('db')
    try {
      const info = await host.createDatabase(serverId)
      setDb(info)
      showToast('База данных создана')
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const dropDb = async () => {
    if (!(await uiConfirm('Удалить базу данных со всем содержимым?', { confirmLabel: 'Удалить' }))) return
    try {
      await host.dropDatabase(serverId)
      setDb(null)
      showToast('База удалена')
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  const issueSftp = async () => {
    setBusy('sftp')
    try {
      const creds = await host.issueSftp(serverId)
      setSftpPass(creds)
      setSftp({ active: true, host: creds.host, port: creds.port, login: creds.login, expiresAt: creds.expiresAt })
      showToast('Доступ выдан — пароль показываем один раз')
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const revokeSftp = async () => {
    try {
      await host.revokeSftp(serverId)
      setSftp({ active: false, host: null, port: 22, login: '', expiresAt: null })
      setSftpPass(null)
      showToast('Доступ отозван')
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  return (
    <>
      <div className="card set-group" style={{ padding: '10px 20px 18px' }}>
        <Cap first>Адрес сервера</Cap>
        <Row k="Как заходят игроки">
          <button className="ip-pill" onClick={() => void copy(address, 'Адрес')}>
            {address || '—'}
            <Icon id="i-copy" />
          </button>
        </Row>
        <Row k="Короткий адрес" sub="Латиница, цифры и тире — часть до .millida.host">
          <ApplyField value={slug} label="Сменить" busy={busy === 'slug'} width="200px" onApply={changeAddress} />
        </Row>
        <Row k="Свой домен" sub={dns ? 'CNAME на ' + dns : 'Например play.мойсервер.ру. Пусто — отвязать'}>
          <ApplyField
            value={customDomain || ''}
            placeholder="play.example.ru"
            label="Привязать"
            busy={busy === 'domain'}
            width="220px"
            onApply={setDomain}
          />
        </Row>
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <div className="side-cap" style={{ padding: 0, flex: 1 }}>
            Дополнительные порты {ports ? '· занято ' + ports.ports.length + ' из ' + ports.limit : ''}
          </div>
          <button className="btn sm secondary" disabled={busy === 'port'} onClick={() => void addPort()}>
            <Icon id="i-plus" /> Выдать порт
          </button>
        </div>
        {ports === null ? (
          <Empty icon="i-link" text="Дополнительные порты доступны на платных тарифах." />
        ) : ports.ports.length ? (
          <div className="stack">
            {ports.ports.map((p) => (
              <div className="fr-row" key={p.port}>
                <span className="host-ico" style={{ width: 30, height: 30 }}>
                  <Icon id="i-link" />
                </span>
                <span className="fr-body">
                  <span className="fr-nick">{ports.address + ':' + p.port}</span>
                  <span className="fr-status">{p.note || 'для плагина или голосового чата'}</span>
                </span>
                <button className="btn sm ghost" title="Копировать" onClick={() => void copy(ports.address + ':' + p.port, 'Адрес')}>
                  <Icon id="i-copy" />
                </button>
                <button className="btn sm ghost" title="Освободить" onClick={() => void removePort(p.port)}>
                  <Icon id="i-trash" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-link" text="Портов нет. Выдай, если плагину нужен свой порт — например голосовому чату." />
        )}
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <div className="side-cap" style={{ padding: 0, flex: 1 }}>
            База данных MySQL
          </div>
          {db ? (
            <button className="btn sm ghost" onClick={() => void dropDb()}>
              <Icon id="i-trash" /> Удалить
            </button>
          ) : (
            <button className="btn sm secondary" disabled={busy === 'db' || db === undefined} onClick={() => void createDb()}>
              <Icon id="i-plus" /> Создать
            </button>
          )}
        </div>
        {db === undefined ? (
          <Loading />
        ) : db ? (
          <div className="host-creds">
            {[
              ['Хост', db.host],
              ['Порт', String(db.port)],
              ['База', db.database],
              ['Логин', db.user],
              ['Пароль', db.password],
            ].map(([k, v]) => (
              <div className="host-cred-row" key={k}>
                <span className="host-cred-k">{k}</span>
                <code className="host-cred-v">{v}</code>
                <button className="btn sm ghost" title="Копировать" onClick={() => void copy(v, k)}>
                  <Icon id="i-copy" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-server" text="Базы нет. Нужна плагинам вроде LuckPerms или экономики — создаётся на платных тарифах." />
        )}
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <div className="side-cap" style={{ padding: 0, flex: 1 }}>
            SFTP-доступ к файлам
          </div>
          {sftp?.active ? (
            <button className="btn sm ghost" onClick={() => void revokeSftp()}>
              Отозвать
            </button>
          ) : null}
          <button className="btn sm secondary" style={{ marginLeft: '8px' }} disabled={busy === 'sftp'} onClick={() => void issueSftp()}>
            <Icon id="i-key" /> {sftp?.active ? 'Новый пароль' : 'Выдать доступ'}
          </button>
        </div>
        {sftp?.active ? (
          <div className="host-creds">
            {[
              ['Хост', sftp.host || '—'],
              ['Порт', String(sftp.port)],
              ['Логин', sftp.login],
              ['Пароль', sftpPass ? sftpPass.password : 'показывается один раз при выдаче'],
            ].map(([k, v]) => (
              <div className="host-cred-row" key={k}>
                <span className="host-cred-k">{k}</span>
                <code className="host-cred-v">{v}</code>
                <button className="btn sm ghost" title="Копировать" onClick={() => void copy(v, k)}>
                  <Icon id="i-copy" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-key" text="Доступ по SFTP удобен для больших сборок: файлы кидаются папкой из привычного клиента." />
        )}
      </div>
    </>
  )
}
