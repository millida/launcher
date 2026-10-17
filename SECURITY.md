# Security

Thank you for taking the time to report a problem. The launcher starts the game, uses the
network, unpacks archives from external catalogs and stores the user's tokens.
A bug in any of these places can cost a person their account or files, so
we handle such reports first.

## Where to report

**security@millida.net**

Please do not open a public issue. Do not describe the vulnerability in a pull
request, discussions or chats until it is fixed. A public description before
the update is out gives a ready attack scenario against users who have an
old build. Give us time to fix it and ship a release. After that we
do not mind a publication, and we will credit you if you want that.

What helps us understand faster:

- the launcher version and the operating system;
- steps to reproduce, or a minimal proof of concept;
- the practical impact: what exactly the attacker gets;
- logs or files, if they are needed to understand the problem. Please do not send tokens or the contents of `secrets.bin`
  and `vault.key`.

## Timing

We give the first answer within **72 hours**. In it we confirm that we got your report and say
whether we reproduced the problem. After that we keep you updated during the review and tell you
when the fix is in a release.

## In scope

The launcher itself: the code in this repository and the builds made from it:

- handling content from external catalogs (Modrinth, CurseForge, modpacks,
  archives, worlds, resource packs): everything that is unpacked and run;
- path handling: leaving the data directory during unpacking or import,
  replacing game files, symbolic links;
- storing and passing credentials: the local secret storage, the boundary
  between the core and the webview, Minecraft and Microsoft sessions;
- the update mechanism: signature check, fallback channel, artifact replacement;
- starting the game: building JVM arguments, choosing Java, work with the server and
  `servers.dat`;
- core integrations: deep link, tray, clipboard, opening external links and
  folders;
- the security configuration of the build: CSP, Tauri capabilities, file permissions.

## Out of scope

- Our servers and services: `api.millida.net`, `millida.net`, the update CDN,
  sites and panels. Testing them is not agreed at this address. Report problems in
  them to the same address, but in a separate message and without active scanning.
- Vulnerabilities in third-party services and catalogs (Modrinth, CurseForge, Microsoft,
  mc-heads.net). Report them to their owners.
- Social engineering, phishing, physical access to someone else's device, attacks on
  employees.
- Reports from automatic scanners and linters without confirmed exploitation:
  a list of "vulnerable" dependencies, scores without a working scenario, antivirus
  detections on an unsigned installer.
- Scenarios where the attacker already needs administrator rights or
  access to the user's account on their machine.
- A missing protection that we never promised. For example, the launcher is not meant to
  stop a user who changes their own game files.

## Supported builds

Fixes ship only in the latest release. The launcher updates itself, so
before you send a report, check that the problem still happens on the current
version. The number is shown in the launcher settings.

| Version | Support |
| --- | --- |
| latest release | yes |
| anything older | no |

---

<details>
<summary><b>Русская версия</b></summary>

# Безопасность

Спасибо, что нашли время сообщить о проблеме. Лаунчер запускает игру, ходит в
сеть, распаковывает архивы из внешних каталогов и хранит токены пользователя —
любая ошибка в этих местах может стоить человеку аккаунта или файлов, поэтому
такие сообщения мы разбираем в первую очередь.

## Куда сообщать

**security@millida.net**

Пожалуйста, не открывайте публичный issue и не описывайте уязвимость в pull
request, обсуждениях или чатах, пока она не исправлена. Публичное описание до
выхода обновления даёт готовый сценарий атаки на пользователей, у которых стоит
старая сборка. Дайте нам время на исправление и выпуск релиза — после этого мы
не против публикации, и упомянем вас, если вы этого хотите.

Что помогает разобраться быстрее:

- версия лаунчера и операционная система;
- шаги воспроизведения или минимальный proof-of-concept;
- в чём практическое последствие — что именно получает атакующий;
- логи или файлы, если они нужны для понимания. Токены, содержимое `secrets.bin`
  и `vault.key` присылать не нужно и не следует.

## Сроки

Первый ответ — в течение **72 часов**. В нём мы подтверждаем получение и говорим,
воспроизвели ли проблему. Дальше держим вас в курсе по ходу разбора и сообщаем,
когда исправление вышло в релиз.

## Что в скоупе

Сам лаунчер — код в этом репозитории и собранные из него сборки:

- обработка контента из внешних каталогов (Modrinth, CurseForge, модпаки,
  архивы, миры, ресурспаки) — всё, что распаковывается и исполняется;
- работа с путями: выход за пределы каталога данных при распаковке или импорте,
  подмена файлов игры, символические ссылки;
- хранение и передача учётных данных: локальное хранилище секретов, граница
  между ядром и вебвью, сессии Minecraft и Microsoft;
- механизм обновления: проверка подписи, запасной канал, подмена артефакта;
- запуск игры: формирование аргументов JVM, выбор Java, работа с сервером и
  `servers.dat`;
- интеграции ядра — deep link, трей, буфер обмена, открытие внешних ссылок и
  папок;
- конфигурация безопасности сборки: CSP, capabilities Tauri, права на файлы.

## Что вне скоупа

- Наши серверы и сервисы: `api.millida.net`, `millida.net`, CDN обновлений,
  сайты и панели. Их тестирование по этому адресу не согласовано; о проблемах в
  них пишите туда же, но отдельным сообщением и без активного сканирования.
- Уязвимости сторонних сервисов и каталогов (Modrinth, CurseForge, Microsoft,
  mc-heads.net) — сообщайте их владельцам.
- Социальная инженерия, фишинг, физический доступ к чужому устройству, атаки на
  сотрудников.
- Отчёты автоматических сканеров и линтеров без подтверждённой эксплуатации:
  список «уязвимых» зависимостей, оценки без работающего сценария, срабатывания
  антивирусов на неподписанный установщик.
- Сценарии, требующие, чтобы у атакующего уже были права администратора или
  доступ к учётной записи пользователя на его машине.
- Отсутствие защиты, которая не заявлена: например, лаунчер не рассчитан
  противостоять пользователю, который сам изменяет свои файлы игры.

## Поддерживаемые сборки

Исправления выходят только в последнем релизе. Лаунчер обновляется сам, поэтому
перед отправкой отчёта проверьте, что проблема воспроизводится на актуальной
версии — номер виден в настройках лаунчера.

| Версия | Поддержка |
| --- | --- |
| последний релиз | да |
| всё, что старше | нет |

</details>
