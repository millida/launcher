import { useEffect, useState, type FormEvent } from 'react'
import { Head } from '../Head'
import { PxIcon } from '../PxIcon'
import { ChestArt } from '../daily/ChestArt'
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

const sinceText = (iso: string) => {
  const d = new Date(iso)
  return isNaN(+d) ? '' : 'с ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' })
}

/** Лучи и рассыпанные значки фона: плоские цвета, без градиентов. */
function CcArt() {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 * Math.PI) / 180
    const b = ((i * 30 + 13) * Math.PI) / 180
    return `M100 100 L${100 + 160 * Math.cos(a)} ${100 + 160 * Math.sin(a)} L${100 + 160 * Math.cos(b)} ${100 + 160 * Math.sin(b)} Z`
  })
  return (
    <span className="sh-cc-art" aria-hidden="true">
      <svg className="sh-cc-rays" viewBox="0 0 200 200" shapeRendering="crispEdges">
        {rays.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
      <PxIcon name="heart" size={24} className="sh-cc-bit b1" />
      <PxIcon name="star" size={18} className="sh-cc-bit b2" />
      <PxIcon name="heart" size={12} className="sh-cc-bit b3" />
      <PxIcon name="gem" size={18} className="sh-cc-bit b4" />
      <PxIcon name="heart" size={18} className="sh-cc-bit b5" />
      <PxIcon name="sparkle" size={12} className="sh-cc-bit b6" />
      <span className="sh-cc-heart">
        <PxIcon name="heart" size={96} />
      </span>
    </span>
  )
}

/**
 * «Код автора» внизу магазина — как Support-a-Creator в Fortnite
 * (задача владельца 24.09.2026). Код живёт на службе; пока адресов нет на
 * проде (404 на GET), баннер всё равно виден, а ввод честно отвечает
 * «скоро заработают» — успехом не притворяемся.
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
          items: [{ name: CHEST_NAME[tier] + ' сундук', rarity: tier, art: <ChestArt ready tier={tier} size={150} /> }],
          doneLabel: 'В сундуки',
          onDone: () => document.querySelector('#s-rubies .mc')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
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

  const become = (
    // Отдельная кнопка в углу баннера, не в ряду формы (владелец 24.09, 17:05).
    <button type="button" className="sh-cc-become" data-sound="open" data-track="creator_become" onClick={() => openExt(CREATORS_URL)}>
      <PxIcon name="star" size={16} /> Стать автором
    </button>
  )

  if (cur === undefined) return <span className="skel sh-skel sh-cc-skel" aria-hidden="true" />

  const on = !!cur && !editing
  return (
    <section className={'card sh-block sh-cc' + (on ? ' is-on' : '')} aria-label="Код автора" data-section="creator_code" data-private>
      {become}
      <div className="sh-cc-in">
      <CcArt />
      {on && cur ? (
        <div className="sh-cc-body">
          <div className="sh-cc-who">
            <span className="sh-cc-face">
              <Head nick={cur.name} src={cur.avatarUrl} size={72} alt={cur.name} />
            </span>
            <span className="sh-cc-who-t">
              <small>Ты поддерживаешь</small>
              <b>{cur.name}</b>
              <small>
                {cur.code}
                {sinceText(cur.since) ? ' · ' + sinceText(cur.since) : ''}
              </small>
            </span>
          </div>
          <div className="sh-cc-row">
            <button type="button" className="btn md secondary" disabled={busy} data-track="creator_change" onClick={() => setEditing(true)}>
              Сменить
            </button>
            <button type="button" className="btn md ghost" disabled={busy} data-track="creator_remove" onClick={() => void remove()}>
              Убрать
            </button>
          </div>
        </div>
      ) : (
        <div className="sh-cc-body">
          <h2>Поддержи любимого автора</h2>
          <p className="sh-cc-lead">Автор получает часть с твоих покупок — тебе ничего не стоит</p>
          <form className="sh-cc-row" onSubmit={(e) => void submit(e)}>
            <span className={'input sh-cc-input' + (err ? ' is-err' : '')}>
              <input
                value={code}
                maxLength={32}
                autoFocus={editing}
                placeholder="Код автора"
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
            <button type="submit" className="btn md primary" disabled={!code.trim() || busy} data-track="creator_apply">
              Поддержать
            </button>
            {editing ? (
              <button type="button" className="btn md ghost" data-track="creator_cancel" onClick={() => setEditing(false)}>
                Отмена
              </button>
            ) : null}
          </form>
          {err ? (
            <p className="sh-cc-err" role="alert">
              {err}
            </p>
          ) : null}
        </div>
      )}
      </div>
    </section>
  )
}
