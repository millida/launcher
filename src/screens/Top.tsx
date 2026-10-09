import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Icon } from '../components/Icon'
import { Head } from '../components/Head'
import { StreakFire } from '../components/friends/StreakFire'
import { BOARDS, boardValueText, useBoards, type Board, type BoardEntry } from '../state/boards'
import { useFriendStreaks } from '../state/friendStreaks'
import { useFriends } from '../state/friends'
import { hasMillidaAccount } from '../lib/api'
import { addFriend, friendIdOf, likeEntry, writeTo } from '../components/top/topActions'
import { PodiumScene } from '../components/top/PodiumScene'
import { useDaily } from '../state/daily'
import { plural } from '../lib/format'
import '../styles/pixel/retention.css'

const bodyUrl = (nick: string, size = 128) =>
  'https://api.millida.net/v2/heads/body/' + encodeURIComponent(nick || 'Steve') + '?size=' + size + '&safe=1'

/** Голова в строке топа — тоже через фильтр скинов. */
const avatarUrl = (nick: string) => 'https://api.millida.net/v2/heads/avatar/' + encodeURIComponent(nick || 'Steve') + '?size=112&safe=1'

function Value({ board, v }: { board: Board; v: number }) {
  return (
    <b className="tb-val">
      <Icon id={board === 'streak' ? 'i-flame' : 'i-clock'} />
      {boardValueText(board, v)}
    </b>
  )
}

function Actions({ e, mine }: { e: BoardEntry; mine: boolean }) {
  const [liked, setLiked] = useState(false)
  if (mine) return <span className="tb-acts" />
  return (
    <span className="tb-acts" onClick={(ev) => ev.stopPropagation()}>
      <button
        className={'tb-act tb-like' + (liked ? ' on' : '')}
        data-track="top_like"
        aria-label="Нравится"
        disabled={!e.slug || liked}
        onClick={() => void likeEntry(e).then((ok) => ok && setLiked(true))}
      >
        <Icon id="i-heart" />
        <span>{e.likes}</span>
      </button>
      {e.isFriend ? (
        <button className="tb-act" data-track="top_write" aria-label="Написать" onClick={() => writeTo(e)}>
          <Icon id="i-msg" />
        </button>
      ) : (
        <button className="tb-act tb-add" data-track="top_add" aria-label="В друзья" onClick={() => addFriend(e)}>
          <Icon id="i-plus" />
        </button>
      )}
    </span>
  )
}

function ShieldLine() {
  const max = useDaily((s) => s.status?.shieldsMax ?? 0)
  if (!max) return null
  return (
    <span className="tb-shield">
      <Icon id="i-shield" />
      {'Щит: ' + max + ' ' + plural(max, 'пропуск', 'пропуска', 'пропусков') + ' в неделю'}
    </span>
  )
}

function Row({ board, e, mine, pinned, onOpen }: { board: Board; e: BoardEntry; mine: boolean; pinned?: boolean; onOpen: () => void }) {
  const fire = useFriendStreaks((s) => {
    const id = e.isFriend ? friendIdOf(e.nick) : null
    return id ? s.byId[id] : undefined
  })
  return (
    <div
      className={'tb-row' + (mine ? ' me' : '') + (e.isFriend ? ' friend' : '') + (pinned ? ' pinned' : '')}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => (ev.key === 'Enter' ? onOpen() : undefined)}
    >
      <span className="tb-rank" style={{ '--digits': String(e.rank).length } as CSSProperties}>
        {e.rank}
      </span>
      <Head nick={e.nick} size={56} className="tb-head" src={avatarUrl(e.nick)} />
      <span className="fr-body">
        <span className="fr-nick">
          {e.nick}
          {board === 'streak' ? null : <StreakFire n={fire} />}
        </span>
        {pinned && board === 'streak' ? <ShieldLine /> : null}
      </span>
      <Value board={board} v={e.value} />
      <Actions e={e} mine={mine} />
    </div>
  )
}

function Podium({ board, items, onOpen }: { board: Board; items: BoardEntry[]; onOpen: (e: BoardEntry) => void }) {
  const order = [items[1], items[0], items[2]].filter((x): x is BoardEntry => !!x)
  return (
    <div className="tb-podium">
      {order.map((e) => (
        <button key={e.rank} className={'tb-step p' + e.rank + (e.isFriend ? ' friend' : '')} data-track="top_podium" onClick={() => onOpen(e)}>
          <img className="tb-rig" src={bodyUrl(e.nick, 160)} alt="" draggable={false} loading="lazy" />
          <span className="tb-block">
            <span className="tb-place">
              <Icon id="i-trophy" />
              {e.rank}
            </span>
            <b className="tb-nick">{e.nick}</b>
            <Value board={board} v={e.value} />
          </span>
        </button>
      ))}
    </div>
  )
}

function Card({ board, e, mine, onClose }: { board: Board; e: BoardEntry; mine: boolean; onClose: () => void }) {
  return (
    <div className="modal-bg open vis" onMouseDown={(ev) => ev.target === ev.currentTarget && onClose()}>
      <div className="modal tb-card" role="dialog" aria-label={e.nick}>
        <button className="tb-card-x" aria-label="Закрыть" onClick={onClose}>
          <Icon id="i-x" />
        </button>
        <img className="tb-card-rig" src={bodyUrl(e.nick, 192)} alt="" draggable={false} />
        <b className="tb-card-nick">{e.nick}</b>
        <span className="tb-card-stat">
          <span className="tb-rank">{'#' + e.rank}</span>
          <Value board={board} v={e.value} />
        </span>
        <Actions e={e} mine={mine} />
      </div>
    </div>
  )
}

function MoreCue({ count }: { count: number }) {
  const anchor = useRef<HTMLDivElement>(null)
  const [away, setAway] = useState(false)

  useEffect(() => {
    const el = anchor.current
    if (!el) return
    const io = new IntersectionObserver(([en]) => setAway(!!en && (en.isIntersecting || en.boundingClientRect.top < 0)), {
      rootMargin: '0px 0px -50% 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <>
      <button
        className={'tb-more' + (away ? ' away' : '')}
        data-track="top_more"
        tabIndex={away ? -1 : 0}
        aria-hidden={away}
        onClick={() => anchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      >
        {'Ещё ' + count + ' ' + plural(count, 'место', 'места', 'мест')}
        <Icon id="i-chev-d" />
      </button>
      <div className="tb-rest-anchor" ref={anchor} />
    </>
  )
}

const Skeleton = () => (
  <>
    <div className="tb-scene skel" aria-hidden="true" />
    {Array.from({ length: 5 }, (_, i) => (
      <div className="tb-row" key={i} aria-hidden="true">
        <span className="skel top-skel-rank" />
        <span className="skel tb-head" />
        <span className="fr-body">
          <span className="skel top-skel-line" />
        </span>
      </div>
    ))}
  </>
)

/**
 * Доски лаунчера (владелец 06.10.2026): неделя, месяц, всё время и огоньки —
 * серия дней. Своё место закреплено снизу, друзья подсвечены, тройка — на
 * пьедестале фигурами. Строка открывает карточку; «♥», «В друзья», «Написать».
 */
export function Top({ on }: { on: boolean }) {
  const board = useBoards((s) => s.board)
  const view = useBoards((s) => s.views[board])
  const failed = useBoards((s) => !!s.failed[board])
  const [open, setOpen] = useState<BoardEntry | null>(null)
  const [flat, setFlat] = useState(false)
  // Сцена могла упасть в плоские фигуры на одной доске — на другой пробуем 3D заново.
  useEffect(() => setFlat(false), [board])
  const lastHours = useRef<Board>('week')
  if (board !== 'streak') lastHours.current = board
  useFriends((s) => s.friends.length)

  useEffect(() => {
    if (!on) return
    void useBoards.getState().load(board)
    void useFriendStreaks.getState().load()
  }, [on, board])

  const me = view?.me ?? null
  const mine = (e: BoardEntry) => !!me && e.rank === me.rank
  const rest = view ? view.items.slice(3) : []

  return (
    <section className={'screen' + (on ? ' on' : '') + (board === 'streak' ? ' theme-fire' : ' theme-time')} id="s-top">
      <div className="page-head tb-head-line">
        <span className="tb-theme-ic" aria-hidden="true">
          <Icon id={board === 'streak' ? 'i-flame' : 'i-clock'} />
        </span>
        <h1>Топ</h1>
      </div>
      {/* Два разных топа (07.10.2026): часы в игре — с периодом, огоньки — серия дней, без периода. */}
      <div className="segs tb-kinds" role="tablist" aria-label="Топ">
        <button role="tab" aria-selected={board !== 'streak'} className={'seg' + (board !== 'streak' ? ' on' : '')} data-track="top_kind_hours" onClick={() => board === 'streak' && useBoards.getState().setBoard(lastHours.current)}>
          <Icon id="i-clock" />
          Часы в игре
        </button>
        <button role="tab" aria-selected={board === 'streak'} className={'seg' + (board === 'streak' ? ' on' : '')} data-track="top_kind_streak" onClick={() => useBoards.getState().setBoard('streak')}>
          <Icon id="i-flame" />
          Огоньки
        </button>
      </div>
      {/* Своё место — компактной плашкой справа от переключателей, не строкой поверх списка (07.10.2026). */}
      {me ? (
        <button className="tb-mine" data-track="top_me" onClick={() => setOpen(me)}>
          <span className="tb-mine-cap">Ты</span>
          <b className="tb-mine-rank">{'#' + me.rank}</b>
          <Value board={board} v={me.value} />
        </button>
      ) : null}
      {board === 'streak' && me ? (
        <div className="tb-shield-line">
          <ShieldLine />
        </div>
      ) : null}
      {board !== 'streak' ? (
        <div className="segs tb-boards" role="tablist" aria-label="Период">
          {BOARDS.filter((b) => b.key !== 'streak').map((b) => (
            <button
              key={b.key}
              role="tab"
              aria-selected={board === b.key}
              className={'seg' + (board === b.key ? ' on' : '')}
              data-track={'top_board_' + b.key}
              onClick={() => useBoards.getState().setBoard(b.key)}
            >
              {b.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="stack tb-list">
        {!view ? (
          failed ? (
            <div className="fr-blank">
              <Icon id="i-trophy" />
              <b>Топ не загрузился</b>
              <button className="btn sm secondary" data-track="top_retry" onClick={() => void useBoards.getState().load(board, true)}>
                <Icon id="i-restart" />
                Повторить
              </button>
            </div>
          ) : (
            <Skeleton />
          )
        ) : (
          <>
            {!me && hasMillidaAccount() ? <div className="tb-none">{board === 'streak' ? 'Зайди завтра — зажжёшь огонь' : 'Сыграй — попадёшь в топ'}</div> : null}
            {view.items.length ? (
              flat ? (
                <Podium board={board} items={view.items.slice(0, 3)} onOpen={setOpen} />
              ) : (
                <PodiumScene board={board} items={view.items.slice(0, 3)} onOpen={setOpen} onFail={() => setFlat(true)} />
              )
            ) : (
              <div className="fr-blank">
                <Icon id="i-trophy" />
                <b>Пока пусто</b>
              </div>
            )}
            {rest.length ? <MoreCue key={board} count={rest.length} /> : null}
            {rest.map((e) => (
              <Row key={e.rank} board={board} e={e} mine={mine(e)} onOpen={() => setOpen(e)} />
            ))}

          </>
        )}
      </div>
      {/* В body: внутри экрана окно уезжало вниз страницы, а оставался только тёмный фон (09.10.2026). */}
      {open ? createPortal(<Card board={board} e={open} mine={mine(open)} onClose={() => setOpen(null)} />, document.body) : null}
    </section>
  )
}
