import { create } from 'zustand'
import { api, hasMillidaAccount } from '../lib/api'
import { warmHeads } from '../lib/heads'

export interface Friend {
  userId: string
  nickname?: string
  avatarUrl?: string | null
  online?: boolean
  text?: string
  playing?: boolean
  serverIp?: string
  serverName?: string
  build?: string
  lastSeen?: number | null
  unread?: number
}

export interface FriendRequest {
  id: string
  userId?: string
  nickname?: string
  avatarUrl?: string | null
}

export interface FoundUser {
  userId?: string
  nickname?: string
  avatarUrl?: string | null
  isFriend?: boolean
  pending?: boolean
  text?: string
}

export interface ChatMessage {
  text: string
  me?: boolean
  ts?: number
}

export interface PlayStatBuild {
  name: string
  seconds: number
  last?: number
}

export interface PlayStatServer {
  addr: string
  name?: string
  seconds: number
  last?: number
}

export interface FriendStats {
  totalSeconds: number
  sessions: number
  lastBuild?: string | null
  lastServer?: string | null
  lastServerName?: string | null
  lastPlayedAt?: number | null
  builds: PlayStatBuild[]
  servers: PlayStatServer[]
}

export interface FriendProfile {
  nick: string
  text: string
  online?: boolean
  playing?: boolean
  serverIp?: string | null
  serverName?: string | null
  stats?: FriendStats | null
}

interface FriendsState {
  friends: Friend[]
  reqIn: FriendRequest[]
  reqOut: FriendRequest[]
  found: FoundUser[] | null
  chatOpen: boolean
  chatWith: string
  chatNick: string
  chatHeader: FriendProfile | null
  chatMsgs: ChatMessage[]
  chatEmpty: boolean
  chatSeq: number
  set: (patch: Partial<FriendsState>) => void
  load: () => Promise<void>
}

export const useFriends = create<FriendsState>((set) => ({
  friends: [],
  reqIn: [],
  reqOut: [],
  found: null,
  chatOpen: false,
  chatWith: '',
  chatNick: '',
  chatHeader: null,
  chatMsgs: [],
  chatEmpty: false,
  chatSeq: 0,
  set: (patch) => set(patch as FriendsState),
  load: async () => {
    if (!hasMillidaAccount()) {
      set({ friends: [], reqIn: [], reqOut: [] })
      return
    }
    try {
      const [f, req] = await Promise.all([api('/friends'), api('/friends/requests')])
      set({ friends: f.friends || [], reqIn: req.incoming || [], reqOut: req.outgoing || [] })
      warmHeads((f.friends || []).filter((x: Friend) => !x.avatarUrl).map((x: Friend) => x.nickname))
    } catch {
      set({ friends: [], reqIn: [], reqOut: [] })
    }
  },
}))

export const loadFriends = () => useFriends.getState().load()

export const unreadTotal = (friends: Friend[]): number =>
  friends.reduce((n, f) => n + (f.unread || 0), 0)

function clearUnread(uid: string) {
  const s = useFriends.getState()
  if (!s.friends.some((f) => f.userId === uid && f.unread)) return
  s.set({ friends: s.friends.map((f) => (f.userId === uid ? { ...f, unread: 0 } : f)) })
}

export async function openChat(uid: string, nick: string, profileMode?: boolean) {
  const s = useFriends.getState()
  const resolved = nick || s.friends.find((f) => f.userId === uid)?.nickname || ''
  s.set({ chatWith: uid, chatNick: resolved, chatOpen: true, chatHeader: profileMode ? s.chatHeader : null })
  clearUnread(uid)
  void api('/friends/chat/' + encodeURIComponent(uid) + '/read', { method: 'POST' }).catch(() => {})
  if (!profileMode) await renderChat()
}

export async function renderChat(append?: boolean) {
  const s = useFriends.getState()
  let msgs: ChatMessage[] = []
  try {
    msgs = (await api('/friends/chat/' + encodeURIComponent(s.chatWith))).messages || []
  } catch {
    msgs = []
  }
  const cur = useFriends.getState()
  if (append) cur.set({ chatMsgs: cur.chatMsgs.concat(msgs), chatSeq: cur.chatSeq + 1 })
  else cur.set({ chatMsgs: msgs, chatEmpty: msgs.length === 0, chatSeq: cur.chatSeq + 1 })
}

export async function openFriendProfile(uid: string, nick: string) {
  await openChat(uid, nick, true)
  const known = useFriends.getState().friends.find((f) => f.userId === uid)
  const resolved = nick || known?.nickname || ''
  useFriends.getState().set({
    chatHeader: {
      nick: resolved,
      text: known?.text || '',
      online: known?.online,
      playing: known?.playing,
      serverIp: known?.serverIp || null,
      serverName: known?.serverName || null,
      stats: null,
    },
    chatMsgs: [],
    chatEmpty: false,
  })
  let p: (Partial<FriendProfile> & { text?: string; nickname?: string }) | null = null
  try {
    p = await api('/friends/profile/' + encodeURIComponent(uid))
  } catch {}
  const s = useFriends.getState()
  if (s.chatWith !== uid) return
  if (p) {
    s.set({
      chatHeader: {
        nick: resolved || p.nickname || '',
        text: p.text || '',
        online: p.online,
        playing: p.playing,
        serverIp: p.serverIp || null,
        serverName: p.serverName || null,
        stats: p.stats || null,
      },
    })
  }
  await renderChat(true)
}

export function appendChatMessage(m: ChatMessage) {
  const s = useFriends.getState()
  s.set({ chatMsgs: s.chatMsgs.concat([m]), chatEmpty: false, chatSeq: s.chatSeq + 1 })
}
