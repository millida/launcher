// Anonymous socket during login: waits on api.millida.net for the message "login confirmed" instead of polling often. There is no token yet, nothing personal is sent.
import { REALTIME_CLIENT_NAME, REALTIME_SOCKET_URL, loginPushed } from './realtimePace'

export interface LoginWatch {
  subscribed: () => boolean
  stop: () => void
}

/**
 * Before sign-in there is no account token, so the login channel is joined over
 * an anonymous connection. Any failure only reports itself through `onDown`: the
 * device-code poll keeps working without the socket.
 */
export function watchLoginChannel(channel: string, onPush: () => void, onDown: () => void): LoginWatch {
  let up = false
  let stopped = false
  let stopSocket: (() => void) | null = null
  const down = () => {
    if (!up) return
    up = false
    onDown()
  }
  // Клиент сокета — отдельный чанк (не в стартовом бандле): если он не пришёл, опрос кода работает и так.
  void import('centrifuge')
    .then(({ Centrifuge }) => {
      if (stopped) return
      const c = new Centrifuge(REALTIME_SOCKET_URL, {
        name: REALTIME_CLIENT_NAME,
        minReconnectDelay: 2_000,
        maxReconnectDelay: 15_000,
      })
      const sub = c.newSubscription(channel)
      sub.on('subscribed', () => {
        up = true
      })
      sub.on('subscribing', down)
      sub.on('unsubscribed', down)
      sub.on('publication', (ctx) => {
        if (loginPushed(channel, ctx.channel, ctx.data)) onPush()
      })
      c.on('disconnected', down)
      stopSocket = () => {
        sub.removeAllListeners()
        c.removeAllListeners()
        c.disconnect()
      }
      sub.subscribe()
      c.connect()
    })
    .catch(() => onDown())
  return {
    subscribed: () => up,
    stop: () => {
      stopped = true
      up = false
      stopSocket?.()
    },
  }
}
