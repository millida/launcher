/**
 * Где сейчас живёт 3D-сцена лобби (LobbyKeeper): узел портала, место в лобби (LobbyFigure;
 * null — лобби закрыто) и показана ли фигура. Отдельный модуль без React: его читает
 * стартовая заглушка, а сама сцена с three.js грузится своим чанком.
 */
export const keep = {
  host: null as HTMLDivElement | null,
  slot: null as HTMLElement | null,
  shown: false,
  onShown: null as (() => void) | null,
  subs: new Set<() => void>(),
}

export const notify = () => keep.subs.forEach((f) => f())

export const subscribe = (f: () => void) => {
  keep.subs.add(f)
  return () => void keep.subs.delete(f)
}

export const inLobby = () => !!keep.slot

export const hostEl = () => {
  if (!keep.host) {
    keep.host = document.createElement('div')
    // Узел не создаёт своей коробки: .lobby-char стоит относительно лобби, как и без портала.
    keep.host.style.display = 'contents'
  }
  return keep.host
}

/** Сцена показала фигуру: заглушка лобби уходит, а следующий заход её уже не покажет. */
export const markShown = () => {
  keep.shown = true
  keep.onShown?.()
}

/** Показанной фигуры больше нет (сцена пересобирается): лобби возвращает заглушку. */
export const markHidden = () => {
  if (!keep.shown) return
  keep.shown = false
  notify()
}
