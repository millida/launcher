import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { useT } from '../../i18n'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { ApplyField, Cap, Empty, Loading, LockBtn, Row } from './kit'
import { host, errText } from './api'
import type { HostingDatabaseInfo, HostingSftp, HostingSftpCredentials } from './api'
import { copyText } from '../../lib/clipboard'

export function TabNetwork({
  serverId,
  slug,
  address,
  customDomain,
  full = true,
  onTariff,
  onChanged,
}: {
  serverId: string
  slug: string
  address: string
  customDomain: string | null
  /// Бесплатный тариф: порты, база и SFTP закрыты — вместо кнопки, которая
  /// кончается ошибкой, стоит кнопка с замком, объясняющая себя.
  full?: boolean
  onTariff?: () => void
  onChanged: () => void
}) {
  const t = useT()
  const locked = !full && !!onTariff
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
    if (await copyText(text)) showToast(t('{label} скопирован', { label }))
    else showToast(t('Скопируй вручную: {text}', { text }), 'error')
  }

  const changeAddress = async (next: string) => {
    const clean = next.trim().toLowerCase()
    if (!clean || clean === slug) return
    if (!(await uiConfirm(t('Сменить адрес на {address}? Старый перестанет работать у всех, кто его сохранил.', { address: clean + '.millida.host' }), { confirmLabel: t('Сменить') })))
      return
    setBusy('slug')
    try {
      await host.changeAddress(serverId, clean)
      showToast(t('Новый адрес: {address}', { address: clean + '.millida.host' }))
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
      showToast(domain.trim() ? t('Домен привязан — осталось прописать запись у регистратора') : t('Домен отвязан'))
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
      showToast(t('Порт выдан: {port}', { port: r.port }))
      load()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const removePort = async (port: number) => {
    if (!(await uiConfirm(t('Освободить порт {port}?', { port }), { confirmLabel: t('Освободить') }))) return
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
      showToast(t('База данных создана'))
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const dropDb = async () => {
    if (!(await uiConfirm(t('Удалить базу данных со всем содержимым?'), { confirmLabel: t('Удалить') }))) return
    try {
      await host.dropDatabase(serverId)
      setDb(null)
      showToast(t('База удалена'))
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
      showToast(t('Доступ выдан — пароль показываем один раз'))
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
      showToast(t('Доступ отозван'))
    } catch (e) {
      showToast(errText(e), 'error')
    }
  }

  return (
    <>
      <div className="card set-group" style={{ padding: '10px 20px 18px' }}>
        <Cap first>{t('Адрес сервера')}</Cap>
        <Row k={t('Как заходят игроки')}>
          <button className="ip-pill" onClick={() => void copy(address, t('Адрес'))}>
            {address || '—'}
            <Icon id="i-copy" />
          </button>
        </Row>
        <Row k={t('Короткий адрес')} sub={t('Латиница, цифры и тире')}>
          <ApplyField value={slug} label={t('Сменить')} busy={busy === 'slug'} width="260px" suffix=".millida.host" onApply={changeAddress} />
        </Row>
        <Row k={t('Свой домен')} sub={dns ? t('CNAME на {target}', { target: dns }) : t('Пусто — отвязать')}>
          <ApplyField
            value={customDomain || ''}
            placeholder="play.example.ru"
            label={t('Привязать')}
            busy={busy === 'domain'}
            width="220px"
            onApply={setDomain}
          />
        </Row>
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <div className="side-cap" style={{ padding: 0, flex: 1 }}>
            {ports ? t('Дополнительные порты · занято {used} из {limit}', { used: ports.ports.length, limit: ports.limit }) : t('Дополнительные порты')}
          </div>
          {locked ? (
            <LockBtn label={t('Выдать порт')} feature={t('Дополнительные порты')} onTariff={onTariff!} />
          ) : (
            <button className="btn sm secondary" disabled={busy === 'port'} onClick={() => void addPort()}>
              <Icon id="i-plus" /> {t('Выдать порт')}
            </button>
          )}
        </div>
        {ports === null ? (
          <Empty icon="i-lock" text={t('Только на платном тарифе')} />
        ) : ports.ports.length ? (
          <div className="stack">
            {ports.ports.map((p) => (
              <div className="fr-row" key={p.port}>
                <span className="host-ico" style={{ width: 30, height: 30 }}>
                  <Icon id="i-link" />
                </span>
                <span className="fr-body">
                  <span className="fr-nick">{ports.address + ':' + p.port}</span>
                  {p.note ? <span className="fr-status">{p.note}</span> : null}
                </span>
                <button className="btn sm ghost" aria-label={t('Копировать')} data-tip={t('Копировать')} onClick={() => void copy(ports.address + ':' + p.port, t('Адрес'))}>
                  <Icon id="i-copy" />
                </button>
                <button className="btn sm ghost" aria-label={t('Освободить порт')} data-tip={t('Освободить порт')} onClick={() => void removePort(p.port)}>
                  <Icon id="i-trash" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-link" text={t('Портов нет')} />
        )}
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <div className="side-cap" style={{ padding: 0, flex: 1 }}>
            {t('База данных MySQL')}
          </div>
          {db ? (
            <button className="btn sm ghost" onClick={() => void dropDb()}>
              <Icon id="i-trash" /> {t('Удалить')}
            </button>
          ) : locked ? (
            <LockBtn label={t('Создать')} feature={t('База данных')} onTariff={onTariff!} />
          ) : (
            <button className="btn sm secondary" disabled={busy === 'db' || db === undefined} onClick={() => void createDb()}>
              <Icon id="i-plus" /> {t('Создать')}
            </button>
          )}
        </div>
        {db === undefined ? (
          <Loading />
        ) : db ? (
          <div className="host-creds">
            {[
              [t('Хост'), db.host],
              [t('Порт'), String(db.port)],
              [t('База'), db.database],
              [t('Логин'), db.user],
              [t('Пароль'), db.password],
            ].map(([k, v]) => (
              <div className="host-cred-row" key={k}>
                <span className="host-cred-k">{k}</span>
                <code className="host-cred-v">{v}</code>
                <button className="btn sm ghost" aria-label={t('Копировать')} data-tip={t('Копировать')} onClick={() => void copy(v, k)}>
                  <Icon id="i-copy" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-server" text={t('Базы нет')} />
        )}
      </div>

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <div className="side-cap" style={{ padding: 0, flex: 1 }}>
            {t('SFTP-доступ к файлам')}
          </div>
          {sftp?.active ? (
            <button className="btn sm ghost" onClick={() => void revokeSftp()}>
              {t('Отозвать')}
            </button>
          ) : null}
          {locked && !sftp?.active ? (
            <LockBtn label={t('Выдать доступ')} feature="SFTP" onTariff={onTariff!} />
          ) : (
            <button className="btn sm secondary" style={{ marginLeft: '8px' }} disabled={busy === 'sftp'} onClick={() => void issueSftp()}>
              <Icon id="i-key" /> {sftp?.active ? t('Новый пароль') : t('Выдать доступ')}
            </button>
          )}
        </div>
        {sftp?.active ? (
          <div className="host-creds">
            {[
              [t('Хост'), sftp.host || '—'],
              [t('Порт'), String(sftp.port)],
              [t('Логин'), sftp.login],
              // Пароль показывается один раз при выдаче; потом — только «Новый пароль».
              [t('Пароль'), sftpPass ? sftpPass.password : ''],
            ].map(([k, v]) => (
              <div className="host-cred-row" key={k}>
                <span className="host-cred-k">{k}</span>
                <code className="host-cred-v">{v || '••••••'}</code>
                {v ? (
                  <button className="btn sm ghost" aria-label={t('Копировать')} data-tip={t('Копировать')} onClick={() => void copy(v, k)}>
                    <Icon id="i-copy" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-key" text={t('Доступ не выдан')} />
        )}
      </div>
    </>
  )
}
