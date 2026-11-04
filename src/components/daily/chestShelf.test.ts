import { expect, test } from 'bun:test'
import { holdShelfChests, shelfYields } from './chestShelf'

test('during a reveal the shelf gives up its live chests, the scene keeps its own', () => {
  expect(shelfYields(false), 'no reveal: nothing yields').toBe(false)
  const release = holdShelfChests()
  expect(shelfYields(false), 'a shelf chest behind the reveal turns into its drawing').toBe(true)
  expect(shelfYields(true), 'a chest won in the reveal itself stays 3D').toBe(false)
  release()
  expect(shelfYields(false), 'the shelf comes back after the reveal').toBe(false)
})
