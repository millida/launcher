/**
 * Знак рубина - валюты магазина.
 *
 * Картинка художников, а не нарисованный фигурами камень: рубин - предмет мира
 * и обязан выглядеть одинаково в лаунчере, в игре и на витрине. Пиксели не
 * сглаживаем, иначе на крупном размере камень плывёт.
 */
export function Ruby({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/ruby.webp"
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
