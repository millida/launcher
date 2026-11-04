import { expect, test } from 'bun:test'
import { fullShotKey, shotCache, shotKey, storedShot, type OutfitShot } from './outfitShotStore'

test('the cache key ignores the order of the items and keeps the frame and the tile shape', () => {
  expect(shotKey('s.png', true, ['b', 'a'])).toBe(shotKey('s.png', true, ['a', 'b']))
  expect(shotKey('s.png', true, ['a'])).not.toBe(shotKey('s.png', false, ['a']))
  expect(fullShotKey('s.png', false, ['a'], 'head', 0.75)).toBe(shotKey('s.png', false, ['a']) + '|head|0.75')
})

test('a shot already in memory comes back without IndexedDB or the 3D module', async () => {
  const shot: OutfitShot = { url: 'blob:x', dressed: 1 }
  const key = fullShotKey('mem.png', false, ['emote'], 'body', 0.75)
  shotCache.set(key, Promise.resolve(shot))
  expect(await storedShot(key)).toBe(shot)
  shotCache.delete(key)
})

test('without IndexedDB a miss is null, and a miss is not kept', async () => {
  const key = fullShotKey('none.png', false, ['x'], 'full', 0.75)
  expect(await storedShot(key)).toBeNull()
  expect(shotCache.has(key)).toBe(false)
})
