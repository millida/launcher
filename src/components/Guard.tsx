import { Component, type ReactNode } from 'react'
import { track } from '../lib/telemetry'

/**
 * Ловит падение куска интерфейса.
 *
 * Без неё любая ошибка в отрисовке гасит всё окно: React снимает дерево, и
 * человек видит серый прямоугольник без единой подсказки, что случилось. Здесь
 * же остаётся окно, а на месте сломанного куска - причина и кнопка вернуться.
 */
export class Guard extends Component<
  { children: ReactNode; what: string; silent?: boolean },
  { failed: string | null }
> {
  state: { failed: string | null } = { failed: null }

  static getDerivedStateFromError(error: unknown) {
    return { failed: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown) {
    console.error('Сломался кусок интерфейса: ' + this.props.what, error)
    // Сбой блока виден нам, а не только игроку (владелец 25.09.2026: «логировать всё»).
    try {
      track('error', { where: 'ui_block', block: this.props.what.slice(0, 40), code: String(error instanceof Error ? error.message : error).slice(0, 160) }, { ok: false })
    } catch {}
  }

  render() {
    if (this.state.failed === null) return this.props.children
    // Блок внутри экрана: сломанный кусок просто пропадает, экран живёт.
    if (this.props.silent) return null
    return (
      <div className="card" style={{ display: 'grid', gap: '10px' }}>
        <b>{this.props.what} не открылся</b>
        <span className="side-cap">{this.state.failed}</span>
        <button className="btn sm secondary" onClick={() => this.setState({ failed: null })}>
          Попробовать снова
        </button>
      </div>
    )
  }
}
