import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import { setScreen } from '../state/ui'
import { usePremiumTheme } from '../lib/premiumTheme'
import { pickFriendsTab } from './friends/friendsView'
import { usePlus } from '../state/plus'
import { hasMillidaAccount } from '../lib/api'
import { loadInvites } from '../lib/referrals'
import { APP_ICONS, chosenIcon, iconUnlocked, pickAppIcon } from '../lib/appIcon'
import type { AppIconId } from '../lib/appIcon'
import '../styles/pixel/invite.css'

/// Выбор иконки окна, панели задач и Dock. Закрытые иконки показаны целиком и
/// крупно — с замком в углу и условием под именем («Пригласи 10 друзей»,
/// «Только с PLUS»). PLUS и Diamond читаются с аккаунта, остальное — с лестницы друзей.
export function AppIconPicker() {
  const plus = usePlus((s) => s.active)
  const diamond = usePlus((s) => s.diamond)
  const [perks, setPerks] = useState<string[]>([])
  const [picked, setPicked] = useState<AppIconId>(() => chosenIcon())

  useEffect(() => {
    if (!hasMillidaAccount()) return
    void usePlus.getState().load()
    loadInvites()
      .then((o) => setPerks((o.perks || []).map((p) => p.id)))
      .catch(() => {})
  }, [])

  const access = { plus, diamond, perks }
  // Закрытая иконка ведёт туда, где её открывают (как закрытая тема):
  // PLUS/Diamond — к покупке подписки, лестница друзей — во вкладку «Пригласить».
  const pick = (id: AppIconId, rule: string) => {
    if (!iconUnlocked(id, access)) {
      if (rule === 'plus' || rule === 'diamond') usePremiumTheme.getState().requestPlus(rule === 'diamond' ? 'DIAMOND' : 'PLUS')
      else {
        setScreen('friends')
        pickFriendsTab('invite')
      }
      return
    }
    setPicked(id)
    void pickAppIcon(id)
  }

  return (
    <div className="ico-grid" role="radiogroup" aria-label="Иконка приложения">
      {APP_ICONS.map((i) => {
        const open = iconUnlocked(i.id, access)
        return (
          <button
            key={i.id}
            role="radio"
            aria-checked={picked === i.id}
            data-track="icon_set"
            className={'ico-tile' + (picked === i.id ? ' on' : '') + (open ? '' : ' is-locked')}
            onClick={() => pick(i.id, i.rule)}
          >
            <span className="ico-pic" data-id={i.id}>
              <img src={i.src} alt="" draggable={false} />
              {open ? null : (
                <span className="ico-lock" aria-hidden="true">
                  <Icon id="i-lock" />
                </span>
              )}
            </span>
            <b>{i.name}</b>
            <small>
              {picked === i.id ? (
                <>
                  <Icon id="i-check" />
                  Выбрана
                </>
              ) : open ? null : (
                i.need
              )}
            </small>
          </button>
        )
      })}
    </div>
  )
}
