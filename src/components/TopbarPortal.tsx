import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

/// Переносит содержимое в слот верхней полосы (#tbSlot в Sidebar): экран
/// показывает свои действия и баланс на одном уровне с «← Лобби», а не крупным
/// заголовком внутри страницы. Слот появляется в том же кадре, что и экран,
/// поэтому цель ищем после монтирования.
export function TopbarPortal({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setSlot(document.getElementById('tbSlot'))
  }, [])
  return slot ? createPortal(children, slot) : null
}
