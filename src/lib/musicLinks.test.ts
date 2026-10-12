import { expect, test } from 'bun:test'
import { parseMusicLink, restoreLinks } from './musicLinks'

const LIST = 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'

// Вставленный текст → что уйдёт в плеер. Адрес плеера собирается заново из
// распознанного идентификатора: в него не должно попасть ничего из вставленного.
test('ссылка → ключ и адрес плеера', () => {
  const cases: [string, string, string, string][] = [
    ['https://www.youtube.com/playlist?list=' + LIST, 'yt:l:' + LIST, 'https://www.youtube-nocookie.com/embed/videoseries?list=' + LIST, 'обычная ссылка на плейлист'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=' + LIST + '&index=3', 'yt:l:' + LIST, 'https://www.youtube-nocookie.com/embed/videoseries?list=' + LIST, 'ролик, открытый из плейлиста, — это плейлист'],
    ['music.youtube.com/playlist?list=' + LIST, 'yt:l:' + LIST, 'https://www.youtube-nocookie.com/embed/videoseries?list=' + LIST, 'YouTube Music и адрес без https'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'yt:v:dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'короткая ссылка на один ролик'],
    ['https://soundcloud.com/forss/sets/soulhack?si=x&utm=y', 'sc:forss/sets/soulhack', 'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fforss%2Fsets%2Fsoulhack', 'плейлист SoundCloud без хвоста отслеживания'],
    ['https://m.soundcloud.com/Forss/flickermood', 'sc:forss/flickermood', 'https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2FForss%2Fflickermood', 'мобильный адрес трека'],
  ]
  for (const [raw, key, embed, why] of cases) {
    const v = parseMusicLink(raw)
    expect(v.ok, why).toBe(true)
    if (!v.ok) continue
    expect(v.link.key, why).toBe(key)
    expect(v.link.embed, why).toBe(embed)
  }
})

test('чужое и непроигрываемое отклоняется с объяснением', () => {
  const cases: [string, string, string][] = [
    ['https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', '30 секунд', 'Spotify целиком вне приложения не играет — человеку говорим почему'],
    ['https://music.yandex.ru/users/x/playlists/3', 'YouTube и SoundCloud', 'сервис, которым плеер не управляет'],
    ['https://youtube.com.evil.example/playlist?list=' + LIST, 'YouTube и SoundCloud', 'домен, только похожий на YouTube'],
    ['https://evil.example/?u=https://www.youtube.com/playlist?list=' + LIST, 'YouTube и SoundCloud', 'YouTube в параметре чужого адреса'],
    ['javascript:alert(1)', 'не ссылка', 'не http — не ссылка'],
    ['плейлист для игры', 'не ссылка', 'обычный текст'],
    ['https://www.youtube.com/playlist?list=WL', 'личный список', '«Смотреть позже» открывается только владельцу'],
    ['https://www.youtube.com/feed/library', 'ни плейлиста, ни ролика', 'страница YouTube без музыки'],
    ['https://soundcloud.com/discover', 'плейлист, трек или автора', 'служебная страница SoundCloud'],
  ]
  for (const [raw, part, why] of cases) {
    const v = parseMusicLink(raw)
    expect(v.ok, why).toBe(false)
    if (!v.ok) expect(v.error, why).toContain(part)
  }
})

test('сохранённые ссылки перепроверяются и не двоятся', () => {
  const got = restoreLinks(['https://www.youtube.com/playlist?list=' + LIST, 'https://youtube.com/playlist?list=' + LIST, 'file:///etc/passwd', '', 'https://soundcloud.com/forss/sets/soulhack'])
  expect(got.map((l) => l.key), 'битая запись и повтор не должны попасть в плейлист').toEqual(['yt:l:' + LIST, 'sc:forss/sets/soulhack'])
})
