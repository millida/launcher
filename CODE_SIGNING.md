# Code signing policy

Как подписаны файлы Millida Launcher и кто за это отвечает.

## Что есть сейчас

- **Аттестация сборки.** Каждый файл релиза собран GitHub Actions в этом репозитории, и GitHub выдаёт на него
  аттестацию (Sigstore): из какого коммита и каким прогоном он собран. Проверка:
  `gh attestation verify <файл> -R millida/launcher`. Суммы всех файлов — в `SHA256SUMS` релиза.
- **Подпись обновлений.** Обновление лаунчера подписано ключом Millida (minisign), открытая часть ключа лежит в
  [tauri.conf.json](src-tauri/tauri.conf.json). Без этой подписи лаунчер обновление не поставит.
- **Подпись Windows (Authenticode).** Файлы релизов переходят на бесплатную подпись для открытых проектов:
  free code signing provided by [SignPath.io](https://signpath.io), certificate by
  [SignPath Foundation](https://signpath.org). До подключения файлы релизов не подписаны. Установщик на кнопке
  скачивания сайта подписан отдельно, EV-сертификатом.
- **Подпись macOS.** Сборка подписана без сертификата разработчика (ad-hoc). Скачанный образ macOS не откроет;
  установка командой из [README](README.md) работает, потому что файл приходит без метки карантина.

## Роли

- **Committers and reviewers** — участники организации [millida](https://github.com/orgs/millida/people):
  пишут код и проверяют чужие изменения. Изменения от посторонних принимаются только через pull request.
- **Approvers** — [l0l0l0l0l0l0l0l0l0l0l0l0](https://github.com/l0l0l0l0l0l0l0l0l0l0l0l0): подтверждает каждый запрос на подпись релиза.

Все участники входят в GitHub и SignPath с двухфакторной защитой. Политика на сайте: [millida.net/launcher/code-signing](https://millida.net/launcher/code-signing).

## Что подписывается

Только файлы, собранные автоматически из исходников этого репозитория сборочными сценариями из
[.github/workflows](.github/workflows). Чужие библиотеки и готовые чужие файлы нашей подписью не подписываются.

## Данные

Что лаунчер отправляет, зачем и как это выключить — [TELEMETRY.md](TELEMETRY.md).
Безопасность аккаунта и файлов — [SAFETY.md](SAFETY.md), сообщить об уязвимости — [SECURITY.md](SECURITY.md).
