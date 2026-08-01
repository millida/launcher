import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { hasTauri } from '../../ipc/tauri'
import { hostDownload, hostUpload } from '../../ipc/commands'
import { Cap, Empty, Loading, Row, Toggle, gbLabel } from './kit'
import { host, errText } from './api'
import type { HostingFeatures, HostingWorld } from './api'

export function TabWorld({
  serverId,
  running,
  onChanged,
}: {
  serverId: string
  running: boolean
  onChanged: () => void
}) {
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
    if (!(await uiConfirm('Сделать «' + w.name + '» основным миром? Сервер перезапустится с ним.', { confirmLabel: 'Переключить' })))
      return
    setBusy(w.name)
    try {
      await host.switchWorld(serverId, w.name)
      showToast('Активный мир: ' + w.name)
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
      showToast('Скачивание мира — в приложении', 'error')
      return
    }
    setBusy('download')
    showToast('Собираем архив мира…')
    try {
      const path = await hostDownload(serverId)
      showToast(path ? 'Мир сохранён: ' + path : 'Отменено')
    } catch (e) {
      showToast('Не удалось скачать: ' + errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  // Server accepts only latin letters, digits, dot, dash and underscore in world names.
  const importWorld = async () => {
    if (!hasTauri()) {
      showToast('Загрузка мира — в приложении', 'error')
      return
    }
    setBusy('import')
    showToast('Заливаем архив мира…')
    try {
      const path = await hostUpload(serverId, 'imports')
      if (!path) return
      const file = path.split('/').pop() || 'world.zip'
      const name = (file.replace(/\.(zip|tar|gz|tgz)$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'world').slice(0, 40)
      await host.importWorld(serverId, path, name)
      showToast('Мир «' + name + '» загружен — включи его в списке выше')
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
      !(await uiConfirm('Пересоздать мир? Текущий будет удалён безвозвратно — сначала скачай копию, если он нужен.', {
        confirmLabel: 'Пересоздать',
        danger: true,
      }))
    )
      return
    setBusy('regen')
    try {
      await host.regenerateWorld(serverId)
      showToast('Мир пересоздаётся — при следующем запуске будет новый')
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
      !(await uiConfirm('Полный сброс сервера: мир, плагины, моды и конфиги удалятся. Тариф и адрес останутся. Продолжить?', {
        confirmLabel: 'Сбросить всё',
        danger: true,
      }))
    )
      return
    setBusy('reinstall')
    try {
      await host.reinstall(serverId)
      showToast('Сервер сбрасывается — это займёт минуту')
      load()
      onChanged()
    } catch (e) {
      showToast(errText(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const toggleFeature = async (feature: 'bedrock' | 'map', on: boolean) => {
    setBusy(feature)
    try {
      if (on) {
        const r = await host.enableFeature(serverId, feature)
        showToast(r.note || 'Включено')
      } else {
        await host.disableFeature(serverId, feature)
        showToast('Выключено')
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
            Миры сервера
          </div>
          <button className="btn sm secondary" disabled={busy === 'import'} onClick={() => void importWorld()}>
            <Icon id="i-upload" /> Загрузить свой
          </button>
          <button className="btn sm secondary" style={{ marginLeft: '8px' }} disabled={busy === 'download'} onClick={() => void download()}>
            <Icon id="i-download" /> Скачать мир
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
                    {w.sizeMb ? gbLabel(w.sizeMb) + ' ГБ' : 'пусто'}
                    {w.dimension ? ' · измерение' : ''}
                  </span>
                </span>
                {w.active ? (
                  <span className="pill acc">
                    <span className="dot"></span> Активен
                  </span>
                ) : (
                  <button className="btn sm secondary" disabled={busy === w.name} onClick={() => void switchWorld(w)}>
                    Сделать основным
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon="i-grid" text="Миров пока нет — они появятся после первого запуска сервера." />
        )}
      </div>

      {features ? (
        <div className="card set-group" style={{ padding: '10px 20px 18px', marginTop: '14px' }}>
          <Cap first>Как заходят игроки</Cap>
          <Row k="Вход с телефонов и консолей" sub={features.bedrock.address ? 'Адрес: ' + features.bedrock.address : 'Bedrock-издание через Geyser'}>
            <Toggle
              on={features.bedrock.enabled}
              busy={busy === 'bedrock' || !features.compatible}
              onChange={(v) => void toggleFeature('bedrock', v)}
            />
          </Row>
          <Row k="Онлайн-карта мира" sub={features.map.url ? features.map.url : 'Карта сервера в браузере'}>
            <Toggle
              on={features.map.enabled}
              busy={busy === 'map' || !features.compatible}
              onChange={(v) => void toggleFeature('map', v)}
            />
          </Row>
          {!features.compatible ? (
            <p className="faint-note" style={{ marginTop: '10px' }}>
              Ядро {features.core} это не поддерживает — нужно Paper, Purpur или Spigot.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card" style={{ padding: '18px', marginTop: '14px' }}>
        <div className="side-cap" style={{ padding: '0 2px 10px' }}>
          Начать заново
        </div>
        <div className="host-danger-row">
          <div>
            <div className="host-danger-k">Пересоздать мир</div>
            <div className="host-danger-sub">Новый мир с новым сидом. Плагины, моды и настройки остаются.</div>
          </div>
          <button className="btn sm secondary" disabled={busy === 'regen'} onClick={() => void regenerate()}>
            Пересоздать
          </button>
        </div>
        <div className="host-danger-row">
          <div>
            <div className="host-danger-k">Полный сброс сервера</div>
            <div className="host-danger-sub">Чистая установка: мир, плагины, моды и конфиги удаляются.</div>
          </div>
          <button className="btn sm danger" disabled={busy === 'reinstall'} onClick={() => void reinstall()}>
            Сбросить
          </button>
        </div>
        {running ? (
          <p className="faint-note" style={{ marginTop: '10px' }}>
            Сервер работает — перед сбросом его лучше остановить.
          </p>
        ) : null}
      </div>
    </>
  )
}
