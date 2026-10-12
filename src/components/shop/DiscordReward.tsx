import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { openExt } from '../../lib/api'
import { discordLinkUrl, type DiscordReward } from '../../lib/rubies'
import { showToast } from '../../state/ui'

const inviteOk = (u: string): string | null => {
  try {
    const p = new URL(u)
    return p.protocol === 'https:' && (p.hostname === 'discord.gg' || p.hostname === 'discord.com') ? p.toString() : null
  } catch {
    return null
  }
}

/** Привязка открывается на сайте: OAuth Discord ведёт обратно на millida.net. */
async function openLink() {
  try {
    const { url } = await discordLinkUrl()
    if (url && url.startsWith('https://discord.com/')) openExt(url)
    else throw new Error('bad url')
  } catch {
    showToast('Не получилось открыть привязку Discord, попробуй ещё раз', 'error')
  }
}

/**
 * Задание магазина «Вступи в Discord Millida» — как подписка на Telegram
 * (владелец 11.10.2026: «вступи в дискорд, получи что-то»). Шаги: привязать
 * Discord к аккаунту → зайти на сервер → «Проверить».
 */
export function DiscordRewardBlock({ view, busy, onClaim }: { view: DiscordReward | null; busy: boolean; onClaim: () => void }) {
  if (!view || view.claimed || !view.available || !(view.amount > 0)) return null
  const invite = inviteOk(view.inviteUrl)
  return (
    <div className="card sh-block" id="shop-discord" data-section="discord_reward">
      <div className="sh-ach-prizes">
        <div className="sh-prize sh-quest">
          <Ruby size={40} />
          <span className="sh-prize-body">
            <b>Вступи в Discord Millida</b>
            <span className="sh-meter-cap">{view.linked ? 'Зайди на сервер и нажми «Проверить»' : 'Сначала привяжи Discord к аккаунту'}</span>
          </span>
          <span className="sh-prize-n">+{view.amount}</span>
          {view.linked ? (
            <>
              <button className="btn sm" data-track="dc_reward_join" disabled={!invite} onClick={() => invite && openExt(invite)}>
                <Icon id="i-users" />
                Вступить
              </button>
              <button className="btn sm primary" disabled={busy} data-track="dc_reward_claim" onClick={onClaim}>
                Проверить
              </button>
            </>
          ) : (
            <button className="btn sm primary" data-track="dc_reward_link" onClick={() => void openLink()}>
              Привязать Discord
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
