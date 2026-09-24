import '../../styles/pixel/nametag.css'

/**
 * Ник над головой, как в Minecraft: пиксельный шрифт, полупрозрачная тёмная
 * плашка, тень у букв. Ставится над самой высокой точкой фигуры вместе с
 * косметикой — шляпа, нимб и крылья ника не перекрывают.
 */
export function Nametag({ nick, at }: { nick: string; at: { x: number; y: number } | null }) {
  if (!nick || !at) return null
  return (
    <span className="mc-nametag" style={{ left: at.x + 'px', top: at.y + 'px' }}>
      {nick}
    </span>
  )
}

/** Где рисовать ник: над верхом кадра фигуры (NDC) в пикселях сцены. */
export function nametagSpot(
  ndc: { minX: number; maxX: number; maxY: number },
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: (((ndc.minX + ndc.maxX) / 2 + 1) / 2) * width,
    y: (1 - (ndc.maxY + 1) / 2) * height - 8,
  }
}
