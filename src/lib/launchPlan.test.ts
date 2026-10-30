import { expect, test } from 'bun:test'
import { afterRaise, notLaunched, notLaunchedNotice, prepareLaunch } from './launchPlan'

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

test('sign-in starts while the build is still updating, and care waits for the update', async () => {
  const log: string[] = []
  const got = await prepareLaunch({
    freshen: async () => {
      log.push('freshen:start')
      await tick(40)
      log.push('freshen:end')
    },
    care: async () => {
      log.push('care')
    },
    auth: async () => {
      log.push('auth:start')
      await tick(10)
      log.push('auth:end')
      return 'creds'
    },
  })
  expect(got).toBe('creds')
  expect(log.indexOf('auth:start'), 'sign-in must not queue behind the update').toBeLessThan(log.indexOf('freshen:end'))
  expect(log.indexOf('care'), 'the options and the memory check are about the build the update left').toBeGreaterThan(
    log.indexOf('freshen:end'),
  )
})

test('the whole preparation takes as long as the slowest side, not the sum', async () => {
  const started = Date.now()
  await prepareLaunch({
    freshen: () => tick(60),
    care: () => tick(60),
    auth: () => tick(110).then(() => 1),
  })
  expect(Date.now() - started, 'auth 110 ms next to 120 ms of build work is about 120 ms, not 230').toBeLessThan(190)
})

test('a failure of the build side wins, and a failing sign-in is still reported', async () => {
  await expect(
    prepareLaunch({
      freshen: async () => {
        throw new Error('cancelled')
      },
      care: async () => {},
      auth: async () => {
        throw new Error('no session')
      },
    }),
  ).rejects.toThrow('cancelled')
  await expect(
    prepareLaunch({
      freshen: async () => {},
      care: async () => {},
      auth: async () => {
        throw new Error('no session')
      },
    }),
  ).rejects.toThrow('no session')
})

test('a care step that never runs when the update failed leaves no unhandled rejection', async () => {
  let careRan = false
  await expect(
    prepareLaunch({
      freshen: async () => {
        throw new Error('update failed')
      },
      care: async () => {
        careRan = true
      },
      auth: async () => 1,
    }),
  ).rejects.toThrow('update failed')
  expect(careRan, 'care is about the updated build; there is none').toBe(false)
})

const answers: { answer: unknown; want: ReturnType<typeof notLaunched>; why: string }[] = [
  { answer: 'started', want: null, why: 'a new game is the normal case' },
  { answer: 'focused', want: 'focused', why: 'the window came forward' },
  { answer: 'running', want: 'running', why: 'running, nothing to raise' },
  { answer: 'starting', want: 'starting', why: 'the first start is under way' },
  { answer: undefined, want: null, why: 'an old core answers nothing useful and is treated as a start' },
  { answer: 'FOCUSED', want: null, why: 'the words are exact' },
]

test.each(answers)('notLaunched: $why', ({ answer, want }) => {
  expect(notLaunched(answer)).toBe(want)
})

test('only a window that did not come forward needs a notice', () => {
  const say = { running: 'running', starting: 'starting' }
  expect(notLaunchedNotice('focused', say), 'the raised window is the message').toBeNull()
  expect(notLaunchedNotice('running', say)).toBe('running')
  expect(notLaunchedNotice('starting', say)).toBe('starting')
})

test('Play on a running build: raised window ends it, an unknown game goes the usual way', () => {
  const say = { running: 'running', starting: 'starting' }
  expect(afterRaise('focused', say)).toEqual({ launch: false, notice: null })
  expect(afterRaise('running', say)).toEqual({ launch: false, notice: 'running' })
  expect(afterRaise(null, say), 'the core does not have that game: prepare and launch').toEqual({ launch: true })
  expect(afterRaise(undefined, say)).toEqual({ launch: true })
})
