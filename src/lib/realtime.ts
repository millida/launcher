import { Centrifuge, UnauthorizedError } from 'centrifuge'
import { hasTauri } from '../ipc/tauri'
import { getMillidaAccount, useAccounts } from '../state/accounts'
import { api, hasMillidaAccount } from './api'
import { SECRETS_CHANGED_EVENT } from './secure'
import { realtimeClientInfo } from './telemetry'
import {
  REALTIME_CLIENT_NAME,
  REALTIME_ERROR_RETRY_MS,
  REALTIME_OFF_RETRY_MS,
  RELAY_TOPICS,
  carriesData,
  catchUpListeners,
  needsCatchUp,
  pokeTopic,
  presenceModeAfter,
  presenceRollback,
  readRealtimeGrant,
  realtimeTokenPath,
  type RealtimeGrant,
  type RealtimeTopic,
  type RelayMessage,
  socketPresence,
  type ServerSub,
} from './realtimePace'

export type { RealtimeTopic } from './realtimePace'

type Handler = () => void
type DataHandler = (data: unknown) => void
type LiveHandler = (live: boolean) => void
type RelaySink = (message: RelayMessage) => void

const handlers = new Map<RealtimeTopic, Set<Handler>>()
const dataHandlers = new Map<RealtimeTopic, Set<DataHandler>>()
const liveHandlers = new Set<LiveHandler>()
const settledHandlers = new Set<Handler>()
const presenceHandlers = new Set<LiveHandler>()

let client: Centrifuge | null = null
let owner = ''
let live = false
let presenceMode = false
let subs: ServerSub[] = []
let holders = 0
let generation = 0
let opening = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
let watching = false
let relay: RelaySink | null = null

function safely(run: () => void) {
  try {
    run()
  } catch (e) {
    console.warn('[realtime] handler failed', e)
  }
}

function setLive(next: boolean) {
  if (!next) subs = []
  if (live === next) return
  live = next
  relay?.({ kind: 'live', live: next })
  liveHandlers.forEach((h) => safely(() => h(next)))
}

function emit(topic: RealtimeTopic) {
  handlers.get(topic)?.forEach((h) => safely(h))
}

function deliver(topic: RealtimeTopic, data: unknown) {
  if (relay && RELAY_TOPICS.includes(topic)) relay({ kind: 'pub', topic, data })
  dataHandlers.get(topic)?.forEach((h) => safely(() => h(data)))
  if (!carriesData(topic, data)) emit(topic)
}

function catchUp() {
  relay?.({ kind: 'catchup' })
  catchUpListeners<Handler>(handlers.values()).forEach((h) => safely(h))
}

export function onRealtime(topic: RealtimeTopic, handler: Handler): () => void {
  let set = handlers.get(topic)
  if (!set) {
    set = new Set()
    handlers.set(topic, set)
  }
  set.add(handler)
  return () => void handlers.get(topic)?.delete(handler)
}

/** Receives the publication itself, for topics whose pokes carry their payload. */
export function onRealtimeData(topic: RealtimeTopic, handler: DataHandler): () => void {
  let set = dataHandlers.get(topic)
  if (!set) {
    set = new Set()
    dataHandlers.set(topic, set)
  }
  set.add(handler)
  return () => void dataHandlers.get(topic)?.delete(handler)
}

export function isRealtimeLive(): boolean {
  return live
}

/** The server counts this launcher as online from the socket itself, so periodic beats are not needed. */
export function isPresenceTracked(): boolean {
  return socketPresence(live, presenceMode)
}

/** Fires when the HTTP beat timer has to start or may stop while the socket stays as it is. */
export function onPresenceModeChange(handler: LiveHandler): () => void {
  presenceHandlers.add(handler)
  return () => void presenceHandlers.delete(handler)
}

function setPresenceMode(next: boolean) {
  const before = isPresenceTracked()
  presenceMode = next
  const after = isPresenceTracked()
  if (before !== after) presenceHandlers.forEach((h) => safely(() => h(after)))
}

function applyGrant(grant: RealtimeGrant) {
  setPresenceMode(presenceModeAfter({ kind: 'grant', presence: grant.enabled && grant.presence }))
}

export function onRealtimeLiveChange(handler: LiveHandler): () => void {
  liveHandlers.add(handler)
  return () => void liveHandlers.delete(handler)
}

/** Fires after every (re)connect, once the server-side subscriptions are known. */
export function onRealtimeSettled(handler: Handler): () => void {
  settledHandlers.add(handler)
  return () => void settledHandlers.delete(handler)
}

/** The main window hands friend publications to the overlay so it needs no socket of its own. */
export function setRealtimeRelay(sink: RelaySink | null) {
  relay = sink
  sink?.({ kind: 'live', live })
}

/** Overlay side of the relay: a relayed message behaves as if it came from a local socket. */
export function injectRealtime(message: RelayMessage) {
  if (message.kind === 'live') setLive(message.live)
  else if (message.kind === 'catchup') catchUp()
  else deliver(message.topic, message.data)
}

function wantedOwner(): string {
  if (!holders || !hasTauri() || !hasMillidaAccount()) return ''
  return getMillidaAccount()?.id || 'millida'
}

async function fetchGrant(): Promise<RealtimeGrant> {
  const info = await realtimeClientInfo().catch(() => ({}))
  return readRealtimeGrant(await api(realtimeTokenPath(info)))
}

function teardown() {
  generation += 1
  opening = false
  clearTimeout(retryTimer)
  retryTimer = undefined
  const c = client
  client = null
  owner = ''
  if (c) {
    c.removeAllListeners()
    c.disconnect()
  }
  setLive(false)
  presenceMode = false
}

function retryLater(ms: number) {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    sync()
  }, ms)
}

function settle(c: Centrifuge) {
  if (client !== c || !live) return
  if (needsCatchUp(subs)) catchUp()
  settledHandlers.forEach((h) => safely(h))
}

async function open(who: string) {
  const mine = ++generation
  opening = true
  owner = who
  let grant: RealtimeGrant
  try {
    grant = await fetchGrant()
  } catch {
    if (mine === generation) {
      opening = false
      retryLater(REALTIME_ERROR_RETRY_MS)
    }
    return
  }
  if (mine !== generation) return
  opening = false
  applyGrant(grant)
  if (wantedOwner() !== who) {
    sync()
    return
  }
  if (!grant.enabled) {
    retryLater(REALTIME_OFF_RETRY_MS)
    return
  }
  const c = new Centrifuge(grant.url, {
    token: grant.token,
    name: REALTIME_CLIENT_NAME,
    getToken: async () => {
      const next = await fetchGrant()
      // The rollout share can change between tokens, so every refresh re-decides socket presence.
      if (client === c) applyGrant(next)
      if (!next.enabled) throw new UnauthorizedError('realtime disabled')
      return next.token
    },
    // Every launcher reconnects after a server restart; a wide backoff keeps that from becoming a wave.
    minReconnectDelay: 2_000,
    maxReconnectDelay: 60_000,
  })
  c.on('connected', () => {
    setLive(true)
    // Server-side subscriptions are reported right after 'connected' in the same call.
    queueMicrotask(() => settle(c))
  })
  c.on('connecting', () => setLive(false))
  c.on('subscribed', (ctx) => {
    subs = subs.filter((s) => s.channel !== ctx.channel).concat({ channel: ctx.channel, recovered: ctx.recovered })
  })
  c.on('unsubscribed', (ctx) => {
    subs = subs.filter((s) => s.channel !== ctx.channel)
  })
  c.on('disconnected', (ctx) => {
    if (client !== c) return
    client = null
    c.removeAllListeners()
    setLive(false)
    console.warn('[realtime] off:', ctx.reason)
    retryLater(REALTIME_OFF_RETRY_MS)
  })
  c.on('publication', (ctx) => {
    if (presenceRollback(ctx.channel, ctx.data)) {
      setPresenceMode(presenceModeAfter({ kind: 'rollback' }))
      return
    }
    const topic = pokeTopic(ctx.channel, ctx.data)
    if (topic) deliver(topic, ctx.data)
  })
  client = c
  c.connect()
}

function sync() {
  const who = wantedOwner()
  if (!who) {
    teardown()
    return
  }
  if (owner && owner !== who) teardown()
  if (client || opening || retryTimer) return
  void open(who)
}

function watch() {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener(SECRETS_CHANGED_EVENT, sync)
  useAccounts.subscribe(sync)
}

/** Keeps the connection up while at least one window part needs it; the returned function lets go. */
export function retainRealtime(): () => void {
  holders += 1
  watch()
  sync()
  let released = false
  return () => {
    if (released) return
    released = true
    holders -= 1
    sync()
  }
}
