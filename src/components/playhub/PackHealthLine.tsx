import { useEffect, useState } from 'react'
import { FeedbackModal } from '../Feedback'
import { healthLine, loadPackHealth } from '../../lib/packHealth'
import type { PackHealth } from '../../lib/packHealth'

/**
 * «Работает · запускали 2 ч назад · 97% запусков без ошибок» под кнопкой
 * сборки. Когда доля удачных запусков ниже порога — предупреждение и
 * «Сообщить о проблеме» с уже подписанной сборкой. Нет данных — нет строки.
 */
export function PackHealthLine({ slug, title }: { slug: string; title: string }) {
  const [health, setHealth] = useState<PackHealth | null>(null)
  const [report, setReport] = useState(false)

  useEffect(() => {
    let alive = true
    setHealth(null)
    if (slug) void loadPackHealth(slug).then((h) => alive && setHealth(h))
    return () => {
      alive = false
    }
  }, [slug])

  const line = healthLine(health)
  if (!line) return null
  return (
    <div className={'pp-health ' + line.tone} data-section="pack_health" data-id={slug}>
      <span className="pp-health-row">
        <span className="ph-dot" aria-hidden="true"></span>
        <b>{line.head}</b>
        {line.when ? <span className="pp-health-when">{line.when}</span> : null}
      </span>
      {line.pct !== null ? (
        <span className="pp-health-pct">
          <b>{line.pct}%</b> запусков без ошибок
        </span>
      ) : null}
      {line.report ? (
        <button className="btn sm ghost pp-health-report" data-track="pack_report" data-src="pack_page" onClick={() => setReport(true)}>
          Сообщить о проблеме
        </button>
      ) : null}
      {report ? (
        <FeedbackModal onClose={() => setReport(false)} kind="game_launch" about={'Сборка «' + title + '» (' + slug + ')'} />
      ) : null}
    </div>
  )
}
