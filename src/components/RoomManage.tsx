import { useEffect, useMemo, useState } from 'react'
import { Icon } from './Icon'
import { Head } from './Head'
import { showToast } from '../state/ui'
import { uiConfirm } from '../state/confirm'
import { openRoomChat, useFriends } from '../state/friends'
import {
  createRoom,
  inviteToRoom,
  kickFromRoom,
  leaveRoom,
  renameRoom,
  useRooms,
  type Room,
} from '../state/rooms'
import { apiErrorText } from '../lib/apiError'
import { useT } from '../i18n'

/** Тот же потолок, что и на сервере: список друзей не должен предлагать больше. */
const MAX_MEMBERS = 10

function FriendPicker({
  chosen,
  disabled,
  onToggle,
}: {
  chosen: string[]
  disabled: string[]
  onToggle: (userId: string) => void
}) {
  const t = useT()
  const friends = useFriends((s) => s.friends)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const list = useMemo(
    () =>
      friends
        .filter((f) => !needle || (f.nickname || '').toLowerCase().includes(needle))
        .slice(0, 40),
    [friends, needle],
  )
  if (!friends.length) {
    return <p className="faint-note">{t('Сначала добавь друзей')}</p>
  }
  return (
    <>
      {friends.length > 6 ? (
        <div className="input sm room-pick-search">
          <Icon id="i-search" />
          <input placeholder={t('Найти друга…')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      ) : null}
      <div className="room-pick">
        {list.map((f) => {
          const off = disabled.includes(f.userId)
          const on = chosen.includes(f.userId)
          return (
            <button
              key={f.userId}
              className={'room-pick-row' + (on ? ' on' : '') + (off ? ' off' : '')}
              disabled={off}
              onClick={() => onToggle(f.userId)}
            >
              <Head nick={f.nickname} size={28} />
              <span className="room-pick-nick">{f.nickname || ''}</span>
              {off ? (
                <span className="room-pick-note">{t('уже в группе')}</span>
              ) : (
                <Icon id={on ? 'i-check' : 'i-plus'} />
              )}
            </button>
          )
        })}
        {!list.length ? <p className="faint-note">{t('Никого не нашли')}</p> : null}
      </div>
    </>
  )
}

/** Создание группы: имя и кого позвать — больше на старте ничего не нужно. */
function RoomCreate({ close, onCreated }: { close: () => void; onCreated?: (room: Room) => void }) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const name = title.trim()
    if (!name) {
      showToast(t('Придумай название группы'), 'error')
      return
    }
    setBusy(true)
    try {
      const room = await createRoom(name, chosen)
      close()
      if (onCreated) onCreated(room)
    } catch (e) {
      showToast(apiErrorText(e, t('Не удалось создать группу')), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="room-modal-back" onClick={close}>
      <div className="room-modal" data-private data-section="room" onClick={(e) => e.stopPropagation()}>
        <div className="room-modal-head">
          <span className="room-ava">
            <Icon id="i-users" />
          </span>
          <b>{t('Новая группа')}</b>
          <button className="tb-btn" aria-label={t('Закрыть')} onClick={close}>
            <Icon id="i-x" />
          </button>
        </div>
        <div className="input sm">
          <input
            autoFocus
            placeholder={t('Название группы')}
            maxLength={48}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </div>
        <div className="side-cap">{t('Кого позвать · {n} из {max}', { n: chosen.length + 1, max: MAX_MEMBERS })}</div>
        <FriendPicker
          chosen={chosen}
          disabled={[]}
          onToggle={(id) =>
            setChosen((prev) => {
              if (prev.includes(id)) return prev.filter((x) => x !== id)
              if (prev.length + 1 >= MAX_MEMBERS) {
                showToast(t('В группе не больше {n} человек', { n: MAX_MEMBERS }), 'error')
                return prev
              }
              return prev.concat([id])
            })
          }
        />
        <div className="room-modal-acts">
          <button className="btn sm ghost" onClick={close}>
            {t('Отмена')}
          </button>
          <button className="btn sm primary" disabled={busy || !title.trim()} onClick={() => void submit()}>
            <Icon id="i-check" />
            {busy ? t('Создаём…') : t('Создать')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Состав группы: кто внутри, кого позвать, кого убрать и как выйти самому. */
function RoomManage({ room, close }: { room: Room; close: () => void }) {
  const t = useT()
  const me = useRooms((s) => s.me)
  const fresh = useRooms((s) => s.rooms.find((r) => r.id === room.id)) || room
  const owner = fresh.ownerId === me
  const [title, setTitle] = useState(fresh.title)
  const [busy, setBusy] = useState(false)
  const setChat = useFriends((s) => s.set)

  useEffect(() => setTitle(fresh.title), [fresh.title])

  const rename = async () => {
    const next = title.trim()
    if (!next || next === fresh.title) return
    setBusy(true)
    try {
      await renameRoom(fresh.id, next)
      setChat({ chatNick: next })
      showToast(t('Группа переименована'))
    } catch {
      showToast(t('Не удалось переименовать'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const invite = async (userId: string) => {
    setBusy(true)
    try {
      await inviteToRoom(fresh.id, [userId])
    } catch (e) {
      showToast(apiErrorText(e, t('Не удалось позвать')), 'error')
    } finally {
      setBusy(false)
    }
  }

  const kick = async (userId: string, nick: string) => {
    if (!(await uiConfirm(t('Убрать {nick} из группы?', { nick }), { confirmLabel: t('Убрать'), danger: true }))) return
    try {
      await kickFromRoom(fresh.id, userId)
    } catch {
      showToast(t('Не удалось убрать'), 'error')
    }
  }

  const quit = async () => {
    const ok = await uiConfirm(
      owner
        ? t('Группа перейдёт к тому, кто в ней дольше всех.')
        : t('Переписка группы останется у остальных.'),
      { title: t('Выйти из «{name}»?', { name: fresh.title }), confirmLabel: t('Выйти'), danger: true },
    )
    if (!ok) return
    try {
      await leaveRoom(fresh.id)
      setChat({ chatOpen: false, chatRoom: '' })
      close()
      showToast(t('Ты вышел из группы'))
    } catch {
      showToast(t('Не удалось выйти'), 'error')
    }
  }

  const inVoice = new Set((fresh.voice || []).map((v) => v.userId))

  return (
    <div className="room-modal-back" onClick={close}>
      <div className="room-modal" data-private data-section="room" onClick={(e) => e.stopPropagation()}>
        <div className="room-modal-head">
          <span className="room-ava">
            <Icon id="i-users" />
          </span>
          <b>{fresh.title}</b>
          <button className="tb-btn" aria-label={t('Закрыть')} onClick={close}>
            <Icon id="i-x" />
          </button>
        </div>

        {owner ? (
          <div className="room-rename">
            <div className="input sm">
              <input
                value={title}
                maxLength={48}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void rename()
                }}
              />
            </div>
            <button
              className="btn sm secondary"
              aria-label={t('Переименовать')}
              disabled={busy || !title.trim() || title.trim() === fresh.title}
              onClick={() => void rename()}
            >
              <Icon id="i-check" />
            </button>
          </div>
        ) : null}

        <div className="side-cap">{t('Участники · {n}', { n: fresh.members.length })}</div>
        <div className="room-members">
          {fresh.members.map((m) => (
            <div className="room-member" key={m.userId}>
              <Head nick={m.nickname} size={30} />
              <span className="room-member-nick">
                {m.nickname}
                {m.userId === me ? <span className="room-tag">{t('ты')}</span> : null}
                {m.role === 'owner' ? <span className="room-tag own">{t('создатель')}</span> : null}
              </span>
              {inVoice.has(m.userId) ? (
                <span className="room-inv" aria-label={t('Сейчас в разговоре')}>
                  <Icon id="i-headset" />
                </span>
              ) : null}
              {owner && m.userId !== me ? (
                <button
                  className="tb-btn danger"
                  aria-label={t('Убрать из группы')}
                  onClick={() => void kick(m.userId, m.nickname)}
                >
                  <Icon id="i-x" />
                </button>
              ) : null}
            </div>
          ))}
        </div>

        {fresh.members.length < MAX_MEMBERS ? (
          <>
            <div className="side-cap">{t('Позвать друга')}</div>
            <FriendPicker
              chosen={[]}
              disabled={fresh.members.map((m) => m.userId)}
              onToggle={(id) => void invite(id)}
            />
          </>
        ) : (
          <p className="faint-note">{t('Группа заполнена')}</p>
        )}

        <div className="room-modal-acts">
          <button className="btn sm danger" onClick={() => void quit()}>
            <Icon id="i-logout" />
            {t('Выйти из группы')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Окна групп монтируются в корне приложения: панель переписки сдвигается
 * трансформацией, и окно внутри неё считало бы «весь экран» от самой панели.
 */
export function RoomModals() {
  const manageId = useRooms((s) => s.manageId)
  const createOpen = useRooms((s) => s.createOpen)
  const room = useRooms((s) => s.rooms.find((r) => r.id === s.manageId))
  const set = useRooms((s) => s.set)
  const openRoom = useFriends((s) => s.set)

  useEffect(() => {
    if (!manageId && !createOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') set({ manageId: '', createOpen: false })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [manageId, createOpen, set])

  return (
    <>
      {createOpen ? (
        <RoomCreate
          close={() => set({ createOpen: false })}
          onCreated={(room) => {
            void openRoomChat(room.id, room.title)
            openRoom({ chatOpen: true })
          }}
        />
      ) : null}
      {manageId && room ? <RoomManage room={room} close={() => set({ manageId: '' })} /> : null}
    </>
  )
}
