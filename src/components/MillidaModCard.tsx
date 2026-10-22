import { useCallback, useEffect, useState } from 'react'
import {
  millidaModInstall,
  millidaModState,
  type MillidaModState,
} from '../ipc/commands'
import { Icon } from './Icon'
import { tx, useT } from '../i18n'

/**
 * Карточка мода Millida в выбранной сборке: лаунчер сам подбирает вариант под
 * версию и загрузчик, игроку остаётся одна кнопка.
 */
export function MillidaModCard({ profile }: { profile: string }) {
  const t = useT()
  const [state, setState] = useState<MillidaModState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setState(await millidaModState(profile))
      setError('')
    } catch (e) {
      setState(null)
      setError(tx(e))
    }
  }, [profile])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!state && !error) return null

  const installed = state?.installed ?? ''
  const available = state?.available ?? ''
  const fresh = installed !== '' && installed === available
  const canInstall = available !== '' && !fresh

  const act = async (run: (profile: string) => Promise<MillidaModState>) => {
    setBusy(true)
    setError('')
    try {
      setState(await run(profile))
    } catch (e) {
      setError(tx(e))
      void refresh()
    } finally {
      setBusy(false)
    }
  }

  const note = error
    ? error
    : fresh
      ? t('Установлен и подходит этой сборке')
      : installed
        ? t('Установлена другая версия — обновим')
        : available
          ? t('Скины, плащи, косметика и эмоции прямо в игре')
          : state?.reason || t('Под эту сборку мода пока нет')

  return (
    <div className="card icon-nudge">
      <span className="icon-nudge-art">
        <Icon id="i-brush" />
      </span>
      <div className="icon-nudge-text">
        <b>{t('Косметика Millida')}</b>
        <span className="faint-note">{note}</span>
      </div>
      <div className="icon-nudge-acts">
        {canInstall ? (
          <button className="btn sm primary" disabled={busy} onClick={() => void act(millidaModInstall)}>
            <Icon id="i-brush" />
            {busy ? t('Ставим…') : installed ? t('Обновить') : t('Установить')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
