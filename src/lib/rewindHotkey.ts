export function hotkeyFromEvent(e: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'shiftKey'>): string | null {
  const key = /^Key([A-Z])$/.exec(e.code)?.[1] ?? /^Digit(\d)$/.exec(e.code)?.[1] ?? /^(F\d{1,2})$/.exec(e.code)?.[1]
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[]
  if (!key || mods.length === 0) return null
  return [...mods, key].join('+')
}
