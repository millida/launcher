import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parsePlistXml, renderPlist } from './lib/plist.mjs'
import { assertVolumeName } from './lib/iso.mjs'
import { assertUdif, writeSectorCount } from './lib/udif.mjs'

/**
 * Builds a macOS bundle from an already compiled binary on any host OS.
 *
 * tauri-bundler gates its macOS code behind `#[cfg(target_os = "macos")]`, so a
 * Linux `tauri build --target *-apple-darwin` produces a binary but no bundle.
 * This mirrors the bundler, substituting rcodesign for codesign and xorriso for
 * hdiutil. Artifact names must match the native ones exactly — release globs
 * depend on them.
 */

const SECTOR_SIZE = 512
const WINDOW = { width: 640, height: 460 }
const README_NAME = 'Прочти меня.txt'
const ARCH_SUFFIX = { 'aarch64-apple-darwin': 'aarch64', 'x86_64-apple-darwin': 'x64' }
const ARCH_LABEL = { 'aarch64-apple-darwin': 'ARM', 'x86_64-apple-darwin': 'Intel' }
const VOLUME_NAME_LIMIT = 32
const MIN_SYSTEM_VERSION = { 'aarch64-apple-darwin': '11.0', 'x86_64-apple-darwin': '10.13' }

const APP_CATEGORY_TYPE = {
  Game: 'public.app-category.games',
  Utility: 'public.app-category.utilities',
  DeveloperTool: 'public.app-category.developer-tools',
  Entertainment: 'public.app-category.entertainment',
  Education: 'public.app-category.education',
}

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const target = arg('target')
if (!ARCH_SUFFIX[target]) throw new Error(`--target должен быть одним из: ${Object.keys(ARCH_SUFFIX).join(', ')}`)

const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const tauriDir = join(root, 'src-tauri')
const conf = JSON.parse(readFileSync(join(tauriDir, 'tauri.conf.json'), 'utf8'))

const productName = conf.productName
const version = arg('version', conf.version)
const identifier = conf.identifier
const binaryName = conf.mainBinaryName ?? JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], { cwd: tauriDir, encoding: 'utf8', maxBuffer: 64 << 20 })).packages[0].name

const outDir = join(tauriDir, 'target', target, 'release')
const macosDir = join(outDir, 'bundle', 'macos')
const dmgDir = join(outDir, 'bundle', 'dmg')
const appDir = join(macosDir, `${productName}.app`)
const contents = join(appDir, 'Contents')

const binary = join(outDir, binaryName)
if (!existsSync(binary)) throw new Error(`Не найден бинарь ${binary} — сначала cargo build --release --target ${target}`)

/**
 * Frontend assets are embedded only with the `tauri/custom-protocol` feature on;
 * without it `generate_context!` treats the build as dev and the webview falls
 * back to devUrl — a white window that still builds and signs cleanly.
 */
function assertFrontendEmbedded() {
  const indexHtml = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  const entries = [...indexHtml.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((m) => m[1])
  if (entries.length === 0) throw new Error('в dist/index.html нет ссылок на assets — фронтенд собран неправильно')

  const compiled = readFileSync(binary)
  const missing = entries.filter((entry) => !compiled.includes(entry))
  if (missing.length) {
    throw new Error(
      `в бинаре нет ассетов фронтенда (${missing.join(', ')}). Похоже, сборка шла без ` +
        '`--features tauri/custom-protocol` — приложение откроется белым окном.',
    )
  }
  console.log(`Ассеты фронтенда на месте: ${entries.join(', ')}`)
}

assertFrontendEmbedded()


/** The same two sources tauri-bundler merges: `src-tauri/Info.plist` and `bundle.macOS.infoPlist`. */
function plistOverrides() {
  const configured = conf.bundle?.macOS?.infoPlist
  const sources = [join(tauriDir, 'Info.plist')]
  if (configured) sources.push(resolve(tauriDir, configured))

  const merged = {}
  for (const [index, file] of sources.entries()) {
    if (!existsSync(file)) {
      if (index === 0) continue
      throw new Error(`bundle.macOS.infoPlist указывает на отсутствующий ${file}`)
    }
    Object.assign(merged, parsePlistXml(readFileSync(file, 'utf8'), basename(file)))
  }
  return merged
}

function buildInfoPlist() {
  const plist = {
    CFBundleDevelopmentRegion: 'English',
    CFBundleDisplayName: productName,
    CFBundleExecutable: binaryName,
    CFBundleIdentifier: identifier,
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: conf.bundle?.macOS?.bundleName ?? productName,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version,
    CFBundleVersion: conf.bundle?.macOS?.bundleVersion ?? version,
    CSResourcesFileMapped: true,
  }

  const category = APP_CATEGORY_TYPE[conf.bundle?.category]
  if (conf.bundle?.category && !category) throw new Error(`Неизвестная категория ${conf.bundle.category} — дополни APP_CATEGORY_TYPE`)
  if (category) plist.LSApplicationCategoryType = category

  plist.LSMinimumSystemVersion = conf.bundle?.macOS?.minimumSystemVersion ?? MIN_SYSTEM_VERSION[target]
  plist.CFBundleIconFile = 'icon.icns'

  // Without CFBundleURLTypes the app stops handling its deep-link scheme.
  const protocols = conf.plugins?.['deep-link']?.desktop?.schemes
  if (protocols?.length) {
    plist.CFBundleURLTypes = [
      {
        CFBundleURLSchemes: protocols,
        CFBundleURLName: `${identifier} ${protocols[0]}`,
        CFBundleTypeRole: 'Editor',
      },
    ]
  }

  plist.LSRequiresCarbon = true
  plist.NSHighResolutionCapable = true
  if (conf.bundle?.copyright) plist.NSHumanReadableCopyright = conf.bundle.copyright

  const overrides = plistOverrides()
  for (const [key, value] of Object.entries(overrides)) plist[key] = value
  console.log(`Info.plist: из overrides добавлено ${Object.keys(overrides).join(', ') || '— ничего'}`)

  // Without it macOS answers getUserMedia with a denial and never shows the TCC
  // prompt, so the launcher never appears in Privacy → Microphone at all.
  if (!plist.NSMicrophoneUsageDescription) {
    throw new Error('в Info.plist нет NSMicrophoneUsageDescription — микрофон в лаунчере и в игре работать не будет')
  }

  return renderPlist(plist)
}

function run(cmd, args, options = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  return execFileSync(cmd, args, { stdio: 'inherit', ...options })
}

function bundleApp() {
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(join(contents, 'MacOS'), { recursive: true })
  mkdirSync(join(contents, 'Resources'), { recursive: true })

  const icns = (conf.bundle?.icon ?? []).find((i) => i.endsWith('.icns'))
  if (!icns) throw new Error('В bundle.icon нет .icns — сгенерировать его на Linux нечем')
  cpSync(join(tauriDir, icns), join(contents, 'Resources', 'icon.icns'))

  writeFileSync(join(contents, 'Info.plist'), buildInfoPlist())

  cpSync(binary, join(contents, 'MacOS', binaryName))
  chmodSync(join(contents, 'MacOS', binaryName), 0o755)

  for (const resource of conf.bundle?.resources ?? []) {
    cpSync(join(tauriDir, resource), join(contents, 'Resources', basename(resource)), { recursive: true })
  }

  console.log(`Собран ${appDir}`)
}

/**
 * Signing is mandatory: macOS SIGKILLs an unsigned arm64 binary, and Gatekeeper
 * calls a bundle without _CodeSignature damaged. Falls back to ad-hoc signing.
 */
function signApp() {
  const p12 = process.env.APPLE_CERTIFICATE
  const args = ['sign']

  const entitlements = conf.bundle?.macOS?.entitlements
  if (entitlements) {
    const path = resolve(tauriDir, entitlements)
    if (!existsSync(path)) throw new Error(`bundle.macOS.entitlements указывает на отсутствующий ${path}`)
    args.push('--entitlements-xml-path', path)
  }

  if (p12) {
    const p12Path = join(outDir, 'signing.p12')
    writeFileSync(p12Path, Buffer.from(p12, 'base64'))
    args.push('--p12-file', p12Path, '--p12-password', process.env.APPLE_CERTIFICATE_PASSWORD ?? '')
    args.push('--code-signature-flags', 'runtime')
  }

  args.push(appDir)
  run('rcodesign', args)

  // `rcodesign verify` documents itself as prone to false positives, so read the
  // signature straight out of the binary instead.
  const info = execFileSync('rcodesign', ['print-signature-info', join(contents, 'MacOS', binaryName)], { encoding: 'utf8' })
  console.log(info.split('\n').slice(0, 30).join('\n'))
  if (!info.includes('code_directory')) throw new Error('в подписанном бинаре нет code directory — macOS убьёт процесс при запуске')

  if (!existsSync(join(contents, '_CodeSignature', 'CodeResources'))) {
    throw new Error('rcodesign не создал _CodeSignature/CodeResources — Gatekeeper объявит приложение повреждённым')
  }
}

/** tar with the .app at the root — the layout tauri-plugin-updater expects. */
function bundleUpdater() {
  const archive = `${appDir}.tar.gz`
  rmSync(archive, { force: true })
  run('tar', ['-czf', archive, '-C', macosDir, `${productName}.app`])
  console.log(`Собран ${archive}`)
  return archive
}

/**
 * The window is the only place a player reads anything before the first launch,
 * so the two commands that unstick a "damaged" app live in the image itself and
 * not only on the site. chmod is here for those who already have a copy from an
 * older image: it landed read-only, and Finder cannot replace it.
 */
function readMe() {
  const app = `/Applications/${productName}.app`
  return [
    `${productName} — установка`,
    '',
    `1. Перетащи «${productName}» в папку «Программы».`,
    '2. Запусти лаунчер из «Программ».',
    '',
    'Если macOS пишет, что приложение повреждено — с файлом всё в порядке.',
    'Так система сообщает, что подпись Apple ещё не оформлена. Выполни один',
    'раз в Терминале и запусти снова:',
    '',
    `chmod -R u+w "${app}" && xattr -cr "${app}"`,
    '',
    'Либо: «Системные настройки» → «Конфиденциальность и безопасность» →',
    '«Всё равно открыть» после первой попытки запуска.',
    '',
    'Помощь: https://millida.net/support',
    '',
  ].join('\n')
}

/**
 * The volume name has to be unique across our images: two images with the same
 * name cannot be open at once — the second one mounts as "<name> 1", and the
 * background reference inside .DS_Store is an alias bound to /Volumes/<name>,
 * so the window loses its picture. Version and architecture make the collision
 * impossible between a new build and an old one, or between the two machines.
 *
 * 32 is the ISO9660 limit. Joliet would cut the same name to 16, which is why
 * the image is built without it — see bundleDmg.
 */
function volumeName() {
  const name = `${productName} ${version} ${ARCH_LABEL[target]}`
  if (name.length > VOLUME_NAME_LIMIT) {
    throw new Error(`имя тома «${name}» длиннее ${VOLUME_NAME_LIMIT} символов — ISO9660 его обрежет, и ссылка на фон перестанет разрешаться`)
  }
  return name
}

/**
 * Finder draws the window from `.DS_Store` at the root of the volume: window
 * size, icon size, where each icon sits and which picture lies underneath.
 * Without it the player sees the default window — two icons in the corner on
 * grey.
 *
 * The picture is a two page TIFF, 1x and 2x: Finder maps the background pixel
 * to pixel, so on a Retina screen a single 1x page would be visibly soft. The
 * 1x page must be exactly 72 dpi, otherwise Finder scales it and the layout
 * stops matching the icon positions.
 */
function styleWindow(stage, volume) {
  const source = join(tauriDir, 'dmg-background.svg')
  if (!existsSync(source)) throw new Error(`не найден фон образа ${source}`)

  const background = join(stage, '.background')
  mkdirSync(background, { recursive: true })

  const pages = []
  for (const [scale, density] of [
    [1, 72],
    [2, 144],
  ]) {
    const png = join(outDir, 'bundle', `dmg-background-${scale}x.png`)
    const page = join(outDir, 'bundle', `dmg-background-${scale}x.tif`)
    run('rsvg-convert', ['--width', String(WINDOW.width * scale), '--height', String(WINDOW.height * scale), '--format', 'png', '--output', png, source])
    run('magick', [png, '-density', String(density), '-units', 'PixelsPerInch', page])
    rmSync(png, { force: true })
    pages.push(page)
  }

  const tiff = join(background, 'background.tiff')
  run('magick', [...pages, '-adjoin', tiff])
  for (const page of pages) rmSync(page, { force: true })

  run('python3', [join(root, 'scripts', 'dmg-dsstore.py'), join(stage, '.DS_Store'), volume, `${productName}.app`, README_NAME])

  for (const file of [tiff, join(stage, '.DS_Store')]) {
    if (!existsSync(file) || statSync(file).size === 0) throw new Error(`${file} не собрался — окно образа останется стандартным`)
  }
}

/**
 * A .dmg is not just a filesystem with the right extension: Finder hands the
 * file to DiskImageMounter, which looks for the trailing UDIF `koly` block and
 * does nothing at all — no error, no "damaged" — when it is missing. macOS 26
 * stopped falling back to raw images, so the filesystem must be wrapped.
 *
 * The filesystem stays ISO9660 + Rock Ridge, which keeps permissions and the
 * /Applications symlink. Hybrid HFS+ (`-hfsplus`) is not an option even though
 * it would give `dmg` a partition map to work from: xorriso attaches Finder
 * information to the files, and codesign then calls the bundle inside the image
 * "resource fork, Finder information, or similar detritus not allowed" — the
 * app the player drags out of the image is unsigned as far as Gatekeeper cares.
 * Without that partition map `dmg` leaves the sector count empty, so it is
 * filled in from the size of the filesystem it wrapped.
 */
function bundleDmg() {
  const dmgName = `${productName}_${version}_${ARCH_SUFFIX[target]}.dmg`
  const dmgPath = join(dmgDir, dmgName)
  const volume = volumeName()
  const stage = join(outDir, 'bundle', 'dmg-stage')
  const raw = join(outDir, 'bundle', 'dmg-raw.img')

  rmSync(stage, { recursive: true, force: true })
  rmSync(dmgDir, { recursive: true, force: true })
  rmSync(raw, { force: true })
  mkdirSync(stage, { recursive: true })
  mkdirSync(dmgDir, { recursive: true })

  cpSync(appDir, join(stage, `${productName}.app`), { recursive: true, verbatimSymlinks: true })
  symlinkSync('/Applications', join(stage, 'Applications'))
  writeFileSync(join(stage, README_NAME), readMe(), 'utf8')
  styleWindow(stage, volume)

  // -R, не -r: «рационализация» срезает у всего право на запись, и приложение,
  // перетащенное из образа, ложится в «Программы» доступным только на чтение —
  // дальше игрок руками зовёт chmod, а лаунчер не может обновить сам себя.
  //
  // Без -J: Joliet держит собственную копию имени тома, обрезанную до 16
  // символов, и macOS показывает именно её. Имена файлов на macOS несёт Rock
  // Ridge, так что Joliet тут не нужен вовсе.
  run('xorrisofs', ['-R', '-V', volume, '-o', raw, stage])
  assertVolumeName(raw, volume)
  run('dmg', ['dmg', raw, dmgPath])
  if (!existsSync(dmgPath)) throw new Error(`dmg не создал ${dmgPath}`)

  const rawSize = statSync(raw).size
  if (rawSize % SECTOR_SIZE) throw new Error(`образ ${rawSize} байт не кратен сектору ${SECTOR_SIZE} — хвост не попадёт в .dmg`)
  writeSectorCount(dmgPath, rawSize / SECTOR_SIZE)

  const { sectors } = assertUdif(dmgPath)
  console.log(`Собран ${dmgPath}: UDIF, ${sectors} секторов, ${statSync(dmgPath).size} байт`)
  rmSync(raw, { force: true })
  return dmgPath
}

bundleApp()
signApp()
const updater = bundleUpdater()
const dmg = bundleDmg()

console.log(JSON.stringify({ app: appDir, updater, dmg }, null, 2))
