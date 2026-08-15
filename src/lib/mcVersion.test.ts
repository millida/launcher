import { expect, test } from 'bun:test'
import {
  isKnownVersion,
  pickBuildForServer,
  pickVersionForServer,
  serverVersions,
  setKnownVersions,
  versionFits,
  versionMajor,
} from './mcVersion'

// input -> verdict. A wrong "fits" sends the player into a server that will
// refuse the handshake, a wrong "does not fit" nags about a build that works.
const FIT: [string, string[], boolean, string][] = [
  ['26.2', ['1.21'], false, 'the reported case: newest build against a 1.21 server'],
  ['1.21.4', ['1.21'], true, 'full release under the major the server reports'],
  ['1.21', ['1.21.4'], true, 'server reports a full release, build sits on the major'],
  ['1.20.1', ['1.21', '1.20'], true, 'one of several server versions matches'],
  ['1.20.1', ['1.21'], false, 'neighbouring major is still a refused handshake'],
  ['26.2', [], true, 'server did not report versions - nothing to judge'],
  ['', ['1.21'], false, 'build without a version cannot be vouched for'],
]

test('a build fits only when it shares a major with some server version', () => {
  for (const [build, wanted, want, why] of FIT) {
    expect(versionFits(build, wanted), why).toBe(want)
  }
})

test('only plain numeric versions are judged', () => {
  expect(serverVersions(['1.21', ' 1.20.1 ', '1.21', '1.16-1.21', 'Bedrock', ''])).toEqual(['1.21', '1.20.1'])
  expect(versionFits('26.2', serverVersions(['1.16-1.21'])), 'a range says nothing, so no nagging').toBe(true)
})

// The reported case: a rating entry claiming 1.22..1.29 put releases that never
// existed into the version filter of the server list.
test('a version Mojang never released is dropped once the release list is known', () => {
  setKnownVersions(['26.2', '1.21.4', '1.21', '1.20.1'])
  expect(serverVersions(['1.21', '1.22', '1.29', '1.20.1'])).toEqual(['1.21', '1.20.1'])
  expect(isKnownVersion('1.21.4'), 'a full release from the manifest').toBe(true)
  expect(isKnownVersion('1.21'), 'the major of a full release the rating reports instead').toBe(true)
  expect(isKnownVersion('26.2'), 'calendar releases are versions too').toBe(true)
  expect(isKnownVersion('1.22')).toBe(false)
  setKnownVersions([])
})

test('an unknown release list judges nothing, so real versions are never hidden', () => {
  setKnownVersions([])
  expect(serverVersions(['1.21', '1.22'])).toEqual(['1.21', '1.22'])
  expect(isKnownVersion('1.22')).toBe(true)
})

test('major keeps calendar versions apart', () => {
  expect(versionMajor('1.21.4')).toBe('1.21')
  expect(versionMajor('26.2')).toBe('26.2')
  expect(versionMajor('26.2.1')).toBe('26.2')
})

test('an exact build wins over a same-major one', () => {
  const builds = [{ version: '26.2' }, { version: '1.21.4' }, { version: '1.21' }]
  expect(pickBuildForServer(builds, ['1.21'])).toEqual({ version: '1.21' })
  expect(pickBuildForServer(builds, ['1.21.1'])).toEqual({ version: '1.21.4' })
  expect(pickBuildForServer(builds, ['1.7.10'])).toBe(null)
  expect(pickBuildForServer(builds, [])).toBe(null)
})

test('the new-build preset falls back to the closest offered release', () => {
  const available = ['26.2', '1.21.4', '1.21.1', '1.20.1']
  expect(pickVersionForServer(available, ['1.21.1'])).toBe('1.21.1')
  expect(pickVersionForServer(available, ['1.21'])).toBe('1.21.4')
  expect(pickVersionForServer(available, ['1.7.10'])).toBe('')
})
