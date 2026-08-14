import { create } from 'zustand'
import { api, hasMillidaAccount } from '../lib/api'
import { warmHeads } from '../lib/heads'

export interface RoomMember {
  userId: string
  role: string
  nickname: string
  avatarUrl?: string | null
}

export interface VoiceMember {
  userId: string
  since: number
  muted: boolean
  screen: boolean
}

export interface Room {
  id: string
  title: string
  avatarUrl?: string | null
  ownerId: string
  createdAt?: number
  members: RoomMember[]
  unread?: number
  lastMessageAt?: number | null
  voice?: VoiceMember[]
}

interface RoomsState {
  /** Свой id в соц-графе: сервер сообщает его вместе со списком групп. */
  me: string
  rooms: Room[]
  loaded: boolean
  /// Открытые окна групп. Живут в состоянии, а не внутри панели чата: панель
  /// сдвинута трансформацией, и окно внутри неё считало бы «весь экран» от неё.
  manageId: string
  createOpen: boolean
  set: (patch: Partial<RoomsState>) => void
  load: () => Promise<void>
  setVoice: (roomId: string, members: VoiceMember[]) => void
}

export const useRooms = create<RoomsState>((set, get) => ({
  me: '',
  rooms: [],
  loaded: false,
  manageId: '',
  createOpen: false,
  set: (patch) => set(patch as RoomsState),
  load: async () => {
    if (!hasMillidaAccount()) {
      set({ rooms: [], loaded: true })
      return
    }
    try {
      const r = await api<{ me?: string; rooms?: Room[] }>('/friends/rooms')
      const rooms = r.rooms || []
      set({ me: r.me || get().me, rooms, loaded: true })
      warmHeads(rooms.flatMap((room) => room.members.map((m) => m.nickname)))
    } catch {
      set({ loaded: true })
    }
  },
  setVoice: (roomId, members) => {
    const rooms = get().rooms
    if (!rooms.some((r) => r.id === roomId)) return
    set({ rooms: rooms.map((r) => (r.id === roomId ? { ...r, voice: members } : r)) })
  },
}))

export const loadRooms = () => useRooms.getState().load()

export const roomById = (id: string): Room | undefined =>
  useRooms.getState().rooms.find((r) => r.id === id)

/** Ник участника любой моей группы: в голосе сервер шлёт только идентификаторы. */
export function nickInRooms(userId: string): string {
  for (const room of useRooms.getState().rooms) {
    const found = room.members.find((m) => m.userId === userId)
    if (found) return found.nickname
  }
  return ''
}

export const roomsUnreadTotal = (rooms: Room[]): number =>
  rooms.reduce((n, r) => n + (r.unread || 0), 0)

function replaceRoom(room: Room) {
  const s = useRooms.getState()
  const known = s.rooms.some((r) => r.id === room.id)
  s.set({ rooms: known ? s.rooms.map((r) => (r.id === room.id ? { ...r, ...room } : r)) : s.rooms.concat([room]) })
}

export function clearRoomUnread(roomId: string) {
  const s = useRooms.getState()
  if (!s.rooms.some((r) => r.id === roomId && r.unread)) return
  s.set({ rooms: s.rooms.map((r) => (r.id === roomId ? { ...r, unread: 0 } : r)) })
}

export function bumpRoom(roomId: string, ts: number, unread: boolean) {
  const s = useRooms.getState()
  s.set({
    rooms: s.rooms.map((r) =>
      r.id === roomId
        ? { ...r, lastMessageAt: ts, unread: unread ? (r.unread || 0) + 1 : r.unread || 0 }
        : r,
    ),
  })
}

export async function createRoom(title: string, memberIds: string[]): Promise<Room> {
  const room = await api<Room>('/friends/rooms', {
    method: 'POST',
    body: JSON.stringify({ title, memberIds }),
  })
  replaceRoom(room)
  return room
}

export async function inviteToRoom(roomId: string, memberIds: string[]): Promise<Room> {
  const room = await api<Room>('/friends/rooms/' + encodeURIComponent(roomId) + '/invite', {
    method: 'POST',
    body: JSON.stringify({ memberIds }),
  })
  replaceRoom(room)
  return room
}

export async function renameRoom(roomId: string, title: string): Promise<Room> {
  const room = await api<Room>('/friends/rooms/' + encodeURIComponent(roomId), {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
  replaceRoom(room)
  return room
}

export async function kickFromRoom(roomId: string, userId: string): Promise<Room> {
  const room = await api<Room>('/friends/rooms/' + encodeURIComponent(roomId) + '/kick', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
  replaceRoom(room)
  return room
}

export const openRoomManage = (roomId: string) => useRooms.getState().set({ manageId: roomId })

export const openRoomCreate = () => useRooms.getState().set({ createOpen: true })

export async function leaveRoom(roomId: string): Promise<void> {
  await api('/friends/rooms/' + encodeURIComponent(roomId) + '/leave', { method: 'POST' })
  const s = useRooms.getState()
  s.set({ rooms: s.rooms.filter((r) => r.id !== roomId) })
}
