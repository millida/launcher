import { Centrifuge, UnauthorizedError } from 'centrifuge'
import { hasTauri } from '../ipc/tauri'
import { getMillidaAccount, useAccounts } from '../state/accounts'
import { api, hasMillidaAccount } from './api'
import { SECRETS_CHANGED_EVENT } from './secure'
import {
  REALTIME_ERROR_RETRY_MS,
  REALTIME_OFF_RETRY_MS,
  REALTIME_TOPICS,
  pokeTopic,
  readRealtimeGrant,
  type RealtimeGrant,
  type RealtimeTopic,
} from './realtimePace'

export type { RealtimeTopic } from './realtimePace'

type Handler = () => void
type DataHandler = (data: unknown) => void
type LiveHandler = (live: boolean) => void

const handlers = new Map<RealtimeTopic, Set<Handler>>()
const dataHandlers = new Map<RealtimeTopic, Set<DataHandler>>()
const liveHandlers = new Set<LiveHandler>()

let client: Centrifuge | null = null
let owner = ''
let live = false
let holders = 0
let generation = 0
let opening = false
let retryTimer: ReturnType<typeof setTimeout> | undefined
let watching = false

function safely(run: () => void) {
  try {
    run()
  } catch (e) {
    console.warn('[realtime] handler failed', e)
  }
}

function setLive(next: boolean) {
  if (live === next) return
  live = next
  liveHandlers.forEach((h) => safely(() => h(next)))
}

function emit(topic: RealtimeTopic) {
  handlers.get(topic)?.forEach((h) => safely(h))
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

export function onRealtimeLiveChange(handler: LiveHandler): () => void {
  liveHandlers.add(handler)
  return () => void liveHandlers.delete(handler)
}

function wantedOwner(): string {
  if (!holders || !hasTauri() || !hasMillidaAccount()) return ''
  return getMillidaAccount()?.id || 'millida'
}

async function fetchGrant(): Promise<RealtimeGrant> {
  return readRealtimeGrant(await api('/realtime/token'))
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
}

function retryLater(ms: number) {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    sync()
  }, ms)
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
    getToken: async () => {
      const next = await fetchGrant()
      if (!next.enabled) throw new UnauthorizedError('realtime disabled')
      return next.token
    },
    // Every launcher reconnects after a server restart; a wide backoff keeps that from becoming a wave.
    minReconnectDelay: 2_000,
    maxReconnectDelay: 60_000,
  })
  c.on('connected', () => {
    setLive(true)
    REALTIME_TOPICS.forEach(emit)
  })
  c.on('connecting', () => setLive(false))
  c.on('disconnected', (ctx) => {
    if (client !== c) return
    client = null
    c.removeAllListeners()
    setLive(false)
    console.warn('[realtime] off:', ctx.reason)
    retryLater(REALTIME_OFF_RETRY_MS)
  })
  c.on('publication', (ctx) => {
    const topic = pokeTopic(ctx.channel, ctx.data)
    if (!topic) return
    emit(topic)
    dataHandlers.get(topic)?.forEach((h) => safely(() => h(ctx.data)))
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
