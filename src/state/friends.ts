import { create } from 'zustand'
import { api, hasMillidaAccount } from '../lib/api'
import { coalesce } from '../lib/coalesce'
import { offPlatformReason } from '../lib/offPlatform'
import { warmHeads } from '../lib/heads'
import { clearRoomUnread } from './rooms'

export interface Friend {
  userId: string
  nickname?: string
  avatarUrl?: string | null
  online?: boolean
  text?: string
  /// Где именно человек: в игре, в лаунчере или просто на сайте. Присутствие на
  /// сайте меряется отметкой любого запроса с токеном и лаунчера не означает.
  place?: 'game' | 'launcher' | 'web' | null
  lastMessageAt?: number | null
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

export interface ChatReaction {
  emoji: string
  count: number
  mine?: boolean
}

export interface ChatReplyPreview {
  id: string
  me?: boolean
  /// Автор цитаты: в группе подпись «Собеседник» ничего не сказала бы.
  from?: string
  text: string
  deleted?: boolean
  kind?: string | null
}

export interface ChatMessage {
  text: string
  me?: boolean
  ts?: number
  id?: string
  /// Автор. В личке он и так известен по `me`, в группе — нет: там в ленте
  /// стоят несколько человек, и каждому пузырю нужна подпись.
  from?: string
  fromNick?: string
  attachment?: ChatAttachment | null
  /// Only set on our own messages while they are in flight or after a failure —
  /// a sent message that never reached the server must not look delivered.
  state?: 'sending' | 'failed'
  localId?: string
  editedAt?: number | null
  deleted?: boolean
  replyTo?: ChatReplyPreview | null
  reactions?: ChatReaction[]
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
  /// Открытая группа. Пусто — открыта личка: панель, лента и поле ввода одни на
  /// оба случая, различается только адресат.
  chatRoom: string
  chatNick: string
  chatHeader: FriendProfile | null
  chatMsgs: ChatMessage[]
  chatEmpty: boolean
  chatSeq: number
  chatHasMore: boolean
  chatOlderBusy: boolean
  chatPeerReadAt: number
  chatTyping: boolean
  /// Кто печатает в открытой группе: в личке собеседник один и хватает флага.
  chatTypers: string[]
  /// Сообщение, на которое отвечаем, и сообщение, которое правим — оба живут в
  /// сторе: их выставляет меню сообщения, а читает поле ввода.
  chatReplyTo: ChatMessage | null
  chatEditing: ChatMessage | null
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
  chatRoom: '',
  chatNick: '',
  chatHeader: null,
  chatMsgs: [],
  chatEmpty: false,
  chatSeq: 0,
  chatHasMore: false,
  chatOlderBusy: false,
  chatPeerReadAt: 0,
  chatTyping: false,
  chatTypers: [],
  chatReplyTo: null,
  chatEditing: null,
  set: (patch) => set(patch as FriendsState),
  load: () => loadFriends(),
}))

const fetchFriends = coalesce(async () => {
  const set = useFriends.setState
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
})

export const loadFriends = () => fetchFriends()

export const unreadTotal = (friends: Friend[]): number =>
  friends.reduce((n, f) => n + (f.unread || 0), 0)

/**
 * Чистое поле новой переписки. Лента и её спутники обнуляются в тот же приём,
 * что и адресат: пока они переживали переключение, до ответа сервера в открытом
 * чате висели чужие сообщения — тем дольше, чем хуже связь.
 */
const emptyThread = () => ({
  chatMsgs: [] as ChatMessage[],
  chatEmpty: false,
  chatHasMore: false,
  chatPeerReadAt: 0,
  chatTypers: [] as string[],
  chatSeq: useFriends.getState().chatSeq + 1,
})

function clearUnread(uid: string) {
  const s = useFriends.getState()
  if (!s.friends.some((f) => f.userId === uid && f.unread)) return
  s.set({ friends: s.friends.map((f) => (f.userId === uid ? { ...f, unread: 0 } : f)) })
}

export async function openChat(uid: string, nick: string, profileMode?: boolean) {
  const s = useFriends.getState()
  const resolved = nick || s.friends.find((f) => f.userId === uid)?.nickname || ''
  s.set({
    chatWith: uid,
    chatRoom: '',
    chatNick: resolved,
    chatOpen: true,
    chatHeader: profileMode ? s.chatHeader : null,
    chatReplyTo: null,
    chatEditing: null,
    chatTyping: false,
    ...emptyThread(),
  })
  clearUnread(uid)
  void api('/friends/chat/' + encodeURIComponent(uid) + '/read', { method: 'POST' }).catch(() => {})
  if (!profileMode) await renderChat()
}

/**
 * Открытая переписка одной строкой. Личка адресована человеку, группа —
 * комнате; всё остальное (лента, вложения, правка, реакции) у них общее,
 * поэтому и точки API отличаются только этим корнем.
 */
function chatBase(state: { chatWith: string; chatRoom: string }): string {
  return state.chatRoom
    ? '/friends/rooms/' + encodeURIComponent(state.chatRoom) + '/chat'
    : '/friends/chat/' + encodeURIComponent(state.chatWith)
}

/** Ключ открытой переписки: по нему видно, что ответ пришёл уже не туда. */
const scopeKey = (s: { chatWith: string; chatRoom: string }) => s.chatRoom + '>' + s.chatWith

export async function openRoomChat(roomId: string, title: string) {
  const s = useFriends.getState()
  s.set({
    chatWith: '',
    chatRoom: roomId,
    chatNick: title,
    chatOpen: true,
    chatHeader: null,
    chatReplyTo: null,
    chatEditing: null,
    chatTyping: false,
    ...emptyThread(),
  })
  clearRoomUnread(roomId)
  void api('/friends/rooms/' + encodeURIComponent(roomId) + '/read', { method: 'POST' }).catch(() => {})
  await renderChat()
}

interface ChatPage {
  messages?: ChatMessage[]
  hasMore?: boolean
  peerReadAt?: number | null
}

export async function renderChat(append?: boolean) {
  const scope = scopeKey(useFriends.getState())
  let page: ChatPage = {}
  try {
    page = await api(chatBase(useFriends.getState()))
  } catch {
    page = {}
  }
  const cur = useFriends.getState()
  // A reply that outlived its request would otherwise drop someone else's
  // conversation into the open one.
  if (scopeKey(cur) !== scope) return
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
  const scope = scopeKey(s)
  s.set({ chatOlderBusy: true })
  try {
    const page: ChatPage = await api(chatBase(s) + '?before=' + oldest.ts)
    const cur = useFriends.getState()
    if (scopeKey(cur) !== scope) return 0
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
export function replyPreviewOf(m: ChatMessage): ChatReplyPreview | null {
  if (!m.id) return null
  return { id: m.id, me: m.me, text: m.text.slice(0, 120), kind: m.attachment?.kind || null }
}

export async function sendChat(
  text: string,
  attachment?: ChatAttachment | null,
  replyTo?: ChatReplyPreview | null,
) {
  const body = text.trim()
  if (!body && !attachment) return
  const base = chatBase(useFriends.getState())
  const localId = 'l' + ++localSeq
  appendChatMessage({
    text: body,
    me: true,
    ts: Date.now(),
    attachment: attachment || null,
    replyTo: replyTo || null,
    state: 'sending',
    localId,
  })
  try {
    const r = await api(base, {
      method: 'POST',
      body: JSON.stringify({
        text: body || undefined,
        attachment: attachment || undefined,
        replyToId: replyTo?.id,
      }),
    })
    patchMessage(localId, { state: undefined, id: r?.id, ts: r?.ts || Date.now() })
  } catch (e) {
    if (offPlatformReason(e)) {
      const cur = useFriends.getState()
      cur.set({ chatMsgs: cur.chatMsgs.filter((m) => m.localId !== localId), chatSeq: cur.chatSeq + 1 })
      throw e
    }
    patchMessage(localId, { state: 'failed' })
    throw e
  }
}

export async function retryChat(localId: string) {
  const s = useFriends.getState()
  const msg = s.chatMsgs.find((m) => m.localId === localId)
  if (!msg || msg.state !== 'failed') return
  s.set({ chatMsgs: s.chatMsgs.filter((m) => m.localId !== localId) })
  await sendChat(msg.text, msg.attachment, msg.replyTo)
}

/// Ответ сервера — целое сообщение: правка, удаление и реакция возвращают его
/// же, поэтому применяется одинаково, откуда бы ни пришло (действие или опрос).
export function applyChatMessage(view: ChatMessage) {
  const s = useFriends.getState()
  if (!view.id || !s.chatMsgs.some((m) => m.id === view.id)) return
  s.set({
    chatMsgs: s.chatMsgs.map((m) => (m.id === view.id ? { ...m, ...view } : m)),
    chatSeq: s.chatSeq + 1,
  })
}

export async function editChatMessage(id: string, text: string) {
  const body = text.trim()
  if (!body) return
  applyChatMessage(await api('/friends/chat/message/' + encodeURIComponent(id) + '/edit', {
    method: 'POST',
    body: JSON.stringify({ text: body }),
  }))
}

export async function deleteChatMessage(id: string) {
  applyChatMessage(
    await api('/friends/chat/message/' + encodeURIComponent(id) + '/delete', { method: 'POST' }),
  )
  const s = useFriends.getState()
  if (s.chatReplyTo?.id === id) s.set({ chatReplyTo: null })
  if (s.chatEditing?.id === id) s.set({ chatEditing: null })
}

/// Реакция рисуется сразу: ответ сервера приходит следом и правит счётчик, если
/// собеседник нажал ту же в тот же момент.
export async function toggleChatReaction(id: string, emoji: string) {
  const s = useFriends.getState()
  const msg = s.chatMsgs.find((m) => m.id === id)
  if (!msg) return
  const cur = msg.reactions || []
  const mine = cur.find((r) => r.emoji === emoji)?.mine
  const optimistic = cur
    .map((r) =>
      r.emoji === emoji ? { ...r, count: r.count + (mine ? -1 : 1), mine: !mine } : r,
    )
    .filter((r) => r.count > 0)
  if (!mine && !cur.some((r) => r.emoji === emoji)) optimistic.push({ emoji, count: 1, mine: true })
  applyChatMessage({ ...msg, reactions: optimistic })
  try {
    applyChatMessage(
      await api('/friends/chat/message/' + encodeURIComponent(id) + '/react', {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }),
    )
  } catch (e) {
    applyChatMessage({ ...msg, reactions: cur })
    throw e
  }
}

export function dropFailedChat(localId: string) {
  const s = useFriends.getState()
  s.set({ chatMsgs: s.chatMsgs.filter((m) => m.localId !== localId), chatSeq: s.chatSeq + 1 })
}

let typingSentAt = 0

/// One ping per few seconds is enough: the server keeps the flag alive for six.
export function pingTyping() {
  const now = Date.now()
  if (now - typingSentAt < 3000) return
  typingSentAt = now
  const s = useFriends.getState()
  const url = s.chatRoom
    ? '/friends/rooms/' + encodeURIComponent(s.chatRoom) + '/typing'
    : '/friends/chat/' + encodeURIComponent(s.chatWith) + '/typing'
  void api(url, { method: 'POST' }).catch(() => {})
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
