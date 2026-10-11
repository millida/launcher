import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon'
import { Head } from '../Head'
import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiError'
import { AGE_BRACKETS, lfgTagLabels, type LfgCard, type LfgTags } from '../../lib/party'
import { showToast } from '../../state/ui'
import { loadParty, setAgeBracket, usePartyStore } from '../../state/party'

interface LfgRequest {
  id: string
  from: { userId: string; nickname: string; avatarUrl: string | null }
  createdAt: number
}

const DRAFT: LfgTags = { mode: 'survival', version: '', pack: '', lang: 'ru', region: 'ru_west', voice: false, time: 'now' }

/** People closest to my own card come first: same mode, then same language. */
function closeness(card: LfgCard, mine: LfgTags | null): number {
  if (!mine) return 0
  return (card.tags.mode === mine.mode ? 2 : 0) + (card.tags.lang === mine.lang ? 1 : 0)
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
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const seq = useRef(0)
  const [tab, setTab] = useState<'find' | 'host'>('find')

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close()
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [close])

  const load = async () => {
    const my = ++seq.current
    try {
      const [list, req] = await Promise.all([
        api<{ cards: LfgCard[]; mine: LfgCard | null }>('/party/lfg'),
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
  }, [safety.ageBracket])

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
    if (await post('card', '/party/lfg', { tags: DRAFT }, 'Не удалось начать поиск')) void load()
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

  const sorted = [...cards].sort((a, b) => closeness(b, mine?.tags ?? DRAFT) - closeness(a, mine?.tags ?? DRAFT))

  const report = (userId: string, nick: string, refId: string) =>
    usePartyStore.getState().set({ reportAsk: { userId, nick, context: 'lfg', refId } })

  return (
    <div className="room-modal-back" onClick={close}>
      <div className="room-modal party-modal lfg" data-private data-section="lfg" onClick={(e) => e.stopPropagation()}>
        <div className="room-modal-head">
          <span className="room-ava">
            <Icon id="i-search" />
          </span>
          <b>Напарники</b>
          <button className="tb-btn" aria-label="Закрыть" onClick={close}>
            <Icon id="i-x" />
          </button>
        </div>

        {!safety.ageBracket ? (
          <AgeGate />
        ) : (
          <>
            <div className="segs party-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'find'} className={'seg' + (tab === 'find' ? ' on' : '')} onClick={() => setTab('find')}>
                <Icon id="i-search" />
                Найти пати
              </button>
              <button role="tab" aria-selected={tab === 'host'} className={'seg' + (tab === 'host' ? ' on' : '')} onClick={() => setTab('host')}>
                <Icon id="i-users" />
                Собрать пати
                {requests.length ? <span className="party-badge">{requests.length}</span> : null}
              </button>
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

            {tab === 'find' ? (
              <>
                {sorted.length ? (
                  <button className="btn primary party-wide" disabled={!!busy || safety.newAccount || sorted[0]!.requested} onClick={() => void ask(sorted[0]!)}>
                    <Icon id="i-zap" />
                    Быстрый вход
                  </button>
                ) : null}
                {sorted.map((c) => (
                  <div key={c.id} className="party-row">
                    <Head nick={c.user.nickname} src={c.user.avatarUrl} size={32} />
                    <span className="party-row-who">
                      <b>{c.user.nickname}</b>
                      <span>{lfgTagLabels(c.tags).slice(0, 2).join(' · ')}</span>
                    </span>
                    <span className="party-row-size">
                      <Icon id="i-users" />
                      {c.size + '/' + c.capacity}
                    </span>
                    <button className="btn sm ghost" aria-label="Пожаловаться" onClick={() => report(c.user.userId, c.user.nickname, c.id)}>
                      <Icon id="i-flag" />
                    </button>
                    <button className="btn sm secondary" disabled={c.requested || busy === c.id || safety.newAccount} onClick={() => void ask(c)}>
                      <Icon id={c.requested ? 'i-check' : 'i-login'} />
                      {c.requested ? 'Ждём' : 'Войти'}
                    </button>
                  </div>
                ))}
                {!sorted.length && !error ? <p className="faint-note">Открытых пати пока нет — собери свою</p> : null}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="party-open"
                  role="switch"
                  aria-checked={!!mine}
                  disabled={busy === 'card' || safety.newAccount}
                  onClick={() => void (mine ? remove() : publish())}
                >
                  <span className={'tgl' + (mine ? ' on' : '')} aria-hidden="true" />
                  <span className="party-open-text">
                    <b>Открыть пати для всех</b>
                    <span>{safety.newAccount ? 'Доступно через неделю после регистрации' : mine ? 'Тебя видят в поиске' : 'Добирать игроков в пати'}</span>
                  </span>
                </button>
                {requests.map((r) => (
                  <div key={r.id} className="party-row">
                    <Head nick={r.from.nickname} src={r.from.avatarUrl} size={32} />
                    <span className="party-row-who">
                      <b>{r.from.nickname}</b>
                      <span>Хочет в пати</span>
                    </span>
                    <button className="btn sm ghost" aria-label="Пожаловаться" onClick={() => report(r.from.userId, r.from.nickname, r.id)}>
                      <Icon id="i-flag" />
                    </button>
                    <button className="btn sm ghost" aria-label="Отклонить" disabled={busy === r.id} onClick={() => void answer(r, false)}>
                      <Icon id="i-x" />
                    </button>
                    <button className="btn sm primary" disabled={busy === r.id} onClick={() => void answer(r, true)}>
                      <Icon id="i-check" />
                      Принять
                    </button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
