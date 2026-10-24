import { useEffect } from 'react'
import { Icon } from '../Icon'
import { loadPrivacy, usePrivacy } from '../../lib/privacy'
import { hasMillidaAccount } from '../../lib/api'
import { showToast } from '../../state/ui'
import { useT } from '../../i18n'

/// The invisible status is the activity privacy set to "only me": the server then shows the
/// player offline and without a last-seen time to friends as well as to strangers.
export function InvisibleToggle() {
  const t = useT()
  const visible = usePrivacy((s) => s.settings.showActivity)
  const saving = usePrivacy((s) => s.saving === 'showActivity')

  useEffect(() => {
    if (hasMillidaAccount()) void loadPrivacy().catch(() => {})
  }, [])

  if (!hasMillidaAccount()) return null
  const invisible = !visible
  return (
    <button
      className={'btn sm secondary fr-invisible' + (invisible ? ' on' : '')}
      aria-pressed={invisible}
      disabled={saving}
      data-track="friends_invisible"
      title={invisible ? t('Друзья видят тебя не в сети') : t('Скрыть, что ты в сети')}
      onClick={() =>
        void usePrivacy
          .getState()
          .patch({ showActivity: invisible })
          .then(() => showToast(invisible ? t('Ты снова в сети для друзей') : t('Невидимка: друзья видят тебя не в сети')))
          .catch(() => showToast(t('Не удалось сменить статус — попробуй ещё раз'), 'error'))
      }
    >
      <Icon id="i-eye" />
      {invisible ? t('Невидимка') : t('В сети')}
    </button>
  )
}
