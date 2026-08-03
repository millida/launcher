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

export interface ChatAttachment {
  url: string
  kind: 'image' | 'voice' | 'file'
  name?: string
  durationMs?: number | null
  peaks?: number[]
}

export interface ChatMessage {
  text: string
  me?: boolean
  ts?: number
  id?: string
  attachment?: ChatAttachment | null
  /// Only set on our own messages while they are in flight or after a failure —
  /// a sent message that never reached the server must not look delivered.
  state?: 'sending' | 'failed'
  localId?: string
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
  build?: string | null
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
  chatHasMore: boolean
  chatOlderBusy: boolean
  chatPeerReadAt: number
  chatTyping: boolean
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
  chatHasMore: false,
  chatOlderBusy: false,
  chatPeerReadAt: 0,
  chatTyping: false,
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

interface ChatPage {
  messages?: ChatMessage[]
  hasMore?: boolean
  peerReadAt?: number | null
}

export async function renderChat(append?: boolean) {
  const uid = useFriends.getState().chatWith
  let page: ChatPage = {}
  try {
    page = await api('/friends/chat/' + encodeURIComponent(uid))
  } catch {
    page = {}
  }
  const cur = useFriends.getState()
  // A reply that outlived its request would otherwise drop someone else's
  // conversation into the open one.
  if (cur.chatWith !== uid) return
  const msgs = page.messages || []
  cur.set({
    chatMsgs: append ? cur.chatMsgs.concat(msgs) : msgs,
    chatEmpty: append ? cur.chatEmpty : msgs.length === 0,
    chatHasMore: !!page.hasMore,
    chatPeerReadAt: page.peerReadAt || 0,
    chatSeq: cur.chatSeq + 1,
  })
}

/// Returns how many messages were prepended so the view can keep the reading
/// position instead of jumping to the top of the freshly loaded page.
export async function loadOlderChat(): Promise<number> {
  const s = useFriends.getState()
  const oldest = s.chatMsgs.find((m) => m.ts)
  if (!s.chatHasMore || s.chatOlderBusy || !oldest?.ts) return 0
  const uid = s.chatWith
  s.set({ chatOlderBusy: true })
  try {
    const page: ChatPage = await api(
      '/friends/chat/' + encodeURIComponent(uid) + '?before=' + oldest.ts,
    )
    const cur = useFriends.getState()
    if (cur.chatWith !== uid) return 0
    const older = page.messages || []
    cur.set({ chatMsgs: older.concat(cur.chatMsgs), chatHasMore: !!page.hasMore })
    return older.length
  } catch {
    return 0
  } finally {
    useFriends.getState().set({ chatOlderBusy: false })
  }
}

let localSeq = 0

function patchMessage(localId: string, patch: Partial<ChatMessage>) {
  const s = useFriends.getState()
  s.set({
    chatMsgs: s.chatMsgs.map((m) => (m.localId === localId ? { ...m, ...patch } : m)),
    chatSeq: s.chatSeq + 1,
  })
}

/**
 * The old send swallowed its error, so a message that never left the launcher
 * sat in the thread looking delivered. Now it carries its state and can be sent
 * again.
 */
export async function sendChat(uid: string, text: string, attachment?: ChatAttachment | null) {
  const body = text.trim()
  if (!body && !attachment) return
  const localId = 'l' + ++localSeq
  appendChatMessage({
    text: body,
    me: true,
    ts: Date.now(),
    attachment: attachment || null,
    state: 'sending',
    localId,
  })
  try {
    const r = await api('/friends/chat/' + encodeURIComponent(uid), {
      method: 'POST',
      body: JSON.stringify({ text: body || undefined, attachment: attachment || undefined }),
    })
    patchMessage(localId, { state: undefined, id: r?.id, ts: r?.ts || Date.now() })
  } catch (e) {
    patchMessage(localId, { state: 'failed' })
    throw e
  }
}

export async function retryChat(localId: string) {
  const s = useFriends.getState()
  const msg = s.chatMsgs.find((m) => m.localId === localId)
  if (!msg || msg.state !== 'failed') return
  s.set({ chatMsgs: s.chatMsgs.filter((m) => m.localId !== localId) })
  await sendChat(s.chatWith, msg.text, msg.attachment)
}

export function dropFailedChat(localId: string) {
  const s = useFriends.getState()
  s.set({ chatMsgs: s.chatMsgs.filter((m) => m.localId !== localId), chatSeq: s.chatSeq + 1 })
}

let typingSentAt = 0

/// One ping per few seconds is enough: the server keeps the flag alive for six.
export function pingTyping(uid: string) {
  const now = Date.now()
  if (now - typingSentAt < 3000) return
  typingSentAt = now
  void api('/friends/chat/' + encodeURIComponent(uid) + '/typing', { method: 'POST' }).catch(() => {})
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
      build: known?.build || null,
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
        build: p.build || null,
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
