import { beforeEach, expect, test } from 'bun:test'
import { resetScreenOpen, screenClicked, screenPainted } from './screenOpen'

beforeEach(() => resetScreenOpen())

test('the time is from the click to the first frame of the new screen', () => {
  screenClicked('rubies', 'play', 1000)
  expect(screenPainted('rubies', 1180)).toEqual({ screen: 'rubies', from: 'play', ms: 180, visit: 'first' })
})

test('the second visit to a screen is marked as a repeat, so cold and warm opens are told apart', () => {
  screenClicked('friends', 'play', 0)
  expect(screenPainted('friends', 400)?.visit).toBe('first')
  screenClicked('play', 'friends', 1000)
  screenPainted('play', 1100)
  screenClicked('friends', 'play', 2000)
  expect(screenPainted('friends', 2060), 'the chunk is loaded now; this is the number that shows the render itself').toEqual({
    screen: 'friends',
    from: 'play',
    ms: 60,
    visit: 'repeat',
  })
})

test('the screen the session starts on counts as visited but is never reported', () => {
  expect(screenPainted('play', 500), 'nobody clicked to get here').toBeNull()
  screenClicked('builds', 'play', 1000)
  screenPainted('builds', 1050)
  screenClicked('play', 'builds', 2000)
  expect(screenPainted('play', 2030)?.visit, 'the lobby was seen at the start').toBe('repeat')
})

test('the paint of another screen does not steal a click that is still waiting', () => {
  screenClicked('rubies', 'play', 0)
  expect(screenPainted('friends', 100), 'a different screen is not what was clicked').toBeNull()
  expect(screenPainted('rubies', 200)?.ms, 'the click is still the rubies one').toBe(200)
})

test('a second click replaces the first: only the screen that really opened is measured', () => {
  screenClicked('rubies', 'play', 0)
  screenClicked('friends', 'play', 120)
  expect(screenPainted('rubies', 300), 'the rubies transition was interrupted').toBeNull()
  expect(screenPainted('friends', 300)?.ms).toBe(180)
})

test('a click older than fifteen seconds is not a measurement of the screen', () => {
  screenClicked('hosting', 'play', 0)
  expect(screenPainted('hosting', 16_000)).toBeNull()
})

test('a jump to the screen already open starts nothing', () => {
  screenClicked('play', 'play', 0)
  expect(screenPainted('play', 50)).toBeNull()
})

test('a restless session sends at most sixty openings', () => {
  let sent = 0
  for (let i = 0; i < 100; i++) {
    screenClicked(i % 2 ? 'play' : 'builds', i % 2 ? 'builds' : 'play', i * 10)
    if (screenPainted(i % 2 ? 'play' : 'builds', i * 10 + 5)) sent += 1
  }
  expect(sent).toBe(60)
})
