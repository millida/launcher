import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useHasMillida } from '../../state/auth'
import { getAccount, useAccounts } from '../../state/accounts'
import { setScreen } from '../../state/ui'
import { MAX_WAIT_MS, lobby3dAllowed, mark3dLoaded, preloadQuietMs } from '../../lib/lazy3d'
import { whenIdle } from '../../lib/idle'
import { loadLookSkin } from '../../lib/lobbySkin'
import { keptLookSkin } from '../../lib/lookCache'
import { readLobbyStill, stageGeom, stillPlacement, type LobbyStill, type StillPlace } from '../../lib/lobbyStill'
import { FlatStand } from './FlatStand'
import { hostEl, keep, notify, subscribe } from './lobbyKeep'
import { noted } from '../../lib/noted'
import { loadMine3d } from '../../lib/mine3d'

/*
 * Персонаж лобби без заморозки на входе (26.10.2026). 3D-сцена тянет three.js и mine3d
 * (≈735 КБ) и собирает WebGL-контекст — по телеметрии это ≈190 тыс. долгих кадров в сутки
 * (293–412 мс). Теперь:
 *   1. первый кадр — снимок прошлой сцены, подогнанный под нынешний размер окна
 *      (lib/lobbyStill), а если снимка нет — плоская фигурка скина на месте 3D-фигуры;
 *   2. 3D-сцена (LobbyCharacter, отдельные чанки) подгружается после простоя и проявляется
 *      поверх, когда фигура одета и показана; снимок уходит под ней, плоская фигурка тает навстречу;
 *   3. на слабом ПК (≤4 ГБ, ≤2 ядра, программная графика, упавший WebGL)
 *      three.js не грузится вообще — остаётся плоская фигурка, клик по ней ведёт в «Мой скин».
 *
 * Сцена переживает уход с главной (04.11.2026: «возврат к персонажу 2–3 секунды без движения»).
 * Экран лобби снимается при каждом переходе, и раньше с ним снималась сцена: возврат заново
 * создавал контекст WebGL, компилировал шейдеры и одевал фигуру, а заглушка всё это время
 * стояла картинкой. Теперь LobbyCharacter живёт в LobbyKeeper (App, вне экранов) и рисуется
 * порталом в свой узел (lobbyKeep); лобби вставляет узел к себе, уходя — откладывает.
 */

/** 3D выходит из прозрачности за 240 мс (.lobby-char): заглушку убираем после этого. */
const HANDOFF_MS = 320

export function LobbyFigure() {
  const signedIn = useHasMillida()
  // Сессия поднимается после первого кадра: без подписки снимок искался бы у гостя.
  const activeId = useAccounts((s) => s.active)
  const nick = (getAccount() || { nick: '' }).nick || 'MHF_Steve'
  const allowed = lobby3dAllowed()
  // Сцена уже показана в прошлый заход и ждала на паузе — заглушка не нужна.
  const [live, setLive] = useState(() => keep.shown)
  const [still, setStill] = useState<(LobbyStill & { url: string }) | null>(null)
  const [stillTried, setStillTried] = useState(false)
  // undefined — снимок ещё не померили (до первой отрисовки); null — на этот размер окна он не ляжет.
  const [place, setPlace] = useState<StillPlace | null | undefined>(undefined)
  const [leaving, setLeaving] = useState(false)
  const [flat, setFlat] = useState<{ skin: string; slim: boolean } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const slot = useRef<HTMLSpanElement>(null)
  // Сцену сняли, пока лобби открыто (сбой, лёгкая графика) — заглушка возвращается со свежим снимком.
  const [round, setRound] = useState(0)
  const liveRef = useRef(live)
  liveRef.current = live
  // Таймер ухода заглушки (handoff): фигура пропала в эти 320 мс — заглушка остаётся.
  const handoffTimer = useRef(0)
  useEffect(
    () =>
      subscribe(() => {
        if (keep.shown) return
        window.clearTimeout(handoffTimer.current)
        setLeaving(false)
        if (!liveRef.current) return
        setLive(false)
        setRound((n) => n + 1)
      }),
    [],
  )

  // Сцена из LobbyKeeper встаёт сюда, уходя из лобби — откладывается (холст и контекст WebGL целы).
  useLayoutEffect(() => {
    const el = slot.current
    if (!el) return
    el.appendChild(hostEl())
    keep.slot = el
    notify()
    return () => {
      if (keep.slot !== el) return
      keep.slot = null
      keep.host?.remove()
      notify()
    }
  }, [])

  // Код 3D и образ — с первого кадра лобби, а не после простоя: когда сцене разрешат собраться
  // (lib/lazy3d), ждать останется только WebGL. Повтор с теми же ником и входом ничего не делает.
  useEffect(() => {
    if (!allowed || keep.shown) return
    const preload = () => {
      loadMine3d().catch(noted('lobby-preload'))
      import('./LobbyCharacter').then((m) => m.prefetchLobbyLook(nick, signedIn), noted('lobby-preload'))
    }
    const quiet = preloadQuietMs()
    if (quiet !== null) return whenIdle(preload, quiet, MAX_WAIT_MS)
    const raf = requestAnimationFrame(preload)
    return () => cancelAnimationFrame(raf)
  }, [allowed, nick, signedIn])

  // Снимок прошлой сцены (на слабом ПК его не бывает — сцены нет).
  useEffect(() => {
    if (!allowed || keep.shown) return setStillTried(true)
    let alive = true
    let url = ''
    void readLobbyStill().then((s) => {
      if (!alive) return
      setStillTried(true)
      if (!s) return setStill(null)
      url = URL.createObjectURL(s.blob)
      setStill({ ...s, url })
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [nick, activeId, allowed, round])

  // Снимок подгоняется под нынешнюю сцену и следует за размером окна: ноги и рост фигуры те же,
  // что встанут в 3D, даже если окно растянули, пока грузится сцена.
  useLayoutEffect(() => {
    const el = box.current
    if (!still || !el) return setPlace(undefined)
    const measure = () => setPlace(stillPlacement(still, stageGeom(el)))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [still])

  // Нет подходящего снимка — плоская фигурка по скину, пока не пришёл 3D (а на слабом ПК — насовсем).
  const needFlat = stillTried && !live && !(still && place !== null)
  useEffect(() => {
    if (!needFlat || flat) return
    let alive = true
    void keptLookSkin(nick)
      .then((kept) => kept ?? loadLookSkin(nick, signedIn))
      .then((l) => alive && setFlat({ skin: l.skin, slim: l.slim }))
      .catch(noted('lobby-figure'))
    return () => {
      alive = false
    }
  }, [needFlat, nick, signedIn, flat])

  // Сцена сообщает о показе через LobbyKeeper: заглушка этого захода уходит.
  useEffect(() => {
    const handoff = () => {
      mark3dLoaded()
      setLeaving(true)
      window.clearTimeout(handoffTimer.current)
      handoffTimer.current = window.setTimeout(() => setLive(true), HANDOFF_MS)
    }
    keep.onShown = handoff
    return () => {
      if (keep.onShown === handoff) keep.onShown = null
      window.clearTimeout(handoffTimer.current)
    }
  }, [])

  const goSkins = () => setScreen('skins')
  const stillOn = !!still && !!place
  const flatOn = needFlat && !!flat

  return (
    <>
      {/* Заглушка: снимок сцены или плоская фигурка. Уходит, когда 3D показал фигуру: снимок — под
          проявившимся 3D (картинка та же, просвета нет), плоская фигурка — тает навстречу. */}
      {!live && (still || flatOn) ? (
        <div ref={box} className={'lobby-char lobby-char-still shown' + (flatOn ? ' standin-flat' : '') + (leaving ? ' leaving' : '')} onClick={goSkins}>
          {stillOn ? (
            <img src={still!.url} alt="" draggable={false} style={{ left: place!.left, top: place!.top, width: place!.width, height: place!.height }} />
          ) : null}
          {flatOn && flat ? <FlatStand url={flat.skin} slim={flat.slim} /> : null}
        </div>
      ) : null}
      {/* Место 3D-сцены (LobbyKeeper): после заглушки, чтобы проявляться поверх неё. */}
      <span ref={slot} style={{ display: 'contents' }} />
    </>
  )
}
