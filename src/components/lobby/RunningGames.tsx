import { useState } from 'react'
import { Icon } from '../Icon'
import { stopGame } from '../../ipc/commands'
import { syncRunningGame, useGame } from '../../state/game'
import { showToast } from '../../state/ui'
import { useT } from '../../i18n'

/// One tab per running game, so with two builds open each can be stopped on its own:
/// the big button only ever stops the build it shows.
export function RunningGames() {
  const t = useT()
  const list = useGame((s) => s.list)
  const [stopping, setStopping] = useState<string | null>(null)
  const names = [...new Set(list)]
  if (names.length < 2) return null

  const stop = (profile: string) => {
    setStopping(profile)
    stopGame(profile)
      .catch((e) => showToast(t('Не удалось остановить игру: {error}', { error: String(e) }), 'error'))
      .finally(() => {
        setStopping(null)
        syncRunningGame()
      })
  }

  return (
    <div className="run-tabs" role="list" aria-label={t('Запущенные игры')}>
      {names.map((name) => (
        <div key={name} className="run-tab" role="listitem">
          <span className="run-tab-dot" aria-hidden="true" />
          <span className="run-tab-name" title={name}>
            {name}
          </span>
          <button
            className="run-tab-stop"
            disabled={stopping === name}
            aria-label={t('Остановить «{name}»', { name })}
            onClick={() => stop(name)}
          >
            <Icon id="i-x" />
          </button>
        </div>
      ))}
    </div>
  )
}
