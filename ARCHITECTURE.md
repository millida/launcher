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
`localmeta.rs`, `scan.rs` — распознавание уже лежащих в папке файлов по хешу и
метаданным; из jar читаются и связи мода (`mod_id`, `provides`, `requires`,
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
   `object-src` и `frame-src` — `'none'`, список внешних хостов в `connect-src`
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
