import { useEffect, useRef, useState } from 'react'
import { CurrencyIcon } from '../CurrencyIcon'
import { apiErrorText } from '../../lib/apiError'
import { milliBuyCredits, milliCreditOffer, type MilliCreditOffer, type MilliCreditPack } from '../../lib/milli'
import { newRequestId } from '../../lib/rubies'
import { afterMilliCredits } from '../../state/milli'
import { setScreen, showToast } from '../../state/ui'
import { useT } from '../../i18n'

export function MilliCreditsBuy() {
  const t = useT()
  const [offer, setOffer] = useState<MilliCreditOffer | null>(null)
  const [busy, setBusy] = useState('')
  // One id per pack until the purchase succeeds: a retry after a dropped answer must not charge twice.
  const ids = useRef(new Map<string, string>())
  useEffect(() => {
    let live = true
    milliCreditOffer()
      .then((o) => live && setOffer(o))
      .catch(() => live && setOffer(null))
    return () => {
      live = false
    }
  }, [])
  if (!offer?.packs.length) return null

  const buy = async (pack: MilliCreditPack) => {
    const id = ids.current.get(pack.code) ?? newRequestId()
    ids.current.set(pack.code, id)
    setBusy(pack.code)
    try {
      const r = await milliBuyCredits(pack.code, id)
      ids.current.delete(pack.code)
      setOffer((o) => (o ? { ...o, credits: r.credits, rubies: r.rubies } : o))
      showToast(t('Запросы добавлены: {n}', { n: r.bought }), 'ok')
      await afterMilliCredits()
    } catch (e) {
      const text = apiErrorText(e, t('Не удалось купить запросы'))
      const short = text === t('Не хватает рубинов')
      showToast(text, 'error', undefined, short ? { label: t('К рубинам'), run: () => setScreen('rubies') } : undefined)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="ml-limit-buy" role="group" aria-label={t('Докупить запросы')}>
      {offer.packs.map((p) => (
        <button
          key={p.code}
          type="button"
          className="btn sm secondary"
          data-track="milli_credits_buy"
          data-src={p.code}
          disabled={!!busy}
          aria-busy={busy === p.code || undefined}
          onClick={() => void buy(p)}
        >
          {t('{n} запросов', { n: p.requests })}
          <span className="ml-limit-price">
            <CurrencyIcon art="ruby" size={14} />
            {p.rubies}
          </span>
        </button>
      ))}
    </div>
  )
}
