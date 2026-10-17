# Code signing policy

How Millida Launcher files are signed and who is responsible for it.

## What we have now

- **Build attestation.** GitHub Actions builds every release file in this repository. GitHub issues an
  attestation (Sigstore) for it: which commit and which run built it. Check it with
  `gh attestation verify <file> -R millida/launcher`. The sums of all files are in `SHA256SUMS` of the release.
- **Update signature.** Launcher updates are signed with a Millida key (minisign). The public part of the key is in
  [tauri.conf.json](src-tauri/tauri.conf.json). The launcher will not install an update without this signature.
- **Windows signature (Authenticode).** Release files are moving to the free signing for open source projects:
  free code signing provided by [SignPath.io](https://signpath.io), certificate by
  [SignPath Foundation](https://signpath.org). Until this is connected, the release files are not signed. The installer on the
  download button of the site is signed separately, with an EV certificate.
- **macOS signature.** The build is signed without a developer certificate (ad-hoc). macOS will not open a downloaded disk image.
  Installing with the command from the [README](README.md) works, because the file arrives without the quarantine flag.

## Roles

- **Committers and reviewers** are members of the [millida](https://github.com/orgs/millida/people) organization.
  They write code and review other people's changes. Changes from outsiders are accepted only through a pull request.
- **Approvers**: [l0l0l0l0l0l0l0l0l0l0l0l0](https://github.com/l0l0l0l0l0l0l0l0l0l0l0l0) approves every request to sign a release.

All members sign in to GitHub and SignPath with two-factor authentication. The policy on the site: [millida.net/launcher/code-signing](https://millida.net/launcher/code-signing).

## What is signed

Only files that are built automatically from the source of this repository by the build scripts in
[.github/workflows](.github/workflows). Third-party libraries and ready-made third-party files are not signed with our signature.

## Data

What the launcher sends, why, and how to turn it off: [TELEMETRY.md](TELEMETRY.md).
Account and file safety: [SAFETY.md](SAFETY.md). To report a vulnerability: [SECURITY.md](SECURITY.md).

---

<details>
<summary><b>Русская версия</b></summary>

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

</details>
