# Откуда берётся лаунчер и как это проверить

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
   файл не поставится, откуда бы он ни пришёл. Сама подпись — отдельный файл, байты программы она не меняет.

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

**Собрать самому** — три команды в [BUILDING.md](BUILDING.md).

## Что лаунчер качает и откуда

Всё видно в коде — перехвати трафик и сверь с этой таблицей.

| Что | Откуда | Как проверяется |
| --- | --- | --- |
| Сам лаунчер и его обновления | [Releases](https://github.com/millida/launcher/releases) этого репозитория; наш `launcher-storage.millida.net` — запасная копия тех же байтов | подпись обновления ([selfupdate.rs](src-tauri/src/engine/core/selfupdate.rs)) |
| Minecraft, Java, Fabric/Forge/NeoForge/Quilt | официальные сайты Mojang, Adoptium/Azul, загрузчиков | хеши из их же списков |
| Моды и сборки | Modrinth, CurseForge, каталог Millida | хеш каждого файла |
| Мод Millida (скины и косметика в игре) | `cdn.millida.net/mod` | sha256 каждого jar из списка версий; если список подписан — ещё и подпись ([millida_mod.rs](src-tauri/src/engine/content/millida_mod.rs)) |
| Агент скинов authlib-injector | сайт проекта и его GitHub | sha256 |

Modrinth, CurseForge и часть сайтов Mojang в России открываются не у всех. Тогда тот же файл идёт через
наш сервер-посредник — список адресов в [mirror.rs](src-tauri/src/engine/core/mirror.rs); там, где сайт
открывается, лаунчер ходит напрямую.

## Аккаунт украсть нельзя — вот почему

| Чего боятся | Как на самом деле | Где проверить |
| --- | --- | --- |
| Лаунчер увидит пароль | Пароль вводится на сайте Microsoft по коду, лаунчер его не получает | [microsoft.rs](src-tauri/src/engine/accounts/microsoft.rs) — `devicecode` |
| Токен уйдёт в Millida | Токен Microsoft ходит только на сервера Microsoft и Mojang и передаётся самой игре при запуске, как в любом лаунчере. На сервера Millida — никогда. Вход Ely.by — так же, на сайт Ely.by | [microsoft.rs](src-tauri/src/engine/accounts/microsoft.rs), [accounts.rs](src-tauri/src/commands/accounts.rs) |
| Токен утащит сайт внутри лаунчера | Интерфейс токена не видит: ядро вырезает его из ответа | [session.rs](src-tauri/src/engine/accounts/session.rs) — `keep_tokens` |
| Лаунчер полезет в файлы или запустит что угодно | У интерфейса нет доступа к диску и командной строке, только к командам ядра | [capabilities/default.json](src-tauri/capabilities/default.json) |
| Подсунут обновление | Обновление без нашей подписи не установится | [selfupdate.rs](src-tauri/src/engine/core/selfupdate.rs), ключ в [tauri.conf.json](src-tauri/tauri.conf.json) |

Токены лежат только на твоём компьютере в зашифрованном файле ([secrets.rs](src-tauri/src/secrets.rs)).
Шифрование не даёт унести файл на другой ПК. От вируса, который уже сидит на твоём компьютере, не спасает ни один лаунчер.

Статистика (версия, железо, вылеты, без ников и паролей) — [telemetry.ts](src/lib/telemetry.ts); выключается в «Настройки → Аккаунт → Анонимная статистика».

## Честно о том, что не здесь

- **Разработка** идёт во внутреннем репозитории: там задачи, черновики и ключи публикации. Каждый релиз целиком
  приходит сюда, и собирается он здесь — не там. Коммит `Release X.Y.Z` содержит весь код этой версии и список изменений.
- **Подпись обновлений** ставится нашим ключом после сборки. Подпись не меняет файл: байты те же, что собрал GitHub,
  отпечаток совпадает с `SHA256SUMS`.
- **Маленький установщик с сайта** (`MillidaLauncherSetup.exe`) собирается отдельно и подписан сертификатом Windows.
  Лаунчера внутри нет: он скачивает установщик текущей версии с `launcher-storage.millida.net` — это те же байты,
  что в релизе здесь, SHA-256 совпадает со строкой в `SHA256SUMS`. Код установщика — [installer/](installer/).
- **Установщик для macOS с сайта** пока собран вне GitHub и подписан сертификатом Apple разработчика лаунчера.
  Сборки для macOS из Releases — с GitHub, их можно ставить напрямую.
- **Мобильный лаунчер** — отдельный открытый репозиторий [millida/launcher-mobile](https://github.com/millida/launcher-mobile): каждая версия приходит туда коммитом с номером версии.

Нашёл дыру в безопасности — [SECURITY.md](SECURITY.md).
