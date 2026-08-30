import { create } from 'zustand'
import { listVersionsTyped } from '../ipc/commands'
import type { McVersion } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'

const PREF = 'm-show-snapshots'

const DEMO: McVersion[] = [
  { id: '26.2', kind: 'release' },
  { id: '26w05a', kind: 'snapshot' },
  { id: '1.21.4', kind: 'release' },
  { id: '1.21.1', kind: 'release' },
  { id: '1.20.1', kind: 'release' },
]

const KIND_NAME: Record<string, string> = {
  snapshot: 'снапшот',
  old_beta: 'бета',
  old_alpha: 'альфа',
}

function storedShow(): boolean {
  try {
    return localStorage.getItem(PREF) === '1'
  } catch {
    return false
  }
}

interface State {
  show: boolean
  list: McVersion[]
  error: string
  setShow: (v: boolean) => void
}

export const useMcVersionList = create<State>((set) => ({
  show: storedShow(),
  list: [],
  error: '',
  setShow: (v) => {
    try {
      localStorage.setItem(PREF, v ? '1' : '0')
    } catch {}
    set({ show: v })
  },
}))

let pending: Promise<void> | null = null

// One fetch feeds every picker: the manifest is the same for all of them, and a
// second request only bought a second way to show a different list.
export function ensureMcVersionList(): Promise<void> {
  if (pending) return pending
  pending = (hasTauri() ? listVersionsTyped() : Promise.resolve(DEMO))
    .then((list) => {
      if (!Array.isArray(list) || !list.length) throw new Error('Mojang вернул пустой список версий')
      useMcVersionList.setState({ list, error: '' })
    })
    .catch((e) => {
      pending = null
      useMcVersionList.setState({ error: '' + e })
      throw e
    })
  return pending
}

export function versionOptions(list: McVersion[], show: boolean, pinned?: string) {
  const opts = list
    .filter((v) => (show ? true : v.kind === 'release'))
    .map((v) => ({ value: v.id, label: v.kind === 'release' ? v.id : v.id + ' · ' + (KIND_NAME[v.kind] || v.kind) }))
  if (pinned && !opts.some((o) => o.value === pinned)) opts.unshift({ value: pinned, label: pinned })
  return opts
}
