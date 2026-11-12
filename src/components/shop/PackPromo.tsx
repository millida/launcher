import { useEffect, useRef, useState, type FormEvent } from 'react'
import { create } from 'zustand'
import { Icon } from '../Icon'
import { apiErrorText } from '../../lib/apiError'
import { previewPackPromo, type PackPromo } from '../../lib/rubies'
import { useT } from '../../i18n'

/**
 * The code outlives the sheet: a player short of money tops up on the site and
 * comes back to the pack, and typing the code again there is where the
 * discount gets lost.
 */
export const usePackPromo = create<{ code: string | null }>(() => ({ code: null }))

export const forgetPackPromo = () => usePackPromo.setState({ code: null })

export function PackPromoField({ pack, applied, onApplied }: { pack: string; applied: PackPromo | null; onApplied: (promo: PackPromo | null) => void }) {
  const t = useT()
  const remembered = usePackPromo((s) => s.code)
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const apply = async (raw: string, quiet: boolean) => {
    const clean = raw.trim().toUpperCase()
    if (!clean || busy) return
    setBusy(true)
    setErr('')
    try {
      const promo = await previewPackPromo(pack, clean)
      if (!alive.current) return
      usePackPromo.setState({ code: promo.code })
      onApplied(promo)
    } catch (e) {
      if (!alive.current) return
      if (quiet) forgetPackPromo()
      else setErr(apiErrorText(e, t('Промокод не подходит')))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!applied && remembered) void apply(remembered, true)
  }, [])

  if (applied) {
    return (
      <span className="bs-promo is-on">
        <Icon id="i-check" />
        <b>
          {applied.code} · −{applied.percent}%
        </b>
        <button
          type="button"
          className="btn sm secondary"
          aria-label={t('Убрать промокод')}
          data-track="pack_promo_remove"
          onClick={() => {
            forgetPackPromo()
            onApplied(null)
          }}
        >
          <Icon id="i-x" />
        </button>
      </span>
    )
  }

  if (!open && !busy) {
    return (
      <button type="button" className="btn md ghost" data-track="pack_promo_open" onClick={() => setOpen(true)}>
        {t('Есть промокод?')}
      </button>
    )
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void apply(code, false)
  }

  return (
    <>
      <form className="bs-promo" onSubmit={submit}>
        <span className={'input' + (err ? ' is-err' : '')}>
          <input
            value={code}
            maxLength={32}
            autoFocus
            placeholder={t('Промокод')}
            aria-label={t('Промокод')}
            aria-invalid={!!err}
            spellCheck={false}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase())
              if (err) setErr('')
            }}
          />
        </span>
        <button type="submit" className="btn md secondary" disabled={!code.trim() || busy} data-track="pack_promo_apply">
          {busy ? t('Проверяем…') : t('Применить')}
        </button>
      </form>
      {err ? (
        <span className="bs-promo-err" role="alert">
          {err}
        </span>
      ) : null}
    </>
  )
}
