import { Icon } from '../Icon'
import { PlusMark } from './PlusMark'
import { allowed, applyPremiumAccent, PREMIUM_ACCENTS, usePremiumTheme, type PremiumTheme } from '../../lib/premiumTheme'

/**
 * Настройки → Вид → «Тема лаунчера»: Стандартная · PLUS · Diamond (владелец
 * 06.10.2026). Закрытый вариант — с замком; клик открывает окно покупки.
 */
export function ThemeRow() {
  const theme = usePremiumTheme((s) => s.theme)
  const tier = usePremiumTheme((s) => s.tier)
  const opts: { id: PremiumTheme; label: string }[] = [
    { id: 'off', label: 'Стандартная' },
    { id: 'plus', label: 'PLUS' },
    { id: 'diamond', label: 'Diamond' },
  ]
  return (
    <div className="pt-row" role="radiogroup" aria-label="Тема лаунчера">
      {opts.map((o) => {
        const locked = !allowed(o.id, tier)
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={theme === o.id}
            aria-label={o.label}
            className={'pt-opt' + (theme === o.id ? ' on' : '') + (locked ? ' is-locked' : '')}
            data-track={'ptheme_' + o.id}
            onClick={() =>
              locked
                ? usePremiumTheme.getState().requestPlus(o.id === 'diamond' ? 'DIAMOND' : 'PLUS')
                : usePremiumTheme.getState().setTheme(o.id)
            }
          >
            {o.id === 'off' ? <i className="pt-std" /> : <PlusMark tier={o.id === 'diamond' ? 'DIAMOND' : 'PLUS'} height={o.id === 'diamond' ? 14 : 18} />}
            {o.id === 'off' ? o.label : null}
            {locked ? <Icon id="i-lock" /> : null}
          </button>
        )
      })}
    </div>
  )
}

/** Золото и алмаз в палитре «Цвет кнопок» — только у подписчика. */
export function PremiumSwatches({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const tier = usePremiumTheme((s) => s.tier)
  if (!tier) return null
  return (
    <>
      {PREMIUM_ACCENTS.filter((a) => tier === 'DIAMOND' || a.tier === 'PLUS').map((a) => (
        <button
          key={a.id}
          role="radio"
          aria-checked={current === a.id}
          aria-label={a.name}
          data-tip={a.name}
          className={'s2-sw' + (current === a.id ? ' on' : '')}
          style={{ background: a.c }}
          onClick={() => {
            applyPremiumAccent(a.id)
            onPick(a.id)
          }}
        ></button>
      ))}
    </>
  )
}
