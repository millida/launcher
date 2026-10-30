// Какие экраны уже загружены (код в памяти): state/ui.ts решает по этому, как переключаться —
// переходом (старый экран остаётся и притушен) или сразу (скелетон на время загрузки чанка).
const ready = new Set<string>()

export const markScreenReady = (id: string): void => void ready.add(id)
export const screenReady = (id: string): boolean => ready.has(id)
