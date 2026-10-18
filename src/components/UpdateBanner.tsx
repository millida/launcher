import { Icon } from './Icon'
import { useUpdate } from '../state/update'
import { applyUpdate } from '../lib/updater'
import { useT } from '../i18n'

export function UpdateBanner() {
  const t = useT()
  const version = useUpdate((s) => s.version)
  const staged = useUpdate((s) => s.staged)
  const busy = useUpdate((s) => s.busy)
  const failed = useUpdate((s) => s.failed)
  if (!version) return null

  // Текст — одна строка, действие — в кнопке. Раньше «скачай с сайта» стояло
  // и в строке, и на кнопке (аудит 22.09.2026).
  const label = failed
    ? t('Обновление {version}', { version })
    : staged
      ? t('Обновление {version} встанет при выходе', { version })
      : t('Качаем обновление {version}', { version })

  return (
    <div className="upd-banner" role="status">
      <Icon id="i-download" />
      <span className="upd-banner-txt">{label}</span>
      <button className="btn sm primary" onClick={() => void applyUpdate()} disabled={busy}>
        {busy ? (
          <>
            <span className="spin" style={{ width: '14px', height: '14px' }}></span>
            {t('Обновляем…')}
          </>
        ) : (
          <>
            <Icon id={failed ? 'i-download' : 'i-restart'} />
            {failed ? t('Скачать') : t('Обновить')}
          </>
        )}
      </button>
    </div>
  )
}
