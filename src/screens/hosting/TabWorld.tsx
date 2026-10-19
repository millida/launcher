import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { useT } from '../../i18n'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { hasTauri } from '../../ipc/tauri'
import { hostDownload, hostUpload } from '../../ipc/commands'
import { Cap, Empty, Loading, LockBtn, Row, Toggle, gbLabel } from './kit'
import { host, errText } from './api'
import type { HostingFeatures, HostingWorld } from './api'

export function TabWorld({
  serverId,
  running,
  full,
  onTariff,
  onChanged,
}: {
  serverId: string
  running: boolean
  full: boolean
  onTariff: () => void
  onChanged: () => void
}) {
  const t = useT()
  const [worlds, setWorlds] = useState<HostingWorld[] | null>(null)
  const [features, setFeatures] = useState<HostingFeatures | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = () => {
    void host
      .worlds(serverId)
      .then((w) => setWorlds(Array.isArray(w) ? w : []))
      .catch(() => setWorlds([]))
    void host
      .features(serverId)
      .then(setFeatures)
      .catch(() => setFeatures(null))
  }
  useEffect(load, [serverId])

  const switchWorld = async (w: HostingWorld) => {
    if (!(await uiConfirm(t('Сделать «{name}» основным миром? Сервер перезапустится с ним.', { name: w.name }), { confirmLabel: t('Переключить') })))
      return
    setBusy(w.name)
    try {
      await host.switchWorld(serverId, w.name)
      showToast(t('Активный мир: {name}', { name: w.name }))
      load()
      onChanged()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const download = async () => {
    if (!hasTauri()) {
      showToast(t('Скачивание мира — в приложении'), 'error')
      return
    }
    setBusy('download')
    showToast(t('Собираем архив мира…'))
    try {
      const path = await hostDownload(serverId)
      showToast(path ? t('Мир сохранён: {path}', { path }) : t('Отменено'))
    } catch (e) {
      showToast(t('Не удалось скачать: {error}', { error: errText(e) }), 'error')
    } finally {
      setBusy(null)
    }
  }

  // Server accepts only latin letters, digits, dot, dash and underscore in world names.
  const importWorld = async () => {
    if (!hasTauri()) {
      showToast(t('Загрузка мира — в приложении'), 'error')
      return
    }
    setBusy('import')
    try {
      const path = await hostUpload(serverId, 'imports')
      if (!path) {
        showToast(t('Отменено'))
        return
      }
      showToast(t('Заливаем архив мира…'))
      const file = path.split('/').pop() || 'world.zip'
      const name = (file.replace(/\.(zip|tar|gz|tgz)$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'world').slice(0, 40)
      await host.importWorld(serverId, path, name)
      showToast(t('Мир «{name}» загружен — включи его в списке выше', { name }))
      load()
      onChanged()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const regenerate = async () => {
    if (
      !(await uiConfirm(t('Пересоздать мир? Текущий будет удалён безвозвратно — сначала скачай копию, если он нужен.'), {
        confirmLabel: t('Пересоздать'),
        danger: true,
      }))
    )
      return
    setBusy('regen')
    try {
      await host.regenerateWorld(serverId)
      showToast(t('Мир пересоздаётся — при следующем запуске будет новый'))
      load()
      onChanged()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const reinstall = async () => {
    if (
      !(await uiConfirm(t('Полный сброс сервера: мир, плагины, моды и конфиги удалятся. Тариф и адрес останутся. Продолжить?'), {
        confirmLabel: t('Сбросить всё'),
        danger: true,
      }))
    )
      return
    setBusy('reinstall')
    try {
      await host.reinstall(serverId)
      showToast(t('Сервер сбрасывается — это займёт минуту'))
      load()
      onChanged()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const toggleFeature = async (feature: 'map', on: boolean) => {
    setBusy(feature)
    try {
      if (on) {
        const r = await host.enableFeature(serverId, feature)
        showToast(r.note || t('Включено'))
      } else {
        await host.disableFeature(serverId, feature)
        showToast(t('Выключено'))
      }
      load()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="card" style={{ padding: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
          <div className="side-cap" style={{ padding: 0, flex: 1 }}>
            {t('Миры сервера')}
          </div>
          {full ? (
            <button className="btn sm secondary" disabled={busy === 'import'} onClick={() => void importWorld()}>
              <Icon id="i-upload" /> {t('Загрузить свой')}
            </button>
          ) : (
            <LockBtn label={t('Загрузить свой')} feature={t('Загрузка своего мира')} onTariff={onTariff} />
          )}
          <button className="btn sm secondary" style={{ marginLeft: '8px' }} disabled={busy === 'download'} onClick={() => void download()}>
            <Icon id="i-download" /> {t('Скачать мир')}
          </button>
        </div>
        {worlds === null ? (
          <Loading />
        ) : worlds.length ? (
          <div className="stack">
            {worlds.map((w) => (
              <div className="fr-row" key={w.name}>
                <span className="host-ico" style={{ width: 34, height: 34 }}>
                  <Icon id="i-grid" />
                </span>
                <span className="fr-body">
                  <span className="fr-nick">{w.name}</span>
                  <span className="fr-status">
                    {w.sizeMb ? t('{n} ГБ', { n: gbLabel(w.sizeMb) }) : t('пусто')}
                    {w.dimension ? ' · ' + t('измерение') : ''}
                  </span>
                </span>
                {w.active ? (
                  <span className="pill acc">
                    <span className="dot"></span> {t('Активен')}
                  </span>
                ) : (
                  <button className="btn sm secondary" disabled={busy === w.name} onClick={() => void switchWorld(w)}>
                    {t('Сделать основным')}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-grid" text={t('Миров пока нет')} />
        )}
      </div>

      {features ? (
        <div className="card set-group" style={{ padding: '10px 20px 18px', marginTop: '14px' }}>
          <Cap first>{t('Как заходят игроки')}</Cap>
          <Row k={t('Онлайн-карта мира')} sub={features.map.url || undefined}>
            <Toggle
              on={features.map.enabled}
              busy={busy === 'map' || !features.compatible}
              onChange={(v) => void toggleFeature('map', v)}
            />
          </Row>
          {!features.compatible ? (
            <p className="faint-note" style={{ marginTop: '10px' }}>
              {t('Нужно ядро Paper, Purpur или Spigot')}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div className="side-cap" style={{ padding: '0 2px 10px' }}>
          {t('Начать заново')}
        </div>
        <div className="host-danger-row">
          <div>
            <div className="host-danger-k">{t('Пересоздать мир')}</div>
            <div className="host-danger-sub">{t('Моды и настройки останутся')}</div>
          </div>
          <button className="btn sm secondary" disabled={busy === 'regen'} onClick={() => void regenerate()}>
            {t('Пересоздать')}
          </button>
        </div>
        <div className="host-danger-row">
          <div>
            <div className="host-danger-k">{t('Сбросить сервер')}</div>
            <div className="host-danger-sub">{t('Удалит мир, моды и настройки')}</div>
          </div>
          <button className="btn sm danger" disabled={busy === 'reinstall'} onClick={() => void reinstall()}>
            {t('Сбросить')}
          </button>
        </div>
        {running ? (
          <p className="faint-note" style={{ marginTop: '10px' }}>
            {t('Сначала останови сервер')}
          </p>
        ) : null}
      </div>
    </>
  )
}
