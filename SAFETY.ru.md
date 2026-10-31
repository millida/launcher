# Откуда берётся лаунчер и как это проверить

[English version: SAFETY.md](SAFETY.md)

## Коротко

```
код в этом репозитории ──► GitHub Actions ──► Releases ──► установщик и автообновление
```

1. Код, который ты видишь здесь, — весь код самого лаунчера. Мод Millida для игры (скины и косметика) собирается
   отдельно и сюда не входит — как лаунчер его проверяет, см. таблицу ниже.
2. Собирает его не человек, а робот GitHub ([release.yml](.github/workflows/release.yml)) на компьютерах GitHub.
3. Готовые файлы лежат в [Releases](https://github.com/millida/launcher/releases). У каждого есть
   [свидетельство GitHub](https://github.com/millida/launcher/attestations) — из какого коммита и каким workflow он собран.
   Подмену видно: у подменённого файла свидетельства не будет.
4. Какая версия последняя, лаунчер узнаёт у нашего сервера (`launcher-storage.millida.net`), а сам файл качает из
   Releases на GitHub; если GitHub не открывается — ту же копию с нашего сервера. Перед установкой файл проверяется
   подписью Millida (открытая часть ключа — в [tauri.conf.json](src-tauri/tauri.conf.json)): без закрытой части чужой
   файл не поставится, откуда бы он ни пришёл. Сама подпись — отдельный файл, байты программы она не меняет. Уже скачанное и проверенное обновление ставится само, только когда никто не смотрит:
   лаунчер сидит в трее, игра не идёт и ничего не качается десять минут, либо он как раз запускается и окно ещё не
   показано (не когда вы запустили его играть). Подпись проверяется ещё раз прямо перед запуском файла, а две
   неудачные попытки на одной версии останавливают дальнейшие.

## Проверить самому за минуту

**Главная проверка — свидетельство GitHub** (нужен [GitHub CLI](https://cli.github.com)): доказывает, что файл собрал
GitHub из этого репозитория.

```bash
gh attestation verify Millida-Launcher_X.Y.Z_x64-setup.exe -R millida/launcher
```

**Без программ** — сравнить, что файл с сайта тот же, что на GitHub. Посчитай отпечаток:

| Система | Команда |
| --- | --- |
| Windows (PowerShell) | `Get-FileHash .\Millida-Launcher_X.Y.Z_x64-setup.exe` |
| macOS | `shasum -a 256 Millida-Launcher_X.Y.Z_aarch64.dmg` |
| Linux | `sha256sum Millida-Launcher_X.Y.Z_amd64.AppImage` |

Отпечаток должен совпасть со строкой в файле `SHA256SUMS` того же релиза. Тот же отпечаток можно вбить в поиск на
[virustotal.com](https://www.virustotal.com) и посмотреть проверку десятками антивирусов.

**Собрать самому** — три команды в [BUILDING.md](BUILDING.ru.md).

## Что лаунчер качает и откуда

Всё видно в коде — перехвати трафик и сверь с этой таблицей.

| Что | Откуда | Как проверяется |
| --- | --- | --- |
| Сам лаунчер и его обновления | [Releases](https://github.com/millida/launcher/releases) этого репозитория; наш `launcher-storage.millida.net` — запасная копия тех же байтов | подпись обновления ([selfupdate.rs](src-tauri/src/engine/core/selfupdate.rs)) |
| Minecraft, Java, Fabric/Forge/NeoForge/Quilt | официальные сайты Mojang, Adoptium/Azul, загрузчиков | хеши из их же списков |
| Моды и сборки | Modrinth, CurseForge, каталог Millida | хеш каждого файла |
| Мод Millida (скины и косметика в игре) | `cdn.millida.net/mod` | sha256 каждого jar из списка версий; если список подписан — ещё и подпись ([millida_mod.rs](src-tauri/src/engine/content/millida_mod.rs)) |
| Агент скинов authlib-injector | сайт проекта и его GitHub | sha256 |
| Таблица закреплённых модов производительности (какую именно версию Sodium и подобных ставить с Modrinth) | `cdn.millida.net/launcher/perf-profiles.json`, копия зашита в лаунчер | копия из сети не подписана, но принимается, только если называет моды из зашитого в лаунчер списка и новее зашитой; сами файлы идут с Modrinth с его хешами ([perfpins.rs](src-tauri/src/engine/game/perfpins.rs)) |
| Шейдеры и простые текстуры уровней графики (Complementary, BSL, Bare Bones) | Modrinth, из закреплённого списка в [shaders.rs](src-tauri/src/engine/game/shaders.rs) и [presets.rs](src-tauri/src/engine/game/presets.rs) | хеш каждого файла |
| Патч самого лаунчера (только Windows, когда выпуск его предлагает) | файл, названный в подписанном списке версий: `launcher-storage.millida.net`, те же байты в Releases на GitHub — вторым путём | sha256 патча и подпись **готового** файла программы ключом обновлений; не прошедший файл удаляется, ставится полный установщик ([selfdelta.rs](src-tauri/src/engine/core/selfdelta.rs)) |
| Музыка радио, ролики-обои и страница Arcania (только в выпуске, собранном с `MEDIA_REMOTE=1`; иначе они внутри установщика и ничего не скачивается) | `launcher-storage.millida.net/media/`, затем релиз `media` этого репозитория; имя файла — его sha256 | sha256 и размер каждого файла из списка, зашитого в лаунчер ([media.rs](src-tauri/src/engine/core/media.rs)) |
| Сборка каталога по файлам | список файлов сборки с `api.millida.net` (`/catalog/packs/files/{id}/index`), затем запросы диапазонов к архиву сборки на CDN Millida | размер, CRC и sha256 каждого файла из списка, а при загрузке целиком — sha512 всего архива ([pack_install.rs](src-tauri/src/engine/content/pack_install.rs)) |
| Адрес узла, когда системный DNS его не нашёл | имя узла (`api.millida.net`, сайт Mojang или модов) спрашивается по HTTPS у публичных DNS: Cloudflare `1.1.1.1`, Google `8.8.8.8`, Яндекс `77.88.8.8`. Только после того, как системный разрешитель отказал или молчал 3 секунды. Кроме имени узла не уходит ничего | сертификат сайта при самом соединении проверяется как обычно ([doh.rs](src-tauri/src/engine/core/doh.rs)) |

Modrinth, CurseForge и часть сайтов Mojang в России открываются не у всех. Тогда тот же файл идёт через
наш сервер-посредник — список адресов в [mirror.rs](src-tauri/src/engine/core/mirror.rs); там, где сайт
открывается, лаунчер ходит напрямую.

## Аккаунт украсть нельзя — вот почему

| Чего боятся | Как на самом деле | Где проверить |
| --- | --- | --- |
| Лаунчер увидит пароль | Пароль вводится на сайте Microsoft по коду, лаунчер его не получает | [microsoft.rs](src-tauri/src/engine/accounts/microsoft.rs) — `devicecode` |
| Токен уйдёт в Millida | Токен Microsoft ходит только на сервера Microsoft и Mojang и передаётся самой игре при запуске, как в любом лаунчере. На сервера Millida — никогда. | [microsoft.rs](src-tauri/src/engine/accounts/microsoft.rs), [accounts.rs](src-tauri/src/commands/accounts.rs) |
| Токен утащит сайт внутри лаунчера | Интерфейс токена не видит: ядро вырезает его из ответа | [session.rs](src-tauri/src/engine/accounts/session.rs) — `keep_tokens` |
| Лаунчер полезет в файлы или запустит что угодно | У интерфейса нет доступа к диску и командной строке, только к командам ядра | [capabilities/default.json](src-tauri/capabilities/default.json) |
| Подсунут обновление | Обновление без нашей подписи не установится | [selfupdate.rs](src-tauri/src/engine/core/selfupdate.rs), ключ в [tauri.conf.json](src-tauri/tauri.conf.json) |

Токены лежат только на твоём компьютере в зашифрованном файле ([secrets.rs](src-tauri/src/secrets.rs)).
Шифрование не даёт унести файл на другой ПК. От вируса, который уже сидит на твоём компьютере, не спасает ни один лаунчер.

Статистика (версия, железо, вылеты, клики; у вошедшего в аккаунт привязана к нему) — что уходит и зачем: [TELEMETRY.md](TELEMETRY.ru.md); выключается в «Настройки → Аккаунт → Статистика использования».

## Честно о том, что не здесь

- **Разработка** идёт во внутреннем репозитории: там задачи, черновики и ключи публикации. Каждый релиз целиком
  приходит сюда, и собирается он здесь — не там. Коммит `Release X.Y.Z` содержит весь код этой версии и список изменений.
- **Подпись обновлений** ставится нашим ключом после сборки. Подпись не меняет файл: байты те же, что собрал GitHub,
  отпечаток совпадает с `SHA256SUMS`.
- **Кнопка «Скачать» на сайте** отдаёт не сборку из Releases, а установщик. Что это за файлы, сказано ниже, а
  их суммы — в [installer/site-files.json](installer/site-files.json).

  | Система | Файл с кнопки | Где собран | Кто подписал |
  | --- | --- | --- | --- |
  | Windows | `MillidaLauncherSetup.exe`, 1,9 МБ, лежит в релизе [setup-signed-1](https://github.com/millida/launcher/releases/tag/setup-signed-1). Лаунчера внутри нет: он скачивает установщик текущей версии — те же байты, что в релизе здесь | вне GitHub, 03.09.2026 | EV-сертификат GlobalSign, ИП Веселов Никита Николаевич |
  | macOS | `Millida-Launcher-aarch64.dmg`, `Millida-Launcher-x64.dmg`. Дальше лаунчер обновляется сборками из Releases | вне GitHub, 10.09.2026 | Developer ID: Mark Sheremeta (G6P84BXZCC), нотаризован Apple |
  | Linux | `.deb`, `.rpm`, AppImage | здесь, это файлы релиза | не подписаны; сверяются по `SHA256SUMS` и аттестации |

  Почему установщик Windows и образ macOS собраны не здесь: сборки GitHub для них не подписаны (подпись Windows
  лежит на аппаратном ключе, подпись Apple в сборку ещё не заведена), а неподписанный файл Windows и macOS запускать
  отговаривают, и часть антивирусов срабатывает на него без причины. Что с этим делаем: установщик Windows уже
  собирается здесь — релизы `setup-v*` с аттестацией; кнопка сайта перейдёт на него, когда эта сборка получит
  подпись. Он берёт с GitHub всё: список версий (`latest.json`, приложен к каждому релизу лаунчера прогоном
  [Manifest](https://github.com/millida/launcher/actions/workflows/manifest.yml) после сверки с `SHA256SUMS`), сам
  установщик лаунчера и его сумму; хранилище Millida — запасное зеркало с теми же байтами. Подписи Windows на нём пока
  нет, поэтому при первом запуске Windows показывает окно «Неизвестный издатель»: как это устроено и что мы делаем —
  в [CODE_SIGNING.md](CODE_SIGNING.ru.md).
- **Проверка без нас.** [Verify downloads](https://github.com/millida/launcher/actions/workflows/verify.yml) четыре раза
  в сутки скачивает всё, что раздаётся (файлы обновлений и установщики с кнопки), и сверяет: первые — с `SHA256SUMS`
  релиза, вторые — со списком выше. Расхождение делает прогон красным. То же самое можно запустить у себя:
  `node scripts/verify-downloads.mjs`.
- **Мобильный лаунчер** — отдельный открытый репозиторий [millida/launcher-mobile](https://github.com/millida/launcher-mobile): каждая версия приходит туда коммитом с номером версии.

Нашёл дыру в безопасности — [SECURITY.md](SECURITY.ru.md).
