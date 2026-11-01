import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useHasMillida } from '../../state/auth'
import { getAccount } from '../../state/accounts'
import { setScreen } from '../../state/ui'
import { lobby3dAllowed, mark3dLoaded, useIdle3d } from '../../lib/lazy3d'
import { loadLookSkin } from '../../lib/lobbySkin'
import { keptLookSkin } from '../../lib/lookCache'
import { readLobbyStill, type LobbyStill } from '../../lib/lobbyStill'
import { FlatFigure } from '../character/FlatFigure'
import { noted } from '../../lib/noted'

/*
 * Персонаж лобби без заморозки на входе (26.10.2026). 3D-сцена тянет three.js и mine3d
 * (≈735 КБ) и собирает WebGL-контекст — по телеметрии это ≈190 тыс. долгих кадров в сутки
 * (293–412 мс). Теперь:
 *   1. первый кадр — снимок прошлой сцены того же размера (lib/lobbyStill), а если снимка
 *      нет — плоская фигурка скина;
 *   2. 3D-сцена (LobbyCharacter, отдельные чанки) подгружается после простоя и сменяет
 *      заглушку, когда фигура одета и показана;
 *   3. на слабом ПК (≤4 ГБ, ≤2 ядра, программная графика, упавший WebGL)
 *      three.js не грузится вообще — остаётся плоская фигурка, клик по ней ведёт в «Мой скин».
 */

const LobbyCharacter = lazy(() => import('./LobbyCharacter').then((m) => ({ default: m.LobbyCharacter })))

/** 3D выходит из прозрачности за 240 мс (.lobby-char): заглушку убираем после этого. */
const HANDOFF_MS = 320
/** Снимок годится, если сцена сейчас того же размера, что при съёмке (окно без рамки всегда 1200×760). */
const SAME_SIZE_PX = 3

export function LobbyFigure({ on }: { on: boolean }) {
  const signedIn = useHasMillida()
  const nick = (getAccount() || { nick: '' }).nick || 'MHF_Steve'
  const want3d = useIdle3d(on)
  const allowed = lobby3dAllowed()
  const [live, setLive] = useState(false)
  const [still, setStill] = useState<(LobbyStill & { url: string }) | null>(null)
  const [stillTried, setStillTried] = useState(false)
  // null — снимок ещё не померили (до первой отрисовки); для плоской фигурки это «подождать».
  const [fits, setFits] = useState<boolean | null>(null)
  const [flat, setFlat] = useState<{ skin: string; slim: boolean } | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // Снимок прошлой сцены (на слабом ПК его не бывает — сцены нет).
  useEffect(() => {
    if (!allowed) return setStillTried(true)
    let alive = true
    let url = ''
    void readLobbyStill().then((s) => {
      if (!alive) return
      setStillTried(true)
      if (!s) return
      url = URL.createObjectURL(s.blob)
      setStill({ ...s, url })
    })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [nick, allowed])

  // Снимок ложится только на сцену того же размера: иначе фигура вытянется, и 3D её «сдвинет».
  useLayoutEffect(() => {
    const el = box.current
    if (!still || !el) return setFits(null)
    setFits(Math.abs(el.clientWidth - still.w) <= SAME_SIZE_PX && Math.abs(el.clientHeight - still.h) <= SAME_SIZE_PX)
  }, [still])

  // Нет подходящего снимка — плоская фигурка по скину, пока не пришёл 3D (а на слабом ПК — насовсем).
  const needFlat = stillTried && !live && !(still && fits !== false)
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

  const goSkins = () => setScreen('skins')
  const handoff = () => {
    mark3dLoaded()
    window.setTimeout(() => setLive(true), HANDOFF_MS)
  }
  const stillOn = !!still && fits === true
  const flatOn = needFlat && !!flat

  return (
    <>
      {/* Заглушка: снимок сцены или плоская фигурка. Уходит, когда 3D показал фигуру. */}
      {!live && (still || flatOn) ? (
        <div ref={box} className={'lobby-char lobby-char-still shown' + (flatOn ? ' lobby-char-flat' : '')} onClick={goSkins}>
          {stillOn ? <img src={still!.url} alt="" draggable={false} /> : null}
          {flatOn && flat ? <FlatFigure url={flat.skin} slim={flat.slim} /> : null}
        </div>
      ) : null}
      {want3d ? (
        <Suspense fallback={null}>
          <LobbyCharacter on={on} onShown={handoff} />
        </Suspense>
      ) : null}
    </>
  )
}
