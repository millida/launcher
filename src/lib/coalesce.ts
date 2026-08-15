/**
 * Один запрос вместо трёх. Список друзей просят разом вход, оболочка и сам
 * экран — все в один кадр, и сервер получал три одинаковых запроса подряд.
 * Пока ответ ещё летит, повторный вызов ждёт его же; после ответа следующий
 * вызов идёт на сервер как обычно, поэтому обновление после действия
 * (удалил друга, принял заявку) не теряется.
 */
export function coalesce<T>(load: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null
  return () => {
    if (inflight) return inflight
    const run = load().finally(() => {
      if (inflight === run) inflight = null
    })
    inflight = run
    return run
  }
}
