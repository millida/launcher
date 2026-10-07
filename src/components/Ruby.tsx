import { CurrencyIcon } from './CurrencyIcon'

/**
 * Знак рубина - валюты магазина. Воксельный рендер камня (scripts/voxel-art,
 * 06.10.2026) в том же свете, что сундуки.
 */
export function Ruby({ size = 20, className }: { size?: number; className?: string }) {
  return <CurrencyIcon art="ruby" size={size} className={className} />
}
