import { Icon } from './Icon'
import { joinRoomVoice } from '../state/call'
import type { Room } from '../state/rooms'

/**
 * Кнопка разговора группы — та же кнопка, что и звонок другу: значок трубки без
 * подписи. Отличие одно: разговор в комнате идёт сам по себе, поэтому на кнопке
 * появляется число тех, кто уже внутри.
 */
export function RoomCallButton({
  room,
  here,
  busy,
  row,
}: {
  room: Room
  here: boolean
  busy: boolean
  /// В списке кнопки крупнее, в шапке переписки — мельче. Классы берутся оттуда
  /// же, откуда их берёт звонок другу, чтобы группа не выглядела чужой в ряду.
  row?: boolean
}) {
  const inside = room.voice || []
  return (
    <button
      className={
        (row ? 'btn sm secondary' : 'tb-btn') + ' call-start room-call' + (inside.length ? ' live' : '')
      }
      title={
        here
          ? 'Ты в разговоре'
          : inside.length
            ? 'Зайти в разговор · ' + inside.length + ' чел.'
            : 'Начать разговор группы'
      }
      disabled={here || busy}
      onClick={() => void joinRoomVoice(room.id, room.title)}
    >
      <Icon id={inside.length ? 'i-headset' : 'i-phone'} />
      {inside.length ? <span className="room-call-n">{inside.length}</span> : null}
    </button>
  )
}
