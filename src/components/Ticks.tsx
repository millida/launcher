/**
 * Галочки статуса сообщения — пиксельные, как все значки лаунчера (приказ
 * владельца 23.09.2026). Рисуются здесь, а не берутся из общего спрайта: там
 * размер задаёт `svg.icon`, и галки вписывались бы в квадрат с полями.
 * Сетка 12×6 клеток, одна клетка = 1,5 px (на Retina ровно 3 пикселя экрана).
 */
const ONE = ['.......c', '......cc', 'c....cc.', 'cc..cc..', '.cccc...', '..cc....']
const TWO = ['.......c...c', '......cc..cc', 'c....cc..cc.', 'cc..cc..cc..', '.cccc..cc...', '..cc..cc....']

function rows(art: string[]) {
  const out: { x: number; y: number; w: number }[] = []
  art.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      if (r[x] !== 'c') continue
      let e = x
      while (r[e + 1] === 'c') e++
      out.push({ x, y, w: e - x + 1 })
      x = e
    }
  })
  return out
}

export function Ticks({ state, read }: { state?: 'sending' | 'failed'; read: boolean }) {
  const sending = state === 'sending'
  const art = sending ? ONE : TWO
  return (
    <svg
      className={'msg-tick' + (sending ? ' pending' : read ? ' read' : '')}
      width={art[0].length * 1.5}
      height={9}
      viewBox={'0 0 ' + art[0].length + ' 6'}
      shapeRendering="crispEdges"
    >
      <title>{sending ? 'Отправляется' : read ? 'Прочитано' : 'Доставлено'}</title>
      {rows(art).map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill="currentColor" />
      ))}
    </svg>
  )
}
