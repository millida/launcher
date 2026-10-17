# How Millida Launcher is built

This document is for people who are going to change the code. It describes the actual
state of the repository: the layers, the borders between them, the security rules, the way
the game starts, and the steps to add a new IPC command.

## Three layers

```
src/**                     React 19 + TypeScript, the webview. Display and input only.
   |  invoke(cmd, args)  ^  window events
   v                     |
src-tauri/src/lib.rs       registration of ~135 IPC commands, plugins, app start
src-tauri/src/commands/**  thin wrappers: parse arguments, call the engine
   |
   v
src-tauri/src/engine/**    the engine: network, files, install, launch, accounts
src-tauri/src/secrets.rs   token storage (never leaves for the webview)
```

The rule of the border: the webview does not know secrets and does not work with
file system paths directly. Anything that needs the disk, processes or tokens is a core command.
The frontend works with profile names, account IDs and job keys.

Top-level files of the core:

- [src-tauri/src/main.rs](src-tauri/src/main.rs): the entry point, calls `run()`.
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs): builds the Tauri app:
  plugins (single-instance, deep-link, updater, process, clipboard), the panic
  hook, narrowing the scope of the `asset:` protocol (`allow_assets`), the tray, self-healing,
  the list of commands in `generate_handler!`.
- [src-tauri/src/tray.rs](src-tauri/src/tray.rs): the tray icon and showing the window.
- [src-tauri/src/discord.rs](src-tauri/src/discord.rs): Rich Presence over the
  local Discord IPC. Errors are not fatal and are retried no more than once per 30 s.
- [src-tauri/src/secrets.rs](src-tauri/src/secrets.rs): local secret
  storage.

## Engine map

### core: [src-tauri/src/engine/core](src-tauri/src/engine/core)

| Module | Purpose |
| --- | --- |
| [http.rs](src-tauri/src/engine/core/http.rs) | the only `reqwest::Client` (built once, with system TLS roots and a webpki fallback), retries, downloads with sha1/sha256/sha512 and size checks, resuming |
| [jobs.rs](src-tauri/src/engine/core/jobs.rs) | registry of running installs by key: cancel, progress, protection against two installs of the same thing |
| [paths.rs](src-tauri/src/engine/core/paths.rs) | `data_dir()` and `game_root()`, moving the game folder, atomic json writes, cache size and cleanup, Flatpak detection |
| [archive.rs](src-tauri/src/engine/core/archive.rs) | unpacking zip through checked paths |
| [safepath.rs](src-tauri/src/engine/core/safepath.rs) | `safe_join`, `safe_child`, `safe_file_name`: the only place that validates untrusted paths |
| [crash.rs](src-tauri/src/engine/core/crash.rs) | the panic hook and the log of crashes of the launcher itself |
| [dedup.rs](src-tauri/src/engine/core/dedup.rs) | shared file storage between instances: `objects/<xx>/<sha1>`, hard links instead of copies, installing without downloading a file we already have, garbage collection |
| [proc.rs](src-tauri/src/engine/core/proc.rs) | starting child processes without a console window popping up on Windows |
| [selfupdate.rs](src-tauri/src/engine/core/selfupdate.rs) | the fallback update channel: its own manifest parsing and a minisign signature check with the same key as the plugin |
| [selfheal.rs](src-tauri/src/engine/core/selfheal.rs) | if the webview did not report that it is ready, the install is treated as broken |

### game: [src-tauri/src/engine/game](src-tauri/src/engine/game)

`mcmeta.rs`: the Mojang version manifest and parsing the version json.
`install.rs`: downloading the client, libraries and assets (in parallel, with
hash checks), installing Fabric, Quilt, Forge and NeoForge, building the classpath.
`java.rs`: choosing the major Java version, downloading Eclipse Temurin through the Adoptium
API, checking JRE integrity (`jvm.cfg`), a custom Java path, the JDK from the
SDK extension inside Flatpak.
`launch.rs`: building arguments, starting the JVM, reading logs, tracking running games,
stopping them, recognizing crashes.
`worlds.rs`, `serversdat.rs`: the game's worlds and server list, Quick Play.
`nbt.rs`: NBT with a full round trip. `level.dat` is read and rewritten with it.
`worldmgr.rs`: the world manager: a world card from `level.dat` (mode, difficulty,
version, seed, icon, size), rename, copy, zip export and import,
restoring a backup as a separate world.
`tuning.rs`: automatic choice of memory and GC profile for the machine and the number of mods
(`GC_FLAGS` is the common source for the auto mode and for "FPS Boost").
`crashfix.rs`: turns a crash into actions: disable the mod the loader names,
raise memory, install the needed Java. `apply_crash_fix` does exactly one.
`ping.rs`: server ping over the Minecraft protocol.
`playtime.rs`: play time statistics.

### content: [src-tauri/src/engine/content](src-tauri/src/engine/content)

`modrinth.rs`: search and install of projects. The content type decides the folder
(`mods`, `resourcepacks`, `shaderpacks`, `datapacks`, `saves`).
`curseforge.rs`: the same for CurseForge. Requests go through the backend proxy
(the API key stays on the server), and through a public mirror if the proxy is unavailable.
`localmeta.rs`, `scan.rs`: recognizing files that are already in the folder: first
sha1 on Modrinth, then everything unrecognized by the CurseForge fingerprint
(`fingerprint.rs`, MurmurHash2 without whitespace bytes: CurseForge does not
search files by hash at all). Also metadata parsing. The links of a mod (`mod_id`, `provides`, `requires`,
`breaks`) are read from the jar too, so dependencies are visible even for files that are not in the catalogs.
`deps.rs`: one dependency resolver for both catalogs. `dep_plan` builds
the install preview (what gets pulled in, what is optional, what conflicts),
`install_required` installs hard dependencies transitively, `audit_deps`
checks an instance that is already built. Install and preview use the same
code, so they cannot differ.
`updates.rs`: checking and applying content updates.

### profiles: [src-tauri/src/engine/profiles](src-tauri/src/engine/profiles)

`store.rs`: `profiles.json`, create, rename, duplicate, delete.
`mods.rs`, `groups.rs`, `covers.rs`: instance contents, groups, covers.
`imports.rs`: finding installs of other launchers (Prism, MultiMC, ATLauncher,
GDLauncher, CurseForge, Modrinth App, common `.minecraft`) and importing an instance.
`packfile.rs`: importing a pack file (`.mrpack`, CurseForge archives).
`export.rs`: exporting an instance to `.mrpack`.
`backups.rs`: a world backup to zip.
`screenshots.rs`: the screenshot gallery: a list with sizes and dates, delete,
save through a dialog, upload by link through `/launcher/screenshots`.
`share.rs`: the instance description (`PackManifest`: only Modrinth/CurseForge files with
hashes), publishing by a short code, preview and install of someone else's instance.
File addresses are accepted only from catalog hosts, and `install_manifest` is the
only install path, both for the code and for the cloud.
`logs.rs`, `sharelog.rs`: reading and uploading logs.

### accounts: [src-tauri/src/engine/accounts](src-tauri/src/engine/accounts)

`microsoft.rs`: the Microsoft device flow and the chain Xbox Live → XSTS → Minecraft
Services → profile. The client_id comes from `option_env!("MILLIDA_MS_CLIENT_ID")`,
otherwise a built-in fallback is used.
`millida.rs`: a proxy to `api.millida.net/v2` (`millida_api`). The path and method
are checked, and the core adds the token.
`session.rs`: binding a session to an account ID: storage keys
`acc:<id>` (Minecraft token) and `msr:<id>` (refresh token), refresh and
invalidation. `session_presence` is the only thing the frontend learns about secrets:
the fact that they exist.

### skins: [src-tauri/src/engine/skins](src-tauri/src/engine/skins)

`mojang.rs`: the profile, uploading a skin and changing a cape through Minecraft Services.
`library.rs`: the local library of skins and capes.
`authlib.rs`: installing authlib-injector to sign in to your own Yggdrasil.
`csl.rs`: CustomSkinLoader for modded instances. It is installed once and only into an
instance that has no skin mod of its own. A disabled or deleted copy is not
brought back. The switch is in the instance settings.
`heads.rs`: rendering and caching avatar heads.

### FPS Boost: [src-tauri/src/engine/game/fpsboost.rs](src-tauri/src/engine/game/fpsboost.rs)

A per-instance mode. It installs speed-up mods for its loader (Sodium/Embeddium and
the like), turns on a GC profile for the JVM and lowers heavy graphics settings in
`options.txt`. Everything it changed is written to `millida-settings.json`
(`fpsBoostMods`, `fpsBoostVideo`), so turning it off removes exactly its own mods and
restores exactly the previous setting values.

### cloud: [src-tauri/src/engine/cloud.rs](src-tauri/src/engine/cloud.rs)

A cloud profile on a Millida account: a snapshot of instance descriptions (the same
manifests as in sharing), interface settings, groups and the list of themes. Links and hashes
go to the cloud, not files, so a hundred instances weigh hundreds of kilobytes.
`cloud_pull` installs only missing instances unless you name them explicitly.

### media: [src-tauri/src/engine/media](src-tauri/src/engine/media)

Music, interface sounds and wallpapers: downloading, re-encoding ogg (WKWebView on
macOS does not play it), choosing a file by the user.

## Frontend

- There is no router. A screen is switched with the class `on` on `<section class="screen">`.
  The active screen is stored in `useUi().screen`
  ([src/state/ui.ts](src/state/ui.ts), `ScreenId`). Screen components
  are loaded lazily and warmed up after start:
  [src/screens/registry.ts](src/screens/registry.ts).
- State is zustand, one store per area: accounts, profiles, mods, installs,
  friends, game, wallpapers, servers, UI ([src/state](src/state)).
- CSS is plain files without preprocessors or UI libraries. They are imported in
  [src/main.tsx](src/main.tsx) strictly in the order `01-base` → `05-media`.
  Do not change the order: the cascade depends on it.
- [src/ipc/tauri.ts](src/ipc/tauri.ts) is the bridge to Tauri. The API is imported from
  packages, not from `window.__TAURI__`: the global is turned off
  (`withGlobalTauri: false`), so that XSS cannot reach IPC. `hasTauri()`
  tells the app from a browser. Without the core, screens show placeholders.
- [src/ipc/commands.ts](src/ipc/commands.ts): typed wrappers over
  `invoke`, one per command.
- [src/ipc/events.ts](src/ipc/events.ts): subscriptions to core events:
  `launch-progress`, `launch-warning`, `install-progress`, `game-exit`,
  `game-log`, `host-console`, `tray-exit` and others.
- [src/lib](src/lib): helpers: `api.ts` (HTTP to the backend),
  `secure.ts` (knowing that sessions exist, without values), `launch.ts`, `install.ts`,
  `updater.ts`, `telemetry.ts`, `markdown.tsx`, `mine3d.ts` (lazy loading of the
  3D skin preview engine from `src/vendor/mine3d`), `skinBody.ts` (offscreen rendering
  of cards).
- `localStorage` holds only user settings with the prefix `m-`
  (theme, accent, wallpaper, sound, memory per instance, the list of accounts without tokens).
  The keys and formats are compatible with old versions. Do not rename them
  without a migration.

## Calls

Voice and screen sharing go directly between launchers (WebRTC). The server knows
only who talks to whom: it passes signaling envelopes, keeps the membership of
voice rooms and issues one-hour credentials for the relay (`friends/calls` and
`friends/rooms` in trade-api). There is no media server of our own: a group call is a
mesh, and everyone sends voice to everyone. A group can handle voice (up to ten:
nine Opus streams ≈ 360 kbit/s outgoing), but screen sharing goes to each
viewer as a separate stream and is not compressed below a readable bitrate. So its
ceiling is divided by the number of viewers, sharing is available while the call has no more than
five people, and it is fully off when the connection goes through the relay.

- [src/state/call.ts](src/state/call.ts): call state and the whole order of
  actions: dialing, answering, joining group voice, a drop, mute, deafen, screen
  sharing. In a direct call, the role (caller / answerer) decides who yields on renegotiation. In a group, the order of
  identifiers decides. Neither changes
  when the connection is rebuilt after a drop.
- [src/lib/call/session.ts](src/lib/call/session.ts): a call as a set of
  connections. A direct call is a special case with one partner: both forms use
  the same code, otherwise mute and screen sharing would behave differently in a group than in a direct call.
- Group: the room is always open. People join it, they are not dialed. The membership
  is counted by the server and sent in a `roster` envelope. The launcher checks in every 15
  seconds, so an API restart does not lose the membership.
- [src/lib/call/peer.ts](src/lib/call/peer.ts): `RTCPeerConnection`: tracks,
  the state channel (mute and screen sharing go through it, not through the server),
  connection quality.
- [src/lib/call/signal.ts](src/lib/call/signal.ts): receiving envelopes. A request
  hangs on the server until an event, so a call rings at once and an idle
  launcher does not poll the API for nothing.
- [src/lib/call/mic-worklet.ts](src/lib/call/mic-worklet.ts): noise suppression.
  It is computed by `micGateStep`, which is also inserted as text into the source of
  the processor: one
  implementation, but testable with an ordinary test ([gate.test.ts](src/lib/call/gate.test.ts)).
  The processor is loaded through `blob:`. A file of its own would require widening
  `script-src`, and that is pinned by a core test. For the same reason there is no
  WebAssembly noise suppression: it needs `wasm-unsafe-eval`.
- Screen sharing is `getDisplayMedia` with the engine's own picker window. On macOS
  the built-in WKWebView does not provide it, so the button is not shown there. The track goes out
  with `degradationPreference: maintain-resolution` and `scaleResolutionDownBy: 1`:
  when bandwidth is short, the codec gives up frames, not resolution. A downscaled
  picture is stretched back on the viewer's side and becomes unreadable.
- Microphone processing by the engine (auto gain, echo cancellation) is a setting, not
  a constant. Auto gain controls the volume itself and lowers it during long speech, while
  the gain in the launcher is set with a slider. Auto gain is off by default.

## Security as an architecture principle

1. **Secrets only in Rust.** [secrets.rs](src-tauri/src/secrets.rs) is our own
   vault: `secrets.bin` is encrypted with AES-256-GCM (a fresh nonce per write, the key name
   as AAD). The key `vault.key` is 32 random bytes, wrapped with DPAPI on Windows
   and with 0600 permissions on Unix. The final cipher key is derived with HKDF-SHA256 from
   `vault.key` and the machine ID. Files copied to another machine
   are useless. The system keychain is deliberately not used: the hash of the binary
   changes with every auto-update, and the macOS Keychain starts asking
   for the password forever.
2. **The webview does not see tokens.** The frontend works with an account ID:
   `ms_profile`, `ms_set_cape`, `ms_upload_skin`, `launch_game` take
   `accountId`, and the core gets the token from the vault itself. The only thing the frontend
   learns is `session_status`: whether a session exists or not
   ([src/lib/secure.ts](src/lib/secure.ts)). Tokens from old versions that lived
   in `localStorage` are deleted at start.
3. **Paths from external data.** Everything that comes from an mrpack, CurseForge
   manifests and over IPC goes through `safe_join` / `safe_child` /
   `safe_file_name` ([safepath.rs](src-tauri/src/engine/core/safepath.rs)).
   Absolute paths are dropped (`PathBuf::join` silently replaces the base), as are traversal
   with `..`, control characters, reserved Windows names, and names that end
   with a dot or a space. The check runs on the canonicalized path, not
   on a substring.
4. **Downloads are verified.** `download_checked` checks sha1/sha256/sha512 and
   size before the file takes its place: the game client and libraries by the
   hashes from the Mojang manifest, the JRE by the sha256 from the Adoptium response, Modrinth
   and CurseForge files by the hashes of their APIs, the launcher update by the
   minisign signature.
5. **Webview permissions are cut down.**
   [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json)
   allows only events, control of its own window, the updater, deep-link,
   writing to the clipboard and restarting the process. No file system and no shell.
   Links and folders are opened by core commands, not by the shell.
6. **CSP and the asset protocol scope.** In
   [tauri.conf.json](src-tauri/tauri.conf.json), `script-src` is only `'self'`,
   `object-src` is `'none'`, `frame-src` is exactly two players
   (`www.youtube-nocookie.com` and `w.soundcloud.com`: music by link and
   trailers), and the list of external hosts in `connect-src`
   is closed (a new domain must be added to both blocks: `csp` and `devCsp`).
   The `asset:` scope is empty in the config and is narrowed at runtime to the data folder and
   the game folder (`allow_assets` in [lib.rs](src-tauri/src/lib.rs)).

## How the game starts

The entry point is `install_and_launch_in`
([launch.rs](src-tauri/src/engine/game/launch.rs)). It is called by the commands
`launch_game` / `launch_profile`.

1. **Profile.** The game version, the loader and its version come from `profiles.json`.
   The JVM arguments, window size and the
   chosen Java come from `millida-settings.json` in the instance folder. Settings are read before the install, so that a custom Java path
   cancels the JRE download, instead of cancelling it after the fact.
2. **Version and loader.** `install_loader_with_java` downloads the manifest,
   the version json, the client, libraries and assets (in parallel, with hash checks),
   then installs the loader: Fabric and Quilt from their meta APIs, Forge and NeoForge
   through the official installer from maven. The result is the final version json,
   the main class and the classpath in the order from the version json.
3. **Java.** `ensure_java` takes the major version from the version json, looks for an already downloaded JRE,
   checks its integrity and downloads Temurin if needed.
4. **Arguments.** `build_args` fills in the Mojang substitutions (paths, assets,
   natives, session). On top of that it adds `-Xmx`, a Log4Shell mitigation
   (`-Dlog4j2.formatMsgNoLookups=true`, and for 1.7–1.11.2 a replacement logger
   config), user JVM arguments, the GC profile of the "FPS Boost" mode
   (`fpsboost.rs`, placed before the user ones, so the player's own flag wins), window
   size, Quick Play.
5. **Session.** For a license account, the token, uuid and xuid are filled in. For Millida
   skins, the `-javaagent` of authlib-injector is added, and on modded instances
   CustomSkinLoader is installed if needed, but only into an instance that has not yet
   received it and has no skin mod of its own. If the agent could not be installed,
   the launch honestly goes offline with a warning, and does not pretend to be
   online.
6. **Process.** The JVM starts with the instance folder as the working directory, without a console window on
   Windows. stdout and stderr are read into `logs/launcher-latest.log` and streamed to
   the interface. An instant exit counts as a failed launch, not as a session.
   Running games are kept in `RUNNING` (profile → pid). A stop on request
   marks the pid, so a non-zero exit code is not taken for a crash.

During all this, progress goes out as the `launch-progress` event and warnings as
`launch-warning`.

## How to add an IPC command

Example: the command `list_backups`.

1. **Logic goes into the engine.** A function in a fitting `engine/**` module that returns
   `Result<T, String>`. The error text is shown to the user, so keep it clear and to the
   point (the current messages are in Russian). Anything that comes from outside goes through `safe_*`. Export it from
   the module's `mod.rs`.
2. **The wrapper goes into `commands/**`.** A file per area: `profiles`, `content`,
   `launch`, `accounts`, `hosting`, `system`.

   ```rust
   #[tauri::command]
   pub fn list_backups(profile: String) -> Vec<String> {
       engine::list_backups(&profile)
   }
   ```

   Make long operations `async` and move blocking work into
   `tauri::async_runtime::spawn_blocking`, otherwise the window freezes. Send progress through
   `app.emit(...)` and the job registry from `jobs.rs`, not by returning a value at the end.
3. **Registration.** Add `commands::<module>::<name>` to
   `tauri::generate_handler![...]` in [lib.rs](src-tauri/src/lib.rs). Without this,
   `invoke` returns an error about an unknown command.
4. **The wrapper on the frontend.** In [src/ipc/commands.ts](src/ipc/commands.ts):

   ```ts
   export const listBackups = (profile: string) =>
     invoke<string[]>('list_backups', { profile })
   ```

   Argument names are camelCase on the JS side, and the core takes them as they are
   (`snake_case` in Rust is mapped automatically). Describe struct types with
   an interface next to it, not with `any`.
5. **Events, if there are any.** A new event is a subscription in
   [src/ipc/events.ts](src/ipc/events.ts), modeled on the existing ones. It
   returns `null` outside Tauri, so that browser mode does not crash.
6. **Check.** `bun run typecheck`, then `cargo clippy --all-targets -- -D warnings`
   and `cargo test` from `src-tauri`.

Also: if the webview needs a command only to pass something
on to our API, use the existing `millida_api` and not a new proxy.
And never return the value of a token to the frontend: return a flag.

## Tests

- **Rust.** Unit tests live next to the code, in `#[cfg(test)] mod tests`:
  `core/safepath.rs`, `core/http.rs`, `core/jobs.rs`, `core/paths.rs`,
  `core/selfupdate.rs`, `game/install.rs`, `game/java.rs`, `game/launch.rs`,
  `game/serversdat.rs`, `content/curseforge.rs`, `content/localmeta.rs`,
  `profiles/store.rs`, `profiles/imports.rs`, `accounts/session.rs`,
  `skins/library.rs`, `skins/heads.rs`, `secrets.rs`.

  ```bash
  cd src-tauri
  cargo test
  cargo test -- --ignored   # tests that need the network
  ```

- **Frontend.** `bun test` (for example, [src/state/msLogin.test.ts](src/state/msLogin.test.ts)).
- **Static checks.** `bun run typecheck` (`tsc -b`, strict) and
  `cargo clippy --all-targets -- -D warnings`. No formatter is used.
- **Build gate.** After the build, `bun run build:web` runs
  [scripts/check-frontend-gate.mjs](scripts/check-frontend-gate.mjs): the bundle
  must still contain the `frontend_ready` call. Otherwise the core treats the webview as dead and
  reinstalls the launcher on every start (`core/selfheal.rs`).

## Data on disk

- Launcher data is in `data_dir()/net.millida.launcher`: `profiles.json`,
  `secrets.bin`, `vault.key`, `game-root.txt`, downloaded JREs in `java/`.
  On Windows this is `%APPDATA%`, on macOS `~/Library/Application Support`,
  on Linux `~/.local/share`.
- Game files are in `game_root()`, by default `<data>/minecraft`: `versions`,
  `libraries`, `assets`, `natives`, `runtime` and `profiles/<instance name>`.
  You can move the folder (`set_game_dir`), and the path is remembered in `game-root.txt`.
  If the disk is not available, the core reports an error, and does not pretend there are no instances.

---

<details>
<summary><b>Русская версия</b></summary>

# Устройство Millida Launcher

Документ для тех, кто собирается править код. Он описывает фактическое
состояние репозитория: слои, границы между ними, правила безопасности, путь
запуска игры и порядок добавления новой IPC-команды.

## Три слоя

```
src/**                     React 19 + TypeScript, вебвью. Только отображение и ввод.
   |  invoke(cmd, args)  ^  события окна
   v                     |
src-tauri/src/lib.rs       регистрация ~135 IPC-команд, плагины, старт приложения
src-tauri/src/commands/**  тонкие обёртки: разбор аргументов, вызов движка
   |
   v
src-tauri/src/engine/**    движок: сеть, файлы, установка, запуск, аккаунты
src-tauri/src/secrets.rs   хранилище токенов (в вебвью не выходит)
```

Правило границы: вебвью не знает секретов и не работает с путями файловой
системы напрямую. Всё, что требует диска, процессов или токенов, — команда ядра.
Фронтенд оперирует именами профилей, идентификаторами аккаунтов и ключами задач.

Файлы верхнего уровня ядра:

- [src-tauri/src/main.rs](src-tauri/src/main.rs) — точка входа, вызывает `run()`.
- [src-tauri/src/lib.rs](src-tauri/src/lib.rs) — сборка приложения Tauri:
  плагины (single-instance, deep-link, updater, process, clipboard), панический
  хук, сужение области `asset:`-протокола (`allow_assets`), трей, самолечение,
  список команд в `generate_handler!`.
- [src-tauri/src/tray.rs](src-tauri/src/tray.rs) — иконка в трее и показ окна.
- [src-tauri/src/discord.rs](src-tauri/src/discord.rs) — Rich Presence поверх
  локального IPC Discord; ошибки не фатальны и повторяются не чаще раза в 30 с.
- [src-tauri/src/secrets.rs](src-tauri/src/secrets.rs) — локальное хранилище
  секретов.

## Карта движка

### core — [src-tauri/src/engine/core](src-tauri/src/engine/core)

| Модуль | Назначение |
| --- | --- |
| [http.rs](src-tauri/src/engine/core/http.rs) | единственный `reqwest::Client` (собирается один раз, с системными корнями TLS и запасным вариантом на webpki), повторы, скачивание с проверкой sha1/sha256/sha512 и размера, докачка |
| [jobs.rs](src-tauri/src/engine/core/jobs.rs) | реестр идущих установок по ключу: отмена, прогресс, защита от двух установок одного и того же |
| [paths.rs](src-tauri/src/engine/core/paths.rs) | `data_dir()` и `game_root()`, перенос папки игры, атомарная запись json, размер и очистка кеша, определение Flatpak |
| [archive.rs](src-tauri/src/engine/core/archive.rs) | распаковка zip через проверенные пути |
| [safepath.rs](src-tauri/src/engine/core/safepath.rs) | `safe_join`, `safe_child`, `safe_file_name` — единственная точка валидации недоверенных путей |
| [crash.rs](src-tauri/src/engine/core/crash.rs) | панический хук и журнал падений самого лаунчера |
| [dedup.rs](src-tauri/src/engine/core/dedup.rs) | общее хранилище файлов между сборками: `objects/<xx>/<sha1>`, жёсткие ссылки вместо копий, установка без скачивания уже известного файла, сборка мусора |
| [proc.rs](src-tauri/src/engine/core/proc.rs) | запуск дочерних процессов без всплывающей консоли на Windows |
| [selfupdate.rs](src-tauri/src/engine/core/selfupdate.rs) | запасной канал обновления: свой разбор манифеста и проверка minisign-подписи тем же ключом, что и у плагина |
| [selfheal.rs](src-tauri/src/engine/core/selfheal.rs) | если вебвью не сообщил о готовности, установка считается битой |

### game — [src-tauri/src/engine/game](src-tauri/src/engine/game)

`mcmeta.rs` — манифест версий Mojang и разбор version json.
`install.rs` — скачивание клиента, библиотек и ассетов (параллельно, с
проверкой хешей), установка Fabric, Quilt, Forge и NeoForge, сборка classpath.
`java.rs` — подбор мажорной версии Java, скачивание Eclipse Temurin через API
Adoptium, проверка целостности JRE (`jvm.cfg`), свой путь к Java, JDK из
SDK-расширения внутри Flatpak.
`launch.rs` — сборка аргументов, запуск JVM, чтение логов, учёт запущенных игр,
остановка, распознавание падений.
`worlds.rs`, `serversdat.rs` — миры и список серверов игры, Quick Play.
`nbt.rs` — NBT с полным round-trip; на нём читается и переписывается `level.dat`.
`worldmgr.rs` — менеджер миров: карточка мира из `level.dat` (режим, сложность,
версия, сид, иконка, размер), переименование, копия, экспорт и импорт zip,
восстановление бэкапа отдельным миром.
`tuning.rs` — авто-подбор памяти и профиля GC под машину и число модов
(`GC_FLAGS` — общий источник для авто-режима и «Буста FPS»).
`crashfix.rs` — разбор падения в действия: отключить названный загрузчиком мод,
поднять память, поставить нужную Java; `apply_crash_fix` выполняет ровно одно.
`ping.rs` — пинг сервера по протоколу Minecraft.
`playtime.rs` — статистика наигранного времени.

### content — [src-tauri/src/engine/content](src-tauri/src/engine/content)

`modrinth.rs` — поиск и установка проектов; тип контента определяет папку
(`mods`, `resourcepacks`, `shaderpacks`, `datapacks`, `saves`).
`curseforge.rs` — то же для CurseForge; запросы идут через прокси бэкенда
(ключ API остаётся на сервере), при его недоступности — через публичное зеркало.
`localmeta.rs`, `scan.rs` — распознавание уже лежащих в папке файлов: сначала
sha1 на Modrinth, затем всё неопознанное — по отпечатку CurseForge
(`fingerprint.rs`, MurmurHash2 без пробельных байтов: по хешу CurseForge файлы
не ищет вовсе). Плюс разбор метаданных; из jar читаются и связи мода (`mod_id`, `provides`, `requires`,
`breaks`), поэтому зависимости видны и у файлов, которых нет в каталогах.
`deps.rs` — единый резолвер зависимостей для обоих каталогов: `dep_plan` строит
предпросмотр установки (что подтянется, что необязательно, с чем конфликт),
`install_required` ставит жёсткие зависимости транзитивно, `audit_deps`
проверяет уже собранную сборку. Установка и предпросмотр идут через один и тот
же код, поэтому разойтись не могут.
`updates.rs` — проверка и применение обновлений контента.

### profiles — [src-tauri/src/engine/profiles](src-tauri/src/engine/profiles)

`store.rs` — `profiles.json`, создание, переименование, дублирование, удаление.
`mods.rs`, `groups.rs`, `covers.rs` — содержимое сборки, группы, обложки.
`imports.rs` — поиск установок других лаунчеров (Prism, MultiMC, ATLauncher,
GDLauncher, CurseForge, Modrinth App, общие `.minecraft`) и импорт сборки.
`packfile.rs` — импорт файла сборки (`.mrpack`, архивы CurseForge).
`export.rs` — выгрузка сборки в `.mrpack`.
`backups.rs` — бэкап мира в zip.
`screenshots.rs` — галерея скриншотов: список с размерами и датами, удаление,
сохранение через диалог, выгрузка ссылкой через `/launcher/screenshots`.
`share.rs` — описание сборки (`PackManifest`: только файлы Modrinth/CurseForge с
хешами), публикация по короткому коду, предпросмотр и установка чужой сборки.
Адреса файлов принимаются только с хостов каталогов, а `install_manifest` —
единственный путь установки как для кода, так и для облака.
`logs.rs`, `sharelog.rs` — чтение и выгрузка логов.

### accounts — [src-tauri/src/engine/accounts](src-tauri/src/engine/accounts)

`microsoft.rs` — device flow Microsoft и цепочка Xbox Live → XSTS → Minecraft
Services → профиль. Client_id берётся из `option_env!("MILLIDA_MS_CLIENT_ID")`,
иначе используется вшитый запасной.
`millida.rs` — прокси к `api.millida.net/v2` (`millida_api`): путь и метод
проверяются, токен подставляет ядро.
`session.rs` — привязка сессии к идентификатору аккаунта: ключи хранилища
`acc:<id>` (токен Minecraft) и `msr:<id>` (refresh-токен), обновление и
инвалидация, `session_presence` — единственное, что фронтенд узнаёт о секретах:
факт их наличия.

### skins — [src-tauri/src/engine/skins](src-tauri/src/engine/skins)

`mojang.rs` — профиль, загрузка скина и смена плаща через Minecraft Services.
`library.rs` — локальная библиотека скинов и плащей.
`authlib.rs` — установка authlib-injector для входа в свой Yggdrasil.
`csl.rs` — CustomSkinLoader для модовых сборок. Ставится один раз и только в
сборку, где нет своего мода скинов; выключенная или удалённая копия обратно не
возвращается, переключатель — в настройках сборки.
`heads.rs` — рендер и кеш голов-аватарок.

### Буст FPS — [src-tauri/src/engine/game/fpsboost.rs](src-tauri/src/engine/game/fpsboost.rs)

Режим на сборку: ставит моды-ускорители под её загрузчик (Sodium/Embeddium и
компанию), включает профиль GC для JVM и снижает тяжёлые настройки графики в
`options.txt`. Всё, что он изменил, записано в `millida-settings.json`
(`fpsBoostMods`, `fpsBoostVideo`), поэтому выключение снимает ровно свои моды и
возвращает ровно прежние значения настроек.

### cloud — [src-tauri/src/engine/cloud.rs](src-tauri/src/engine/cloud.rs)

Облачный профиль на аккаунте Millida: слепок из описаний сборок (тех же
манифестов, что у шаринга), настроек интерфейса, групп и списка тем. В облако
уезжают ссылки и хеши, а не файлы, поэтому сотня сборок весит сотни килобайт.
`cloud_pull` ставит только отсутствующие сборки, если не назвать их явно.

### media — [src-tauri/src/engine/media](src-tauri/src/engine/media)

Музыка, звуки интерфейса и обои: скачивание, перекодирование ogg (WKWebView на
macOS его не играет), выбор файла пользователем.

## Фронтенд

- Роутера нет. Экран переключается классом `on` на `<section class="screen">`;
  активный экран хранится в `useUi().screen`
  ([src/state/ui.ts](src/state/ui.ts), `ScreenId`). Компоненты экранов
  подгружаются лениво и прогреваются после старта —
  [src/screens/registry.ts](src/screens/registry.ts).
- Состояние — zustand, по стору на область: аккаунты, профили, моды, установки,
  друзья, игра, обои, серверы, UI ([src/state](src/state)).
- CSS — обычные файлы без препроцессоров и UI-библиотек, импортируются в
  [src/main.tsx](src/main.tsx) строго по порядку `01-base` → `05-media`.
  Порядок менять нельзя: каскад завязан на него.
- [src/ipc/tauri.ts](src/ipc/tauri.ts) — мост к Tauri. API импортируется из
  пакетов, а не из `window.__TAURI__`: глобал выключен
  (`withGlobalTauri: false`), чтобы XSS не получила доступ к IPC. `hasTauri()`
  отличает приложение от браузера — без ядра экраны показывают заглушки.
- [src/ipc/commands.ts](src/ipc/commands.ts) — типизированные обёртки над
  `invoke`, по одной на команду.
- [src/ipc/events.ts](src/ipc/events.ts) — подписки на события ядра:
  `launch-progress`, `launch-warning`, `install-progress`, `game-exit`,
  `game-log`, `host-console`, `tray-exit` и другие.
- [src/lib](src/lib) — вспомогательное: `api.ts` (HTTP к бэкенду),
  `secure.ts` (знание о наличии сессий, без значений), `launch.ts`, `install.ts`,
  `updater.ts`, `telemetry.ts`, `markdown.tsx`, `mine3d.ts` (ленивая загрузка
  движка 3D-превью скинов из `src/vendor/mine3d`), `skinBody.ts` (офскрин-рендер
  карточек).
- В `localStorage` лежат только пользовательские настройки под префиксом `m-`
  (тема, акцент, обои, звук, память по сборкам, список аккаунтов без токенов).
  Ключи и форматы совместимы со старыми версиями, их нельзя переименовывать
  без миграции.

## Звонки

Голос и показ экрана идут напрямую между лаунчерами (WebRTC). Сервер знает
только, кто с кем разговаривает: он передаёт конверты сигналинга, держит состав
голосовых комнат и выдаёт часовые доступы к ретранслятору (`friends/calls` и
`friends/rooms` в trade-api). Своего медиасервера нет: разговор в группе идёт
мешом — каждый шлёт голос каждому. Голосу это посильно всей группой (до десяти:
девять потоков Opus ≈ 360 кбит/с исходящего), а вот показ экрана уходит каждому
зрителю отдельным потоком и ниже читаемого битрейта не сжимается — поэтому его
потолок делится на число зрителей, сам показ доступен, пока в разговоре не больше
пяти человек, и полностью выключен, когда соединение идёт через ретранслятор.

- [src/state/call.ts](src/state/call.ts) — состояние разговора и весь порядок
  действий: дозвон, ответ, вход в голос группы, обрыв, мут, глушение, показ
  экрана. В личке вежливость при пересогласовании задаёт роль (звонящий /
  отвечающий), в группе — порядок идентификаторов; ни то, ни другое не меняется
  при пересборке соединения после обрыва.
- [src/lib/call/session.ts](src/lib/call/session.ts) — разговор как набор
  соединений. Личка — его частный случай с одним собеседником: обе формы идут
  одним кодом, иначе мут и показ экрана вели бы себя в группе иначе, чем в личке.
- Группа: комната всегда открыта, в неё заходят, а не дозваниваются. Состав
  считает сервер и рассылает конвертом `roster`; лаунчер отмечается раз в 15
  секунд, поэтому перезапуск API состав не теряет.
- [src/lib/call/peer.ts](src/lib/call/peer.ts) — `RTCPeerConnection`: дорожки,
  канал состояния (мут и показ экрана летят по нему, а не через сервер),
  качество связи.
- [src/lib/call/signal.ts](src/lib/call/signal.ts) — приём конвертов. Запрос
  висит на сервере до события, поэтому звонок звенит сразу, а простаивающий
  лаунчер не опрашивает API вхолостую.
- [src/lib/call/mic-worklet.ts](src/lib/call/mic-worklet.ts) — шумоподавление.
  Считает его `micGateStep`, и она же подставляется текстом в исходник
  процессора: одна
  реализация, но проверяемая обычным тестом ([gate.test.ts](src/lib/call/gate.test.ts)).
  Процессор подключается через `blob:` — свой файл потребовал бы расширить
  `script-src`, а он закреплён тестом ядра. По той же причине здесь нет
  шумоподавления на WebAssembly: ему нужен `wasm-unsafe-eval`.
- Показ экрана — `getDisplayMedia` с окном выбора самого движка. На macOS
  встроенный WKWebView его не отдаёт, кнопка там не показывается. Дорожка уходит
  с `degradationPreference: maintain-resolution` и `scaleResolutionDownBy: 1`:
  при нехватке канала кодек жертвует кадрами, а не разрешением — уменьшенная
  картинка растягивается у зрителя обратно и читаться перестаёт.
- Обработка микрофона движком (автоуровень, эхоподавление) — настройка, а не
  константа: автоуровень ведёт громкость сам и на долгой речи её убавляет, а
  усиление в лаунчере задаётся ползунком. По умолчанию автоуровень выключен.

## Безопасность как принцип архитектуры

1. **Секреты только в Rust.** [secrets.rs](src-tauri/src/secrets.rs) — свой
   сейф: `secrets.bin` шифруется AES-256-GCM (свежий nonce на запись, имя ключа
   как AAD), ключ `vault.key` — 32 случайных байта, обёрнутые DPAPI на Windows
   и с правами 0600 на Unix, итоговый ключ шифра выводится HKDF-SHA256 из
   `vault.key` и идентификатора машины. Скопированные на другую машину файлы
   бесполезны. Системная связка ключей намеренно не используется: хеш бинарника
   меняется при каждом автообновлении, и Keychain на macOS начинает вечно
   спрашивать пароль.
2. **Вебвью не видит токены.** Фронтенд оперирует идентификатором аккаунта:
   `ms_profile`, `ms_set_cape`, `ms_upload_skin`, `launch_game` принимают
   `accountId`, а токен ядро достаёт из сейфа само. Единственное, что фронтенд
   узнаёт, — `session_status`: есть сессия или нет
   ([src/lib/secure.ts](src/lib/secure.ts)). Токены из старых версий, лежавшие
   в `localStorage`, при старте удаляются.
3. **Пути из внешних данных.** Всё, что приходит из mrpack, манифестов
   CurseForge и по IPC, проходит через `safe_join` / `safe_child` /
   `safe_file_name` ([safepath.rs](src-tauri/src/engine/core/safepath.rs)):
   отбрасываются абсолютные пути (`PathBuf::join` молча заменяет базу), обход
   через `..`, управляющие символы, зарезервированные имена Windows, имена с
   точкой или пробелом на конце. Проверка идёт по канонизированному пути, а не
   по подстроке.
4. **Скачиваемое проверяется.** `download_checked` сверяет sha1/sha256/sha512 и
   размер до того, как файл встанет на место: клиент игры и библиотеки — по
   хешам из манифеста Mojang, JRE — по sha256 из ответа Adoptium, файлы
   Modrinth и CurseForge — по хешам их API, обновление лаунчера — по
   minisign-подписи.
5. **Права вебвью урезаны.**
   [src-tauri/capabilities/default.json](src-tauri/capabilities/default.json)
   разрешает только события, управление своим окном, апдейтер, deep-link,
   запись в буфер обмена и перезапуск процесса. Ни файловой системы, ни shell.
   Ссылки и папки открываются командами ядра, а не оболочкой.
6. **CSP и область asset-протокола.** В
   [tauri.conf.json](src-tauri/tauri.conf.json) `script-src` — только `'self'`,
   `object-src` — `'none'`, `frame-src` — ровно два плеера
   (`www.youtube-nocookie.com` и `w.soundcloud.com`: музыка по ссылке и
   трейлеры), список внешних хостов в `connect-src`
   закрытый (новый домен нужно добавлять в оба блока: `csp` и `devCsp`).
   Область `asset:` пустая в конфиге и сужается в рантайме до папки данных и
   папки игры (`allow_assets` в [lib.rs](src-tauri/src/lib.rs)).

## Путь запуска игры

Точка входа — `install_and_launch_in`
([launch.rs](src-tauri/src/engine/game/launch.rs)), её вызывает команда
`launch_game` / `launch_profile`.

1. **Профиль.** Из `profiles.json` берутся версия игры, загрузчик и его версия;
   из `millida-settings.json` в папке сборки — аргументы JVM, размер окна и
   выбранная Java. Настройки читаются до установки, чтобы свой путь к Java
   отменил скачивание JRE, а не отменил его задним числом.
2. **Версия и загрузчик.** `install_loader_with_java` докачивает манифест,
   version json, клиент, библиотеки и ассеты (параллельно, с проверкой хешей),
   затем ставит загрузчик: Fabric и Quilt — из их meta-API, Forge и NeoForge —
   через официальный установщик из maven. На выходе — итоговый version json,
   главный класс и classpath в порядке из version json.
3. **Java.** `ensure_java` берёт мажор из version json, ищет уже скачанный JRE,
   проверяет его целостность и при необходимости качает Temurin.
4. **Аргументы.** `build_args` подставляет подстановки Mojang (пути, ассеты,
   нативы, сессия). Сверху добавляются `-Xmx`, мера против Log4Shell
   (`-Dlog4j2.formatMsgNoLookups=true`, а для 1.7–1.11.2 — заменяющий конфиг
   логгера), пользовательские аргументы JVM, профиль GC режима «Буст FPS»
   (`fpsboost.rs`, левее пользовательских — свой флаг игрока сильнее), размер
   окна, Quick Play.
5. **Сессия.** Для лицензии подставляются токен, uuid и xuid; для скинов
   Millida добавляется `-javaagent` authlib-injector, а на модовых сборках при
   необходимости ставится CustomSkinLoader — но только в сборку, которая ещё не
   получала его и не имеет своего мода скинов. Если агент поставить не удалось,
   запуск честно уходит в офлайн-режим с предупреждением, а не притворяется
   онлайновым.
6. **Процесс.** JVM запускается с рабочей папкой сборки, без консольного окна на
   Windows; stdout и stderr читаются в `logs/launcher-latest.log` и стримятся в
   интерфейс. Мгновенный выход считается провалом запуска, а не сессией.
   Запущенные игры лежат в `RUNNING` (профиль → pid); остановка по запросу
   помечает pid, чтобы ненулевой код возврата не приняли за падение.

Прогресс всё это время уходит событием `launch-progress`, предупреждения —
`launch-warning`.

## Как добавить IPC-команду

Пример: команда `list_backups`.

1. **Логика — в движок.** Функция в подходящем модуле `engine/**`, возвращает
   `Result<T, String>` (текст ошибки виден пользователю, пишите по-русски и по
   делу). Всё, что приходит извне, — через `safe_*`. Экспортируйте её из
   `mod.rs` модуля.
2. **Обёртка — в `commands/**`.** Файл по области: `profiles`, `content`,
   `launch`, `accounts`, `hosting`, `system`.

   ```rust
   #[tauri::command]
   pub fn list_backups(profile: String) -> Vec<String> {
       engine::list_backups(&profile)
   }
   ```

   Долгие операции делайте `async` и уводите блокирующую работу в
   `tauri::async_runtime::spawn_blocking`, иначе окно замрёт. Прогресс — через
   `app.emit(...)` и реестр задач из `jobs.rs`, а не возвратом значения в конце.
3. **Регистрация.** Добавьте `commands::<модуль>::<имя>` в
   `tauri::generate_handler![...]` в [lib.rs](src-tauri/src/lib.rs). Без этого
   `invoke` вернёт ошибку о неизвестной команде.
4. **Обёртка на фронте.** В [src/ipc/commands.ts](src/ipc/commands.ts):

   ```ts
   export const listBackups = (profile: string) =>
     invoke<string[]>('list_backups', { profile })
   ```

   Имена аргументов — camelCase на стороне JS, ядро принимает их как есть
   (`snake_case` в Rust маппится автоматически). Типы структур описывайте
   интерфейсом рядом, а не `any`.
5. **События, если они есть.** Новое событие — подписка в
   [src/ipc/events.ts](src/ipc/events.ts) по образцу существующих: она
   возвращает `null` вне Tauri, чтобы браузерный режим не падал.
6. **Проверка.** `bun run typecheck`, затем `cargo clippy --all-targets -- -D warnings`
   и `cargo test` из `src-tauri`.

Отдельно: если команда нужна вебвью только ради того, чтобы что-то передать
дальше в наш API, — используйте существующий `millida_api`, а не новый прокси.
И никогда не возвращайте во фронтенд значение токена: возвращайте признак.

## Тесты

- **Rust.** Модульные тесты живут рядом с кодом, в `#[cfg(test)] mod tests`:
  `core/safepath.rs`, `core/http.rs`, `core/jobs.rs`, `core/paths.rs`,
  `core/selfupdate.rs`, `game/install.rs`, `game/java.rs`, `game/launch.rs`,
  `game/serversdat.rs`, `content/curseforge.rs`, `content/localmeta.rs`,
  `profiles/store.rs`, `profiles/imports.rs`, `accounts/session.rs`,
  `skins/library.rs`, `skins/heads.rs`, `secrets.rs`.

  ```bash
  cd src-tauri
  cargo test
  cargo test -- --ignored   # тесты, которым нужна сеть
  ```

- **Фронтенд.** `bun test` (например, [src/state/msLogin.test.ts](src/state/msLogin.test.ts)).
- **Статические проверки.** `bun run typecheck` (`tsc -b`, strict) и
  `cargo clippy --all-targets -- -D warnings`. Форматтер не используется.
- **Гейт сборки.** `bun run build:web` после сборки запускает
  [scripts/check-frontend-gate.mjs](scripts/check-frontend-gate.mjs): в бандле
  должен остаться вызов `frontend_ready`, иначе ядро сочтёт вебвью мёртвым и
  будет переустанавливать лаунчер на каждом запуске (`core/selfheal.rs`).

## Данные на диске

- Данные лаунчера — `data_dir()/net.millida.launcher`: `profiles.json`,
  `secrets.bin`, `vault.key`, `game-root.txt`, скачанные JRE в `java/`.
  На Windows это `%APPDATA%`, на macOS `~/Library/Application Support`,
  на Linux `~/.local/share`.
- Файлы игры — `game_root()`, по умолчанию `<данные>/minecraft`: `versions`,
  `libraries`, `assets`, `natives`, `runtime` и `profiles/<имя сборки>`.
  Папку можно перенести (`set_game_dir`), путь запоминается в `game-root.txt`;
  если диск недоступен, ядро сообщает об ошибке, а не делает вид, что сборок нет.

</details>
