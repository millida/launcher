import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiError'
import {
  AGE_BRACKETS,
  LFG_LANGS,
  LFG_MODES,
  LFG_REGIONS,
  LFG_TIMES,
  lfgTagLabels,
  lfgTagsOk,
  type LfgCard,
  type LfgTags,
} from '../../lib/party'
import { showToast } from '../../state/ui'
import { loadParty, setAgeBracket, usePartyStore } from '../../state/party'

interface LfgRequest {
  id: string
  from: { userId: string; nickname: string; avatarUrl: string | null }
  createdAt: number
}

const DRAFT: LfgTags = { mode: 'survival', version: '', pack: '', lang: 'ru', region: 'ru_west', voice: false, time: 'now' }

function Chips<T extends string>({
  list,
  value,
  onPick,
}: {
  list: readonly { id: T; label: string }[]
  value: T
  onPick: (v: T) => void
}) {
  return (
    <div className="party-chips">
      {list.map((x) => (
        <button key={x.id} className={'party-tag pick' + (x.id === value ? ' on' : '')} onClick={() => onPick(x.id)}>
          {x.label}
        </button>
      ))}
    </div>
  )
}

function AgeGate() {
  const [busy, setBusy] = useState(false)
  return (
    <>
      <div className="side-cap">Сколько тебе лет?</div>
      <div className="party-chips">
        {AGE_BRACKETS.map((b) => (
          <button
            key={b.id}
            className="party-tag pick"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void setAgeBracket(b.id).finally(() => setBusy(false))
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
      <p className="faint-note">Напарников подбираем только из твоего возраста</p>
    </>
  )
}

/**
 * «Ищу с кем поиграть»: cards made of tags only, so nothing a stranger types reaches a
 * child. Strangers cannot write to each other; a join request goes to the card owner,
 * who accepts it into the party.
 */
export function LfgModal({ close }: { close: () => void }) {
  const safety = usePartyStore((s) => s.safety)
  const [cards, setCards] = useState<LfgCard[]>([])
  const [mine, setMine] = useState<LfgCard | null>(null)
  const [requests, setRequests] = useState<LfgRequest[]>([])
  const [filter, setFilter] = useState<LfgTags['mode'] | ''>('')
  const [draft, setDraft] = useState<LfgTags>(DRAFT)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [close])

  const load = async () => {
    const my = ++seq.current
    try {
      const qs = filter ? '?mode=' + encodeURIComponent(filter) : ''
      const [list, req] = await Promise.all([
        api<{ cards: LfgCard[]; mine: LfgCard | null }>('/party/lfg' + qs),
        api<{ requests: LfgRequest[] }>('/party/lfg/requests'),
      ])
      if (my !== seq.current) return
      setCards(Array.isArray(list.cards) ? list.cards : [])
      setMine(list.mine || null)
      setRequests(Array.isArray(req.requests) ? req.requests : [])
      setError('')
    } catch (e) {
      if (my === seq.current) setError(apiErrorText(e, 'Не удалось загрузить карточки'))
    }
  }

  useEffect(() => {
    if (safety.ageBracket) void load()
  }, [safety.ageBracket, filter])

  const post = async (key: string, path: string, body: unknown, fallback: string): Promise<boolean> => {
    setBusy(key)
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body ?? {}) })
      return true
    } catch (e) {
      showToast(apiErrorText(e, fallback), 'error')
      return false
    } finally {
      setBusy('')
    }
  }

  const publish = async () => {
    if (!lfgTagsOk(draft)) {
      showToast('Проверь версию: только цифры, например 1.21.4', 'error')
      return
    }
    if (await post('card', '/party/lfg', { tags: draft }, 'Карточка не опубликовалась')) {
      setEditing(false)
      void load()
    }
  }

  const remove = async () => {
    if (await post('card', '/party/lfg/remove', {}, 'Не удалось убрать карточку')) void load()
  }

  const ask = async (card: LfgCard) => {
    if (await post(card.id, '/party/lfg/' + encodeURIComponent(card.id) + '/request', {}, 'Запрос не ушёл')) {
      setCards((list) => list.map((c) => (c.id === card.id ? { ...c, requested: true } : c)))
    }
  }

  const answer = async (r: LfgRequest, accept: boolean) => {
    const path = '/party/lfg/requests/' + encodeURIComponent(r.id) + (accept ? '/accept' : '/decline')
    if (await post(r.id, path, {}, accept ? 'Не удалось принять' : 'Не удалось отклонить')) {
      setRequests((list) => list.filter((x) => x.id !== r.id))
      if (accept) void loadParty().catch((e) => console.error('[party] reload', e))
    }
  }

  const report = (userId: string, nick: string, refId: string) =>
    usePartyStore.getState().set({ reportAsk: { userId, nick, context: 'lfg', refId } })

  return (
    <div className="room-modal-back" onClick={close}>
      <div className="room-modal party-modal lfg" data-private data-section="lfg" onClick={(e) => e.stopPropagation()}>
        <div className="room-modal-head">
          <span className="room-ava">
            <Icon id="i-search" />
          </span>
          <b>Ищу с кем поиграть</b>
          <button className="tb-btn" aria-label="Закрыть" onClick={close}>
            <Icon id="i-x" />
          </button>
        </div>

        {!safety.ageBracket ? (
          <AgeGate />
        ) : (
          <>
            {requests.length ? (
              <>
                <div className="side-cap">Просятся к тебе</div>
                {requests.map((r) => (
                  <div key={r.id} className="room-pick-row">
                    <Head nick={r.from.nickname} src={r.from.avatarUrl} size={28} />
                    <span className="room-pick-nick">{r.from.nickname}</span>
                    <button className="btn sm primary" disabled={busy === r.id} onClick={() => void answer(r, true)}>
                      <Icon id="i-check" />
                      Принять
                    </button>
                    <button className="btn sm ghost" aria-label="Отклонить" disabled={busy === r.id} onClick={() => void answer(r, false)}>
                      <Icon id="i-x" />
                    </button>
                    <button className="btn sm ghost" aria-label="Пожаловаться" onClick={() => report(r.from.userId, r.from.nickname, r.id)}>
                      <Icon id="i-flag" />
                    </button>
                  </div>
                ))}
              </>
            ) : null}

            {safety.newAccount ? (
              <p className="faint-note">Свою карточку можно выставить через неделю после регистрации</p>
            ) : editing || !mine ? (
              <>
                <div className="side-cap">Моя карточка</div>
                <Chips list={LFG_MODES} value={draft.mode} onPick={(mode) => setDraft({ ...draft, mode })} />
                <Chips list={LFG_LANGS} value={draft.lang} onPick={(lang) => setDraft({ ...draft, lang })} />
                <Chips list={LFG_REGIONS} value={draft.region} onPick={(region) => setDraft({ ...draft, region })} />
                <Chips list={LFG_TIMES} value={draft.time} onPick={(time) => setDraft({ ...draft, time })} />
                <div className="party-chips">
                  <button className={'party-tag pick' + (draft.voice ? ' on' : '')} onClick={() => setDraft({ ...draft, voice: !draft.voice })}>
                    <Icon id="i-mic" />
                    С голосом
                  </button>
                  <div className="input sm party-ver">
                    <input
                      placeholder="Версия"
                      inputMode="decimal"
                      maxLength={10}
                      value={draft.version}
                      onChange={(e) => setDraft({ ...draft, version: e.target.value.replace(/[^\d.]/g, '') })}
                    />
                  </div>
                </div>
                <div className="room-modal-acts">
                  {mine ? (
                    <button className="btn sm ghost" onClick={() => setEditing(false)}>
                      Отмена
                    </button>
                  ) : null}
                  <button className="btn sm primary" disabled={busy === 'card'} onClick={() => void publish()}>
                    <Icon id="i-send" />
                    Выставить
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="side-cap">Моя карточка</div>
                <div className="party-card mine">
                  <div className="party-chips">
                    {lfgTagLabels(mine.tags).map((t) => (
                      <span key={t} className="party-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="room-modal-acts">
                    <button className="btn sm ghost" onClick={() => setEditing(true)}>
                      <Icon id="i-edit" />
                      Изменить
                    </button>
                    <button className="btn sm secondary" disabled={busy === 'card'} onClick={() => void remove()}>
                      <Icon id="i-trash" />
                      Убрать
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="side-cap">Ищут напарников</div>
            <div className="party-chips">
              <button className={'party-tag pick' + (filter === '' ? ' on' : '')} onClick={() => setFilter('')}>
                Все
              </button>
              {LFG_MODES.map((m) => (
                <button key={m.id} className={'party-tag pick' + (filter === m.id ? ' on' : '')} onClick={() => setFilter(m.id)}>
                  {m.label}
                </button>
              ))}
            </div>
            {error ? (
              <div className="nb-err">
                <Icon id="i-alert" />
                <span>{error}</span>
                <button className="btn sm secondary" onClick={() => void load()}>
                  <Icon id="i-restart" /> Повторить
                </button>
              </div>
            ) : null}
            {cards.map((c) => (
              <div key={c.id} className="party-card">
                <div className="party-card-head">
                  <Head nick={c.user.nickname} src={c.user.avatarUrl} size={28} />
                  <b>{c.user.nickname}</b>
                  <span className="meta">{c.size + '/' + c.capacity}</span>
                  <button className="btn sm ghost" aria-label="Пожаловаться" onClick={() => report(c.user.userId, c.user.nickname, c.id)}>
                    <Icon id="i-flag" />
                  </button>
                  <button
                    className="btn sm secondary"
                    disabled={c.requested || busy === c.id || safety.newAccount}
                    onClick={() => void ask(c)}
                  >
                    <Icon id={c.requested ? 'i-check' : 'i-send'} />
                    {c.requested ? 'Попросился' : 'Попроситься'}
                  </button>
                </div>
                <div className="party-chips">
                  {lfgTagLabels(c.tags).map((t) => (
                    <span key={t} className="party-tag">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {!cards.length && !error ? <p className="faint-note">Сейчас никого — выставь свою карточку</p> : null}
          </>
        )}
      </div>
    </div>
  )
}
