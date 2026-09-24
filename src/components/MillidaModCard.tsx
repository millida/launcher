import { useCallback, useEffect, useState } from 'react'
import {
  millidaModInstall,
  millidaModState,
  type MillidaModState,
} from '../ipc/commands'
import { Icon } from './Icon'

/**
 * Карточка мода Millida в выбранной сборке: лаунчер сам подбирает вариант под
 * версию и загрузчик, игроку остаётся одна кнопка.
 */
export function MillidaModCard({ profile }: { profile: string }) {
  const [state, setState] = useState<MillidaModState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setState(await millidaModState(profile))
      setError('')
    } catch (e) {
      setState(null)
      setError(String(e))
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
      setError(String(e))
      void refresh()
    } finally {
      setBusy(false)
    }
  }

  const note = error
    ? error
    : fresh
      ? 'Установлен и подходит этой сборке'
      : installed
        ? 'Установлена другая версия — обновим'
        : available
          ? 'Скины, плащи, косметика и эмоции прямо в игре'
          : state?.reason || 'Под эту сборку мода пока нет'

  return (
    <div className="card icon-nudge">
      <span className="icon-nudge-art">
        <Icon id="i-brush" />
      </span>
      <div className="icon-nudge-text">
        <b>Косметика Millida</b>
        <span className="faint-note">{note}</span>
      </div>
      <div className="icon-nudge-acts">
        {canInstall ? (
          <button className="btn sm primary" disabled={busy} onClick={() => void act(millidaModInstall)}>
            <Icon id="i-brush" />
            {busy ? 'Ставим…' : installed ? 'Обновить' : 'Установить'}
          </button>
        ) : null}
      </div>
    </div>
  )
}
