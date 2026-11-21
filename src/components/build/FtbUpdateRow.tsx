import { useEffect, useRef, useState } from 'react'
import { ftbCheckUpdate, ftbUpdate, type FtbUpdate } from '../../ipc/commands'
import { hasTauri } from '../../ipc/tauri'
import { apiErrorText } from '../../lib/apiError'
import { useProfiles } from '../../state/profiles'
import { showToast } from '../../state/ui'
import { uiConfirm } from '../../state/confirm'
import { Icon } from '../Icon'
import { useT } from '../../i18n'

/**
 * Сборка из FTB: есть новая версия — строка с кнопкой «Обновить». Жалоба 17.11.2026:
 * FTB Skies 2: Aero стояла на 1.3.0, когда вышла 1.16.0, потому что лаунчер
 * у FTB больше ничего не спрашивал. Обновление идёт в ту же папку: миры,
 * настройки и моды игрока остаются.
 */
export function FtbUpdateRow({ profile, running, onUpdated }: { profile: string; running: boolean; onUpdated: () => void }) {
  const t = useT()
  const [next, setNext] = useState<FtbUpdate | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    setNext(null)
    if (!hasTauri()) return
    const mine = ++seq.current
    ftbCheckUpdate(profile)
      .then((u) => mine === seq.current && setNext(u))
      .catch(() => mine === seq.current && setNext(null))
  }, [profile])

  if (!next) return null
  const update = async () => {
    // Обновление меняет моды и файлы сборки: без вопроса одна случайная кнопка меняла сборку игрока.
    const ok = await uiConfirm(
      t('Сборка обновится с {from} до {to}. Миры, настройки и твои моды останутся, моды сборки заменятся новыми версиями.', {
        from: next.current || '?',
        to: next.version,
      }),
      { title: t('Обновить сборку FTB?'), confirmLabel: t('Обновить'), danger: false },
    )
    if (!ok) return
    setBusy(true)
    ftbUpdate(profile)
      .then(() => {
        setNext(null)
        onUpdated()
        void useProfiles.getState().refresh()
        showToast(t('Сборка обновлена до {version}', { version: next.version }), 'ok')
      })
      .catch((e) => showToast(apiErrorText(e, t('Не удалось обновить сборку')), 'error'))
      .finally(() => setBusy(false))
  }
  return (
    <div className="set-row" id="bsFtbUpdate">
      <span className="lab">
        {t('Версия FTB')}
        <small>{t('{from} → {to}', { from: next.current || '?', to: next.version + (next.mc ? ' · ' + next.mc : '') })}</small>
      </span>
      <button className="btn sm primary" disabled={busy || running} title={running ? t('Закрой игру, чтобы обновить') : undefined} onClick={update}>
        <Icon id="i-arrow-up" /> {busy ? t('Обновляем…') : t('Обновить')}
      </button>
    </div>
  )
}
