import { expect, test } from 'bun:test'
import { MAX_PATCH_SHARE, buildOffer, companions, mergeOffer, sameCompanions, sha256 } from './delta-release.mjs'

// Читает предложение так же строго, как ядро (selfdelta.rs parse_offer): хеши — 64 строчные hex-цифры, ссылки https.
const hex = (s) => /^[0-9a-f]{64}$/.test(s)

test('предложение для манифеста: то, что ядро согласится прочитать', () => {
  const exe = Buffer.from('new executable bytes')
  const offer = buildOffer({
    exe,
    signature: 'c2lnbmF0dXJl',
    patches: [{ from: sha256(Buffer.from('old')), version: '2.0.279', file: 'abc-to-2.0.280.zst', size: 12, sha256: sha256(Buffer.from('patch')) }],
    urlBase: 'https://launcher-storage.millida.net/2.0.280/windows-x86_64/delta',
    mirrorBase: 'https://github.com/millida/launcher/releases/download/v2.0.280/',
  })
  expect(offer.v).toBe(1)
  expect(offer.exe).toEqual({ size: exe.length, sha256: sha256(exe), signature: 'c2lnbmF0dXJl' })
  expect(hex(offer.exe.sha256) && hex(offer.patches[0].from) && hex(offer.patches[0].sha256)).toBe(true)
  expect(offer.patches[0].url).toBe('https://launcher-storage.millida.net/2.0.280/windows-x86_64/delta/abc-to-2.0.280.zst')
  expect(offer.patches[0].mirror).toBe('https://github.com/millida/launcher/releases/download/v2.0.280/abc-to-2.0.280.zst')
  const without = buildOffer({ exe, signature: 's', patches: [{ from: 'a'.repeat(64), version: '1', file: 'f.zst', size: 1, sha256: 'b'.repeat(64) }], urlBase: 'https://x/d/' })
  expect('mirror' in without.patches[0]).toBe(false)
})

test('патч только на exe: другие установленные файлы должны совпасть, шум NSIS не в счёт', () => {
  const files = (extra = {}) => ({
    'millida-launcher.exe': 'e1',
    'WebView2Loader.dll': 'dll1',
    'uninstall.exe': 'u-' + Math.random(),
    '$PLUGINSDIR/System.dll': 'p',
    '[NSIS].nsi': 'n',
    ...extra,
  })
  const a = companions(files(), 'millida-launcher.exe')
  const b = companions(files({ 'millida-launcher.exe': 'e2' }), 'millida-launcher.exe')
  expect(Object.keys(a)).toEqual(['WebView2Loader.dll'])
  expect(sameCompanions(a, b)).toBe(true)
  const changed = companions(files({ 'WebView2Loader.dll': 'dll2' }), 'millida-launcher.exe')
  expect(sameCompanions(a, changed), 'изменилась DLL — нужен установщик').toBe(false)
  const added = companions(files({ 'resources/new.bin': 'x' }), 'millida-launcher.exe')
  expect(sameCompanions(a, added), 'появился новый файл — нужен установщик').toBe(false)
})

test('предложение вставляется в запись платформы, не трогая установщик', () => {
  const manifest = { version: '2.0.280', platforms: { 'windows-x86_64': { url: 'https://x/setup.exe', signature: 'sig' }, 'darwin-aarch64': { url: 'https://x/app.tar.gz', signature: 's2' } } }
  const merged = mergeOffer(manifest, 'windows-x86_64', { v: 1 })
  expect(merged.platforms['windows-x86_64']).toEqual({ url: 'https://x/setup.exe', signature: 'sig', delta: { v: 1 } })
  expect(merged.platforms['darwin-aarch64']).toEqual(manifest.platforms['darwin-aarch64'])
  expect(manifest.platforms['windows-x86_64'].delta, 'исходный объект не меняется').toBeUndefined()
  expect(() => mergeOffer(manifest, 'linux-x86_64', {})).toThrow()
  expect(MAX_PATCH_SHARE).toBeLessThan(1)
})
