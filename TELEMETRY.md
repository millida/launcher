# Telemetry

Russian version: [TELEMETRY.ru.md](TELEMETRY.ru.md)

The launcher sends events about its own operation to `https://api.millida.net/v2/launcher/telemetry`: versions, hardware, launches, installs, errors, game crashes, screen transitions and button clicks. If you are signed in to a Millida account, the server ties this data to the account, so it is not anonymous statistics. It can be turned off in "Settings → Account → Usage statistics".

## Why we need it

Without crash events, we learn about a breakage only when someone writes to support.

- 2026-10-13: the most frequent crash on Fabric ("ArrayList cannot be cast to AnnotationNode", 359 reports in three hours). The crash events showed that only builds with an old Fabric Loader were failing. The cause was our own mod, fixed the same day.
- 2026-10-12 to 13: after release 2.0.217 the lobby crashed on 14% of installs. The error events led us to the cause within an hour. In 2.0.219 there are zero such crashes across 403 installs.
- 2026-10-13: "Update all" installed a beta version of Sodium, which broke builds with Reese's Sodium Options. We noticed it from crash causes (36 installs in half a day) and fixed the version selection.
- Long-frame measurements showed which screens lag (the lobby with the 3D character) and on what hardware: 24% of installs have 8 GB of memory or less, and 38% have an integrated graphics card. The interface is being lightened for them.

## What is sent

Every batch carries a device block: OS and version, architecture, launcher version, system language, time zone, screen resolution, CPU model, core and thread count, memory size, graphics card name, number of instances and mods ([src/lib/telemetry.ts](src/lib/telemetry.ts), `initDevice`). A batch is sent every 2 minutes, when the window is hidden and on exit.

| Event | What is inside | Why |
|---|---|---|
| `app_start`, `app_exit` | load time, session length | slow startup, updates |
| `game_launch`, `game_exit` | instance tag, game version, loader, catalog modpack slug and version, where "Play" was pressed from, duration; on failure the code, class and stage, and the host that failed | why it does not start |
| `game_crash` | exception class and reason (up to 300 characters), suspect mods, game version, loader ([src/lib/crashEvent.ts](src/lib/crashEvent.ts)) | the examples above |
| `error` | where (`where`), a truncated error code (up to 120 characters), class | sign-in, install and update failures |
| `content_install`, `modpack_install`, `catalog_install`, `build_create`, `build_import` | catalog project name, game version, loader, source, duration | broken installs |
| `server_join` | address and name only for servers from the rating; for others `rated: false` | popularity of modes |
| `screen_view`, `impression` | screen, where the user came from; ids of the cards in the shown block | what people find and what they do not |
| `ui_click` | screen, block, element label, card id and position | which buttons go unnoticed |
| `catalog_search` | query length and number of results, not the query itself | search quality |
| `purchase_*`, `store_open`, `pack_buy_click` | product code, id, price, outcome | where a purchase breaks off |
| `perf` | screen, number and duration of long frames, function and file name ([src/lib/jank.ts](src/lib/jank.ts)); webview memory in use ([src/lib/webviewHealth.ts](src/lib/webviewHealth.ts)); `what=proc`: memory of the launcher process and the number and memory of its WebView2 processes, with the state (lobby, tray, game), sent by the core when the window is unloaded, 20 s later, every 30 minutes while it stays in the tray and after it is opened again ([src-tauri/src/background.rs](src-tauri/src/background.rs)); `what=launch_stages`: milliseconds the core spent on each step of a launch (network checks, Java, client, libraries, natives, loader, assets, mods, start) and kilobytes downloaded, `what=launch_bytes`: kilobytes per step, `what=launch_graph`: how the steps of a launch overlapped — milliseconds of the plan and of all preparation together, which step finished last, how many steps ran, whether the lobby had prepared the build, how many missing mods were put in and how long the account's session took, `what=game_window`: how long after the click the game's window appeared and how it was noticed ([src-tauri/src/engine/game/launch_perf.rs](src-tauri/src/engine/game/launch_perf.rs)); `what=screen_open`: screen names and milliseconds from the click to the first frame of the screen ([src/lib/screenOpen.ts](src/lib/screenOpen.ts)); `what=disk`: one word, `ssd`, `hdd` or `unknown`, for the drive under the games folder, once per launcher version ([src-tauri/src/engine/core/diskkind.rs](src-tauri/src/engine/core/diskkind.rs)); `what=update_check` / `update_download`: duration and result of the launcher's own update check and download (`where=delta` for a patch update: kilobytes of the patch), a failing check once per series of failures ([src/lib/updater.ts](src/lib/updater.ts)); `what=pack_install`: how a catalogue modpack was installed (`via=index` file by file or `via=archive`), kilobytes downloaded, kilobytes taken from the shared store, number of files and the time ([src-tauri/src/engine/content/catalog_pack.rs](src-tauri/src/engine/content/catalog_pack.rs)) | the examples above, slow launches, slow disks and slow screens |
| `feedback_send`, `skin_apply`, `hosting_action`, `account_link` | type, text length, rating; cape and skin variant; action type; sign-in method | other screens |

The label in `ui_click` comes from `data-track`, `aria-label`, `title` or the button text: up to 40 characters, digits are replaced with `#`, and strings containing `@` are dropped ([src/lib/uiClick.ts](src/lib/uiClick.ts)). In blocks marked `data-private` (chats, friends) only the screen and the word `private` are recorded.

## What is tied to a person

- **Install id.** A random UUID created on first launch and stored in `localStorage` under the key `m-install-id`. It does not change until you clear the app data. The server uses it to join all events from one install. While statistics are on, a copy is kept in the `install-id` file in the launcher data folder.
- **Uninstall.** On Windows the uninstaller runs the launcher with `--report-uninstall`, and it sends only that install id to `/launcher/uninstall`, so the server can count how many installs were removed ([src-tauri/src/engine/uninstall_report.rs](src-tauri/src/engine/uninstall_report.rs)). With statistics off nothing is sent.
- **Session id.** A new UUID on every launch.
- **Account.** The request goes through the launcher core, which adds the token. If you are signed in, the server takes the account id from the token and writes it into every event and into the install row (`userId` in `launcher_telemetry_events` and `launcher_installs`, server code that is not part of this repository). A guest goes without a link. An id that was linked once is not erased by later batches without a token.
- **IP and country.** The batch intake code does not record the IP. The country is taken from a proxy header, and if there is none, it is guessed from the time zone and the system language (`geo-fallback.ts`).
- **Live online.** A separate pulse, `/launcher/heartbeat`, sends every 40 to 50 seconds the install id, status (in the lobby or in game), version, instance tag, game version and the server you are playing on, only if that server is from the rating or our own ([src/lib/liveServer.ts](src/lib/liveServer.ts)). The address and name of a private server are sent neither here nor in `server_join`. Before the version with this fix (2026-10-13) the pulse sent the name or address of any server. Separately, if you are signed in, your "in game" status with the server is sent to your friends. That is a friends-list feature, not statistics: only the people you added as friends see it. The statistics switch does not affect it.
- **Without a window.** In the tray and during a game the launcher destroys its window and its WebView2 processes; only the core keeps running. It then sends only the `perf` samples above: `what=proc`, `game_window` and `update_check` (if statistics are on), checks for an update every 6 hours, and, while a game runs, repeats the last live-online pulse and the friends "in game" status every 50 seconds. In the tray without a game it sends no pulses.

Server-side retention: launcher events are deleted after 90 days, raw clicks after 45, daily click rollups after 400 (`retention.cron.ts`). The install row (hardware, country, account, counters) is not in this list, and its retention period is not set. There is no deletion of data on request in the code.

## What is not sent

- Passwords and tokens: Bearer values, `accessToken=…` and JWTs are cut out of any text in an event ([src/lib/telemetryPrivacy.ts](src/lib/telemetryPrivacy.ts), `scrubText`).
- The home folder: `C:\Users\<name>`, `/Users/…`, `/home/…` are replaced with `<user>` (`scrubPaths`).
- The name of your own instance: events carry the catalog slug or a 32-bit fingerprint of the name (`buildTag`), and in error text the instance name and nickname are replaced with `<build>` and `<nick>`.
- The text of chats, feedback and search queries: events carry only the length (`len`).
- The contents of files and worlds. There are no events with such fields in the code.

Error reports (`/errors`, [src/lib/crash.ts](src/lib/crash.ts)) contain a message and the tail of the game log, passed through `redactSecrets` and `maskValues`. The nickname and instance name are replaced in them. The cleanup is pattern-based: it may miss an unusual secret or path in the game log.

## How to turn it off

"Settings → Account → Usage statistics" (before 2026-10-13 the switch was called "Anonymous statistics"; the name was changed because for a signed-in user the statistics are tied to the account). The switch is saved in `localStorage` (`m-telemetry-off`), clears the queue of unsent data and stops: events, the pulse, error reports and mod summaries (the launcher writes a switch file for the game). What was already sent stays on the server. Requests for other reasons (the catalog, sign-in, updates, the friends socket) continue, but the install id is not passed to the socket.

## How to check

- Client: [src/lib/telemetry.ts](src/lib/telemetry.ts), `track`, `push`, `send`. Clicks: [src/lib/uiTrack.ts](src/lib/uiTrack.ts), [src/lib/uiClick.ts](src/lib/uiClick.ts).
- Intake endpoint: `POST https://api.millida.net/v2/launcher/telemetry`, JSON body `{device, events}`. The request goes through the Rust core, so it does not appear in the browser DevTools. You can watch it through a system proxy (mitmproxy) or in the `m-telemetry-queue` queue in the webview's `localStorage`.
- Building from source: [BUILDING.md](BUILDING.md).

## The in-game mod

The Millida mod ([millida/millida-mod](https://github.com/millida/millida-mod), `ModTelemetry.java`) sends a session summary to `/launcher/mod-telemetry` no more often than once every 15 minutes: the versions of the mod, game, loader and Java, the OS, failure counters per subsystem, the number of worn and not-shown items, frames per second in the world (median and the lowest 5%) and what renders the world (Sodium, Embeddium, OptiFine or the game itself), to check whether the optimization set speeds the game up, its own install id (a separate `telemetry-id` file, different from the launcher's id), and whether a token is present. It contains no nickname, UUID or paths. The mod is turned off by the same switch, and also by a property or environment variable set to `off`.
