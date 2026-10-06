import { Icon } from '../Icon'
import { Ruby } from '../Ruby'
import { hasTauri } from '../../ipc/tauri'
import { openUrl } from '../../ipc/commands'
import type { TelegramReward } from '../../lib/rubies'
import { Head } from './parts'
import { telegramLink, telegramStep } from './telegramRewardState'

const open = (url: string | null) => {
  if (!url) return
  if (hasTauri()) void openUrl(url)
  else window.open(url, '_blank')
}

export function TelegramRewardBlock({ view, busy, onClaim }: { view: TelegramReward | null; busy: boolean; onClaim: () => void }) {
  const step = telegramStep(view)
  if (!view || step === 'hidden') return null
  return (
    <div className="card sh-block" id="shop-telegram" data-section="telegram_reward">
      <Head title="Telegram-канал">
        <span className="sh-tag">
          <Icon id="i-send" />
          Разовая награда
        </span>
      </Head>
      <div className="sh-ach-prizes">
        <div className={'sh-prize sh-quest' + (step === 'claimed' ? ' got' : '')}>
          <Ruby size={40} />
          <span className="sh-prize-body">
            <b>Подпишись на канал Millida</b>
            <span className="sh-meter-cap">
              {step === 'claimed'
                ? 'Награда за подписку получена'
                : step === 'link'
                  ? 'Сначала привяжи Telegram в боте, потом подпишись на канал'
                  : 'Подпишись на канал и нажми «Проверить»'}
            </span>
          </span>
          <span className="sh-prize-n">+{view.amount}</span>
          {step === 'claimed' ? (
            <span className="sh-owned sm">
              <Icon id="i-check" />
              Забрано
            </span>
          ) : step === 'link' ? (
            <button className="btn sm primary" data-track="tg_reward_link" onClick={() => open(telegramLink(view.botUrl))}>
              Привязать Telegram
            </button>
          ) : (
            <>
              <button className="btn sm" data-track="tg_reward_channel" onClick={() => open(telegramLink(view.channelUrl))}>
                Подписаться
              </button>
              <button className="btn sm primary" disabled={busy} data-track="tg_reward_claim" onClick={onClaim}>
                Проверить
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
