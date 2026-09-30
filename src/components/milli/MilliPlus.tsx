import { PxIcon } from '../PxIcon'
import { useDaily } from '../../state/daily'

/**
 * «Больше с PLUS» — сразу в оплату (владелец 30.09 16:11). Путь тот же, что у
 * кнопок PLUS в магазине и на «Персонаже»: `useDaily.startPlus` —
 * POST /launcher/plus/subscribe, ссылка оплаты в браузере, опрос до настоящей
 * оплаты; повторный клик в 15 минут открывает ту же ссылку, новая подписка не
 * создаётся. После оплаты `usePlus.active` меняется — панель Милли
 * перечитывает статус (MilliDock).
 */
export function MilliPlusButton({ label = 'Больше с PLUS', track, src }: { label?: string; track: string; src: string }) {
  const busy = useDaily((s) => s.busy === 'plus')
  return (
    <button
      type="button"
      className="btn sm primary ml-plus"
      data-track={track}
      data-src={src}
      disabled={busy}
      aria-busy={busy || undefined}
      onClick={() => void useDaily.getState().startPlus()}
    >
      <PxIcon name="crown" size={12} />
      {label}
    </button>
  )
}
