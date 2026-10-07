import { useEffect, useState, type FormEvent } from 'react'
import { Head } from '../Head'
import { Icon } from '../Icon'
import { PxIcon } from '../PxIcon'
import { ChestLive } from '../daily/ChestLive'
import { CHEST_NAME } from '../daily/rewards'
import { showReward } from '../reward/RewardReveal'
import { openExt } from '../../lib/api'
import { apiErrorText } from '../../lib/apiError'
import {
  bonusUsed,
  clearCreator,
  creatorErrorText,
  CREATORS_URL,
  isNotFound,
  loadCreator,
  markBonusUsed,
  setCreator,
  SOON,
  type CreatorSupport,
} from '../../lib/creator'
import { useDaily } from '../../state/daily'
import { showToast } from '../../state/ui'
import { useShopGift } from './giftState'

/**
 * «Код автора» (Support-a-Creator, задача владельца 24.09.2026): с магазина v2
 * (06.10.2026) это одна компактная строка в самом низу: поле и «Применить»;
 * если код стоит — чип «Поддерживаешь: ник» с крестиком. Код живёт на службе;
 * пока адресов нет на проде (404 на GET), строка всё равно видна, а ввод
 * честно отвечает «скоро заработают» — успехом не притворяемся.
 */
export function CreatorCode() {
  /** undefined — ещё грузим; null — никого не поддерживает. */
  const [cur, setCur] = useState<CreatorSupport | null | undefined>(undefined)
  /** Служба ответила на GET: 404 на вводе тогда значит «код не найден». */
  const [live, setLive] = useState(false)
  const [editing, setEditing] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  // Сундук за первый код — сюрприз, на баннере не рекламируется (17:05).
  const [, setGift] = useState(() => !bonusUsed())

  useEffect(() => {
    let alive = true
    loadCreator()
      .then((r) => {
        if (!alive) return
        setLive(true)
        setCur(r)
        // Код уже стоит — подарок за первый ввод получен раньше.
        if (r) setGift(false)
      })
      .catch((e) => {
        if (!alive) return
        setLive(false)
        setCur(null)
        if (!isNotFound(e)) console.warn('creator-code', e)
      })
    return () => {
      alive = false
    }
  }, [])

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const c = code.trim()
    if (!c || busy) return
    setBusy(true)
    setErr('')
    try {
      const res = await setCreator(c)
      setLive(true)
      setCur({ code: res.code, name: res.name, avatarUrl: res.avatarUrl, since: res.since })
      setEditing(false)
      setCode('')
      setGift(false)
      markBonusUsed()
      const head = { name: res.name, art: <Head nick={res.name} src={res.avatarUrl} size={128} className="sh-cc-rw-head" /> }
      if (res.bonus) {
        const tier = res.bonus.tier
        // Сундук ложится в «Мои сундуки» — они в пассе наверху магазина.
        void useDaily.getState().load()
        showReward({
          kicker: 'Ты поддерживаешь ' + res.name,
          title: CHEST_NAME[tier] + ' сундук',
          sub: 'Подарок за первый код автора',
          items: [{ name: CHEST_NAME[tier] + ' сундук', rarity: tier, art: <ChestLive ready tier={tier} size={150} look="model" /> }],
          doneLabel: 'В сундуки',
          onDone: () => useShopGift.getState().setTab('chests'),
        })
      } else {
        showReward({
          kicker: 'Код автора',
          title: 'Ты поддерживаешь ' + res.name,
          sub: 'Часть с твоих покупок — автору',
          tone: 'var(--m-danger)',
          items: [head],
          doneLabel: 'Круто',
        })
      }
    } catch (x) {
      setErr(creatorErrorText(x, live))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await clearCreator()
      setCur(null)
      setEditing(false)
    } catch (x) {
      showToast(isNotFound(x) ? SOON : apiErrorText(x, 'Не получилось, попробуй позже'), 'error')
    } finally {
      setBusy(false)
    }
  }

  if (cur === undefined) return <span className="skel sv-banner-skel" aria-hidden="true" />

  const on = !!cur && !editing
  return (
    <section className="card sv-banner is-support" aria-label="Поддержи автора" data-section="creator_code" data-private>
      <span className="sv-banner-art" aria-hidden="true">
        {on && cur ? (
          <Head nick={cur.name} src={cur.avatarUrl} size={128} className="sv-banner-face" />
        ) : (
          <>
            <PxIcon name="heart" size={110} className="a1" />
            <PxIcon name="user" size={56} className="a2" />
            <PxIcon name="sparkle" size={36} className="a3" />
          </>
        )}
      </span>
      <span className="sv-banner-body">
        <h2 className="sv-banner-title">{on && cur ? cur.name : 'Поддержи автора'}</h2>
        <span className="sv-banner-line">Автор получит деньги с твоих покупок</span>
        {on && cur ? (
          <span className="sv-banner-row">
            <span className="sv-banner-on">
              <Icon id="i-heart" />
            </span>
            <button type="button" className="btn md secondary" aria-label="Убрать код" disabled={busy} data-track="creator_remove" onClick={() => void remove()}>
              <Icon id="i-x" />
            </button>
          </span>
        ) : (
          <form className="sv-banner-row" onSubmit={(e) => void submit(e)}>
            <span className={'input sv-code-input' + (err ? ' is-err' : '')}>
              <input
                value={code}
                maxLength={32}
                autoFocus={editing}
                placeholder="КОД"
                aria-label="Код автора"
                aria-invalid={!!err}
                spellCheck={false}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase())
                  if (err) setErr('')
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && editing) setEditing(false)
                }}
              />
            </span>
            <button type="submit" className="btn lg primary" disabled={!code.trim() || busy} data-track="creator_apply">
              Ок
            </button>
          </form>
        )}
        {err ? (
          <span className="sv-code-err" role="alert">
            {err}
          </span>
        ) : null}
      </span>
    </section>
  )
}

/** «Стань автором»: баннер в пару к «Поддержи автора» — арт, два слова, «Хочу». Ведёт на сайт авторов. */
export function CreatorBanner() {
  return (
    <section className="card sv-banner is-become" aria-label="Стать автором" data-section="creator_become">
      <span className="sv-banner-art" aria-hidden="true">
        <PxIcon name="star" size={110} className="a1" />
        <PxIcon name="cam" size={52} className="a2" />
        <PxIcon name="gem" size={40} className="a3" />
      </span>
      <span className="sv-banner-body">
        <h2 className="sv-banner-title">Стань автором</h2>
        <span className="sv-banner-line">Получай 50% с покупок по твоему коду</span>
        <span className="sv-banner-row">
          <button type="button" className="btn lg primary" data-sound="open" data-track="creator_become" onClick={() => openExt(CREATORS_URL)}>
            Хочу
          </button>
        </span>
      </span>
    </section>
  )
}
