import type { MilliItem, MilliMessage, MilliPack, MilliSession, MilliStatus } from './milli'

/*
 * Демо Милли для ?preview=user (только dev, в релиз не попадает: модуль
 * грузится динамически из ветки import.meta.env.DEV). Проекты Modrinth
 * настоящие — id, slug, иконки из ответа /v2/projects 24.09.2026.
 */

const cdn = (id: string, file: string) => 'https://cdn.modrinth.com/data/' + id + '/' + file

const DEMO_MODS: MilliItem[] = [
  { projectId: 'P7dR8mSH', slug: 'fabric-api', title: 'Fabric API', icon: cdn('P7dR8mSH', 'icon.png'), why: 'Основа модов Fabric — без неё они не запустятся', source: 'modrinth', base: true },
  { projectId: 'AANobbMI', slug: 'sodium', title: 'Sodium', icon: cdn('AANobbMI', '295862f4724dc3f78df3447ad6072b2dcd3ef0c9_96.webp'), why: 'Больше FPS: быстрая отрисовка мира', source: 'modrinth', base: true },
  { projectId: 'mOgUt4GM', slug: 'modmenu', title: 'Mod Menu', icon: cdn('mOgUt4GM', '5a20ed1450a0e1e79a1fe04e61bb4e5878bf1d20.png'), why: 'Список модов и их настройки прямо в меню', source: 'modrinth', base: true },
  { projectId: 'mMTOWOaA', slug: 'zombie-awareness', title: 'Zombie Awareness', icon: cdn('mMTOWOaA', 'a05ff0c2146142ba350fe458c6a9d0691cdfd0a8_96.webp'), why: 'Зомби идут на шум, свет и запах крови', source: 'modrinth', base: false },
  { projectId: 'iAqn9vit', slug: 'mo-zombies-wave', title: "Mo' Zombies Wave", icon: cdn('iAqn9vit', 'b7e0c1ad55a068448762f370349bb56cc04d249a_96.webp'), why: '13 новых видов зомби со своими повадками', source: 'modrinth', base: false },
  { projectId: 'owDBGfRd', slug: 'zombie-horse-spawn', title: 'Zombie Horse Spawn', icon: cdn('owDBGfRd', 'd78c8cbacb6bde5cfac9d65431b459216ead5071_96.webp'), why: 'Зомби-всадники на мёртвых лошадях', source: 'modrinth', base: false },
  { projectId: 'cChd25Tw', slug: 'cave-dweller-fabric', title: 'Cave Dweller Fabric', icon: cdn('cChd25Tw', '99cc719af9b3dcee0e8fcece688d7d3f6ebd49a8_96.webp'), why: 'Тварь в пещерах, которая охотится молча', source: 'modrinth', base: false },
  { projectId: 'p1WH6sHr', slug: 'from-the-fog', title: 'From The Fog', icon: cdn('p1WH6sHr', 'bb4b839b9cd0f1dc51ee5ac08081fb76df42ebe1_96.webp'), why: 'Херобрин следит из тумана', source: 'modrinth', base: false },
  { projectId: 'Pf8PJBb5', slug: 'true-darkness-refabricated', title: 'True Darkness Refabricated', icon: cdn('Pf8PJBb5', '93a5193f0aedb0d5822caa569df212f6f7360473_96.webp'), why: 'Ночь и пещеры по-настоящему чёрные', source: 'modrinth', base: false },
  { projectId: 'yBW8D80W', slug: 'lambdynamiclights', title: 'LambDynamicLights', icon: cdn('yBW8D80W', 'd4f5c3ff8df7caf024178b04eca6d69f95979cfe_96.webp'), why: 'Факел в руке освещает путь', source: 'modrinth', base: false },
  { projectId: 'qyVF9oeo', slug: 'sound-physics-remastered', title: 'Sound Physics Remastered', icon: cdn('qyVF9oeo', '798fbfae58ec95ad51f3e1d522b43227306c326c.png'), why: 'Эхо в пещерах, звук глохнет за стеной', source: 'modrinth', base: false },
  { projectId: 'fLAIO8XF', slug: 'abandoned-villages', title: '80% Abandoned Villages', icon: cdn('fLAIO8XF', '2b28d7e01921d9c314da85ff0c50ab3f02291a41.jpeg'), why: 'Почти все деревни — заброшенные и зомби', source: 'modrinth', base: false },
  { projectId: 'dxrOAhj5', slug: 'horror-messages', title: 'Horror messages', icon: cdn('dxrOAhj5', '2f352e073728145924cb3be5d33898adef7dda25_96.webp'), why: 'Жуткие сообщения в чате раз в 10–15 минут', source: 'modrinth', base: false },
]

const now = () => new Date().toISOString()
const tomorrow = () => {
  const d = new Date()
  d.setUTCHours(24, 0, 0, 0)
  return d.toISOString()
}

let used = 0
const LIMIT = 5
const sessions = new Map<string, MilliSession>()
let seq = 0

/** `&milliplus=1` — демо как у подписчика PLUS: «Улучшенная сборка» открыта. */
function demoPlus(): boolean {
  try {
    return new URLSearchParams(location.search).get('milliplus') === '1'
  } catch {
    return false
  }
}

function status(): MilliStatus {
  return {
    enabled: true,
    blocked: false,
    plus: demoPlus(),
    day: { used, limit: LIMIT, remaining: Math.max(0, LIMIT - used), resetAt: tomorrow() },
    month: { used, limit: 30, remaining: 30 - used, resetAt: tomorrow() },
    features: { extras: false, server: false, enhanced: true },
  }
}

function pack(mc: string, loader: 'fabric'): MilliPack {
  return {
    buildId: 'demo-' + ++seq,
    title: 'Ночь мертвецов',
    mcVersion: mc,
    loader,
    mods: DEMO_MODS,
    resourcepacks: [],
    shaders: [],
    shaderLoader: null,
    maps: [],
    links: [],
    excluded: [],
    notes: 'Играй ночью и держи факелы под рукой',
    locked: { extras: true },
  }
}

const msg = (role: 'user' | 'assistant', text: string, p: MilliPack | null = null, suggestions: string[] = []): MilliMessage => ({
  id: 'm' + ++seq,
  role,
  text,
  createdAt: now(),
  pack: p,
  suggestions,
})

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function milliDemoAnswer(path: string, init?: RequestInit): Promise<unknown> {
  const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null
  if (path === '/catalog/milli/status') return status()
  if (path === '/catalog/milli/limits') return { free: { day: 5, month: 30 }, plus: { day: 100, month: 500 }, period: 'utc', plusExtras: [] }
  if (path === '/catalog/milli/sessions') {
    return { items: [...sessions.values()].map(({ id, title, updatedAt }) => ({ id, title, updatedAt })).reverse() }
  }
  const one = /^\/catalog\/milli\/sessions\/(.+)$/.exec(path)
  if (one) {
    const s = sessions.get(decodeURIComponent(one[1]!))
    if (!s) throw new Error('http 404')
    return s
  }
  if (path === '/catalog/milli/messages') {
    await wait(2200)
    if (used >= LIMIT) throw new Error('http 429 milli_limit day')
    used++
    const text = String(body?.text || '')
    const mc = /\b1\.\d{1,2}(\.\d{1,2})?\b/.exec(text)?.[0] || '1.20.1'
    let s = body?.sessionId ? sessions.get(body.sessionId) : undefined
    if (!s) {
      s = { id: 's' + ++seq, title: text.slice(0, 40) || 'Новый чат', updatedAt: now(), messages: [] }
      sessions.set(s.id, s)
    }
    const user = msg('user', text)
    const first = s.messages.length === 0
    const reply = first
      ? msg('assistant', 'Собрала хоррор на ' + mc + ': зомби, туман и тёмные пещеры.\nСними галочки с лишнего и жми «Установить».', pack(mc, 'fabric'), ['Добавь шейдеры', 'Поменьше модов', 'Без Херобрина'])
      : msg('assistant', 'Поправила сборку — глянь список ещё раз.', pack(mc, 'fabric'), ['Ещё страшнее'])
    if (body?.enhanced && reply.pack) {
      reply.pack.review = {
        added: [{ title: 'Iris Shaders' }, { title: 'FerriteCore' }],
        removed: [{ title: 'Horror messages', reason: 'Спамит в чат — мешает игре с друзьями' }],
      }
    }
    s.messages.push(user, reply)
    s.updatedAt = now()
    return { sessionId: s.id, user, reply, status: status() }
  }
  if (/\/install$/.test(path)) {
    await wait(600)
    return { code: 'MILLI7', url: 'https://millida.net/p/MILLI7', deeplink: 'millida://pack/MILLI7', files: 13, mcVersion: '1.20.1', loader: 'fabric', skipped: [] }
  }
  if (/\/server$/.test(path)) throw new Error('http 403 milli_plus')
  throw new Error('http 404')
}
