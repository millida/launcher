/**
 * Знак сундука - того самого, который открывают за награду.
 *
 * Картинка художников, как и у рубина: сундук живёт и в игре, и в лаунчере, и
 * нарисованный фигурами куб рядом с ним читался как заглушка. Пиксели не
 * сглаживаем - на крупном размере доски расплываются.
 */
export function Chest({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/chest.png"
      width={size}
      height={size}
      className={className}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ imageRendering: 'pixelated', display: 'block' }}
    />
  )
}
