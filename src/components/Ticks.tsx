/**
 * Галочки статуса рисуются здесь, а не берутся из общего спрайта: там размер
 * задаёт `svg.icon`, и селектор с типом бьёт по специфичности любой класс —
 * галки молча вписывались в квадрат 16×16 с полями. Свои размеры и viewBox
 * стоят атрибутами, поэтому фигура не зависит ни от каскада, ни от темы.
 */
export function Ticks({ state, read }: { state?: 'sending' | 'failed'; read: boolean }) {
  const sending = state === 'sending'
  return (
    <svg
      className={'msg-tick' + (sending ? ' pending' : read ? ' read' : '')}
      width={sending ? 13 : 17}
      height={14}
      viewBox={sending ? '0 0 20 22' : '0 0 26 22'}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{sending ? 'Отправляется' : read ? 'Прочитано' : 'Доставлено'}</title>
      <path d={sending ? 'M3 12 8 17 18 6' : 'M2 12 7 17 17 6'} />
      {sending ? null : <path d="M11.8 17 21.8 6" />}
    </svg>
  )
}
