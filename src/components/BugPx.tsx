/** Пиксельный жучок 12×12. */
export function BugPx({ size = 22, light }: { size?: number; light?: boolean }) {
  const px = [
    '..k......k..',
    '...k....k...',
    '....kkkk....',
    '...kggggk...',
    'k.kgwggwgk.k',
    '.kkggggggkk.',
    '..kgGggGgk..',
    'kkkggggggkkk',
    '..kgGggGgk..',
    '.kkggggggkk.',
    'k..kggggk..k',
    '....kkkk....',
  ]
  // На зелёной кнопке жучок светлый, иначе сливается.
  const color: Record<string, string> = light
    ? { k: '#0b2410', g: '#ffffff', G: '#cfe9cf', w: '#0b2410' }
    : { k: '#10240f', g: '#6fdc5a', G: '#3b9a2c', w: '#ffffff' }
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true">
      {px.flatMap((row, y) =>
        [...row].map((ch, x) => (ch !== '.' ? <rect key={x + '-' + y} x={x} y={y} width="1" height="1" fill={color[ch]} /> : null)),
      )}
    </svg>
  )
}
