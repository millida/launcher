import { create } from 'zustand'

export const CONSOLE_KEEP = 400

/// While the buffer lived inside the tab, every trip to another tab or another
/// screen wiped the output the player had just read.
///
/// `replay` is the tail the node sends again on every connect: it is a more
/// complete version of what is already on screen (it also holds the lines lost
/// while the connection was silent), so on its marker it replaces the buffer
/// instead of being appended to it - appending is how the last 64 KB got shown
/// twice. Until the marker arrives the previous lines stay on screen.
interface HostConsoleState {
  id: string
  lines: string[]
  replay: string[]
  replaying: boolean
}

/// The selector below runs on every store change, and a fresh array for "this
/// server has nothing yet" would re-render the screen each time.
const EMPTY: string[] = []

export const useHostConsole = create<HostConsoleState>(() => ({
  id: '',
  lines: EMPTY,
  replay: EMPTY,
  replaying: false,
}))

export function keepTail(lines: string[], next: string, limit: number): string[] {
  return lines.length >= limit ? lines.slice(lines.length - limit + 1).concat([next]) : lines.concat([next])
}

export const consoleLines = (state: HostConsoleState, id: string): string[] =>
  state.id === id ? state.lines : EMPTY

const forId = (s: HostConsoleState, id: string): HostConsoleState =>
  s.id === id ? s : { id, lines: EMPTY, replay: EMPTY, replaying: false }

export function beginConsoleReplay(id: string) {
  useHostConsole.setState((s) => ({ ...forId(s, id), replay: EMPTY, replaying: true }))
}

/// A core or a node that sends no marker must not end up with an invisible
/// console: what was collected as history is then shown as plain output.
export function endConsoleReplay(id: string, replaced: boolean) {
  useHostConsole.setState((s) => {
    const cur = forId(s, id)
    if (!cur.replaying) return cur
    const tail = cur.replay.slice(-CONSOLE_KEEP)
    if (!tail.length) return { ...cur, replay: EMPTY, replaying: false }
    return {
      ...cur,
      lines: replaced ? tail : cur.lines.concat(tail).slice(-CONSOLE_KEEP),
      replay: EMPTY,
      replaying: false,
    }
  })
}

export function pushConsoleLine(id: string, line: string) {
  useHostConsole.setState((s) => {
    const cur = forId(s, id)
    return cur.replaying
      ? { ...cur, replay: keepTail(cur.replay, line, CONSOLE_KEEP) }
      : { ...cur, lines: keepTail(cur.lines, line, CONSOLE_KEEP) }
  })
}

export function clearConsole(id: string) {
  useHostConsole.setState({ id, lines: EMPTY, replay: EMPTY, replaying: false })
}
