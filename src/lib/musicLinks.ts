export type LinkService = 'youtube' | 'soundcloud'

export interface MusicLink {
  service: LinkService
  key: string
  /** Canonical address: what is stored and shown, never the pasted text. */
  url: string
  title: string
  embed: string
}

export type LinkVerdict = { ok: true; link: MusicLink } | { ok: false; error: string }

export const MAX_LINKS = 8
export const MAX_LINK_URL = 256

export const SERVICE_NAME: Record<LinkService, string> = { youtube: 'YouTube', soundcloud: 'SoundCloud' }

const YT_EMBED = 'https://www.youtube-nocookie.com/embed/'
const SC_EMBED = 'https://w.soundcloud.com/player/?url='

const YT_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com']
const SPOTIFY_HOSTS = ['spotify.com', 'spotify.link']
const SC_PAGES = ['discover', 'search', 'you', 'upload', 'stream', 'feed', 'settings', 'messages', 'notifications', 'charts', 'pages']
/** Watch later, Liked videos, Liked music: private to their owner, an embedded player gets nothing. */
const YT_PRIVATE_LISTS = ['WL', 'LL', 'LM']

const NOT_A_LINK = 'Это не ссылка — вставь адрес плейлиста целиком'
const UNKNOWN_SITE = 'Играем плейлисты YouTube и SoundCloud — вставь ссылку оттуда'
const SPOTIFY = 'Spotify вне своего приложения отдаёт только отрывки по 30 секунд. Вставь плейлист с YouTube или SoundCloud'
const YT_NOTHING = 'В ссылке нет ни плейлиста, ни ролика — открой плейлист на YouTube и скопируй адрес'
const YT_PRIVATE = 'Это личный список YouTube, он открывается только тебе. Сделай обычный плейлист с доступом по ссылке'
const SC_NOTHING = 'Нужна ссылка на плейлист, трек или автора SoundCloud'
const TOO_LONG = 'Ссылка слишком длинная — скопируй адрес плейлиста без лишних параметров'

const fail = (error: string): LinkVerdict => ({ ok: false, error })

const hostIs = (host: string, list: string[]) => list.some((h) => host === h || host.endsWith('.' + h))

function toUrl(raw: string): URL | null {
  const text = raw.trim()
  if (!text || /\s/.test(text)) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : 'https://' + text)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

function youtube(url: URL): LinkVerdict {
  const list = url.searchParams.get('list') || ''
  const video = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})(?![\w-])/.exec(url.href)?.[1] || ''
  if (YT_PRIVATE_LISTS.includes(list)) return fail(YT_PRIVATE)
  if (/^[\w-]{12,64}$/.test(list)) {
    return {
      ok: true,
      link: {
        service: 'youtube',
        key: 'yt:l:' + list,
        url: 'https://www.youtube.com/playlist?list=' + list,
        title: 'Плейлист YouTube',
        embed: YT_EMBED + 'videoseries?list=' + list,
      },
    }
  }
  if (!video) return fail(YT_NOTHING)
  return {
    ok: true,
    link: { service: 'youtube', key: 'yt:v:' + video, url: 'https://youtu.be/' + video, title: 'Ролик YouTube', embed: YT_EMBED + video },
  }
}

const words = (slug: string) => {
  try {
    return decodeURIComponent(slug).replace(/[-_]+/g, ' ').trim()
  } catch {
    return slug
  }
}

function soundcloud(url: URL): LinkVerdict {
  const parts = url.pathname.split('/').filter(Boolean)
  const first = (parts[0] || '').toLowerCase()
  if (!parts.length || SC_PAGES.includes(first)) return fail(SC_NOTHING)
  if (parts.some((p) => !/^[\w.%-]+$/.test(p))) return fail(SC_NOTHING)
  const path = parts.slice(0, 4).join('/')
  const canon = 'https://soundcloud.com/' + path
  if (canon.length > MAX_LINK_URL) return fail(TOO_LONG)
  const name = parts[1] === 'sets' ? parts[2] : parts[1]
  return {
    ok: true,
    link: {
      service: 'soundcloud',
      key: 'sc:' + path.toLowerCase(),
      url: canon,
      title: name ? words(parts[0]!) + ' — ' + words(name) : words(parts[0]!),
      embed: SC_EMBED + encodeURIComponent(canon),
    },
  }
}

/** The pasted text never reaches the player: the address is rebuilt from the recognised id. */
export function parseMusicLink(raw: string): LinkVerdict {
  const url = toUrl(raw)
  if (!url) return fail(NOT_A_LINK)
  const host = url.hostname.toLowerCase()
  if (hostIs(host, YT_HOSTS)) return youtube(url)
  if (host === 'soundcloud.com' || host === 'www.soundcloud.com' || host === 'm.soundcloud.com') return soundcloud(url)
  if (hostIs(host, SPOTIFY_HOSTS)) return fail(SPOTIFY)
  return fail(UNKNOWN_SITE)
}

/** Stored addresses go through the same check as pasted ones: another launcher version may have written them. */
export function restoreLinks(stored: string[]): MusicLink[] {
  const out: MusicLink[] = []
  for (const raw of stored) {
    const v = parseMusicLink(raw)
    if (v.ok && !out.some((l) => l.key === v.link.key) && out.length < MAX_LINKS) out.push(v.link)
  }
  return out
}
