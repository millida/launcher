import { Centrifuge } from 'centrifuge'
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
  const c = new Centrifuge(REALTIME_SOCKET_URL, {
    name: REALTIME_CLIENT_NAME,
    minReconnectDelay: 2_000,
    maxReconnectDelay: 15_000,
  })
  const sub = c.newSubscription(channel)
  let up = false
  const down = () => {
    if (!up) return
    up = false
    onDown()
  }
  sub.on('subscribed', () => {
    up = true
  })
  sub.on('subscribing', down)
  sub.on('unsubscribed', down)
  sub.on('publication', (ctx) => {
    if (loginPushed(channel, ctx.channel, ctx.data)) onPush()
  })
  c.on('disconnected', down)
  sub.subscribe()
  c.connect()
  return {
    subscribed: () => up,
    stop: () => {
      up = false
      sub.removeAllListeners()
      c.removeAllListeners()
      c.disconnect()
    },
  }
}
