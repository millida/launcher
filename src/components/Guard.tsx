import { Component, type ReactNode } from 'react'

/**
 * Ловит падение куска интерфейса.
 *
 * Без неё любая ошибка в отрисовке гасит всё окно: React снимает дерево, и
 * человек видит серый прямоугольник без единой подсказки, что случилось. Здесь
 * же остаётся окно, а на месте сломанного куска - причина и кнопка вернуться.
 */
export class Guard extends Component<
  { children: ReactNode; what: string },
  { failed: string | null }
> {
  state: { failed: string | null } = { failed: null }

  static getDerivedStateFromError(error: unknown) {
    return { failed: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown) {
    console.error('Сломался кусок интерфейса: ' + this.props.what, error)
  }

  render() {
    if (this.state.failed === null) return this.props.children
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
