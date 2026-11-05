import { useLayoutEffect, useRef, useState } from 'react'
import { lobbyFigureBox } from '../../lib/lobbyFrame'
import { stageGeom } from '../../lib/lobbyStill'
import { FlatFigure } from '../character/FlatFigure'

/**
 * Плоская фигурка скина ровно там, где встанет 3D: ноги на той же линии, рост тот же
 * (lib/lobbyFrame). Иначе смена заглушки на 3D (LobbyFigure) или 3D на лёгкую графику
 * (LobbyCharacter) выглядела прыжком фигуры. Кладётся в .lobby-char — по нему и меряется.
 */
export function FlatStand({ url, slim, onReady }: { url: string; slim?: boolean; onReady?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ top: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const stage = ref.current?.parentElement
    if (!stage) return
    const place = () => {
      const g = stageGeom(stage)
      const { feet, tall } = lobbyFigureBox(g.h, g.top, g.scene)
      setBox({ top: feet - tall, height: tall })
    }
    place()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(place)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} className="lobby-flat-stand" style={box ? { top: box.top, height: box.height } : { visibility: 'hidden' }}>
      <FlatFigure url={url} slim={slim} onReady={onReady} />
    </div>
  )
}
