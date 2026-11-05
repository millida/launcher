import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useIdle3d } from '../../lib/lazy3d'
import { useGame } from '../../state/game'
import { Guard } from '../Guard'
import { hostEl, inLobby, keep, markHidden, markShown, notify, subscribe } from './lobbyKeep'

const LobbyCharacter = lazy(() => import('./LobbyCharacter').then((m) => ({ default: m.LobbyCharacter })))

/** Столько сцена ждёт возврата в лобби на паузе, потом освобождает видеопамять. */
const PARK_MS = 10 * 60_000

/**
 * Держит 3D-сцену лобби между заходами на главную (04.11.2026: «возврат к персонажу 2–3 секунды
 * без движения»). Экран лобби снимается при каждом переходе; сцена живёт здесь, в App, и рисуется
 * порталом в узел, который лобби (LobbyFigure) вставляет к себе. Вне лобби сцена на паузе —
 * кадров не рисует; снимается через PARK_MS без лобби или сразу, когда идёт игра, а лобби закрыто
 * (видеопамять нужна игре). Следующий заход тогда начнётся со снимка.
 *
 * Первая сцена собирается с запуска, даже если игрок сразу ушёл с главной (04.11.2026: «стоит
 * неподвижно секунд 5, если ещё на экран какой-нибудь зайти»): к возврату она готова. Снятую сцену
 * в фоне заново не собираем — только по возврату в лобби.
 */
export function LobbyKeeper() {
  const here = useSyncExternalStore(subscribe, inLobby, () => false)
  // Хранитель монтируется с первым заходом в лобби (components/hosts): ждём простоя и вне его.
  // Ложь и посреди сеанса: лаунчер сам перешёл на лёгкую графику (lib/slowLite) — сцену снимаем.
  const want3d = useIdle3d(true)
  const playing = useGame((s) => s.list.length > 0)
  const [kept, setKept] = useState(false)
  // Сцену уже снимали (долго без лобби, игра, сбой): новая — только по возврату в лобби.
  const [released, setReleased] = useState(false)
  // Сцена упала: новая попытка — со следующего входа в лобби, а не тут же по кругу.
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!here) setFailed(false)
  }, [here])
  useEffect(() => {
    if (!want3d || failed || kept) return
    if (here) {
      setReleased(false)
      setKept(true)
    } else if (!released && !playing) setKept(true)
  }, [want3d, here, failed, kept, released, playing])
  useEffect(() => {
    if (!kept || here) return
    const drop = () => {
      setReleased(true)
      setKept(false)
    }
    if (playing) return drop()
    const t = window.setTimeout(drop, PARK_MS)
    return () => window.clearTimeout(t)
  }, [kept, here, playing])
  const live = kept && want3d
  // Сцены нет — лобби снова нужна заглушка (LobbyFigure слушает keep).
  useEffect(() => {
    if (live || !keep.shown) return
    keep.shown = false
    notify()
  }, [live])
  const crashed = () => {
    // Упала в лобби — новая попытка со следующего входа; упала вне лобби — следующий вход и есть она.
    if (here) setFailed(true)
    setReleased(true)
    setKept(false)
    setAttempt((n) => n + 1)
  }
  if (!live) return null
  return createPortal(
    <Guard key={attempt} what="Персонаж лобби" silent onError={crashed}>
      <Suspense fallback={null}>
        <LobbyCharacter on={here} onShown={markShown} onHidden={markHidden} />
      </Suspense>
    </Guard>,
    hostEl(),
  )
}
