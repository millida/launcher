# Сборка Aera Launcher

[English version: BUILDING.md](BUILDING.md)

> **Только для разработки и тестирования.** В этом ребрендинге сохранены существующие подключения аккаунтов, API, CDN, каталога и обновлений Millida. Сервер обновлений и ключ подписи по-прежнему принадлежат upstream-проекту: собранная версия может обращаться к этим сервисам и обновиться до upstream-сборки. Не распространяйте пакет и не используйте его как публичный релиз Aera, пока сервисы, подпись, идентификаторы и защищённые товарные знаки не будут мигрированы с разрешения владельцев. Подробности — в [README.md](README.md) и [TRADEMARK.md](TRADEMARK.ru.md).

## 1. Установите инструменты

<details open>
<summary><b>Windows 10/11</b></summary>

В PowerShell:

```powershell
winget install --id Git.Git -e
winget install --id Oven-sh.Bun -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

После установки закройте и заново откройте PowerShell — иначе он не увидит `bun` и `cargo`.
</details>

<details>
<summary><b>macOS</b></summary>

```bash
xcode-select --install
curl -fsSL https://bun.sh/install | bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```
</details>

<details>
<summary><b>Linux (Debian, Ubuntu, Mint)</b></summary>

```bash
sudo apt-get install -y git curl libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libxdo-dev libssl-dev build-essential file wget
curl -fsSL https://bun.sh/install | bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Для других дистрибутивов смотрите названия пакетов в [требованиях Tauri](https://tauri.app/start/prerequisites/#linux).
</details>

## 2. Соберите и запустите в режиме разработки

```bash
git clone https://github.com/deadlyghost90/aeralauncher.git
cd aeralauncher
bun install
bun run typecheck
bun run build:web
bun run tauri dev
```

В режиме разработки приложение всё ещё может обращаться к подключённым сервисам Millida при входе или открытии связанных разделов. Владелец сервиса может блокировать такие запросы или не предоставлять их. Не используйте чужие учётные данные и не выдавайте интеграции за инфраструктуру Aera.

## 3. Пакет приложения (не для публичного распространения)

Команда `bun run tauri build` создаёт локальный неподписанный пакет для тестирования. Не устанавливайте и не запускайте такой пакет как обычный релиз Aera: конфигурация обновлений всё ещё подключена к upstream-серверу и его ключу подписи. Для безопасного публичного релиза нужны собственный разрешённый сервер обновлений и ключ, согласованная миграция идентификатора/данных приложения, регистрации сервисов и проверка сторонних товарных знаков и графики.

## Если сборка не получается

| Ошибка | Что проверить |
| --- | --- |
| `linker 'link.exe' not found` | Установлен ли workload C++ для Visual Studio Build Tools. |
| `bun` или `cargo` не является командой | Перезапустите терминал после установки инструментов. |
| `webkit2gtk-4.1 not found` | Установлены ли пакеты Linux из списка выше. |
| Другая ошибка | Создайте issue в [репозитории Aera Launcher](https://github.com/deadlyghost90/aeralauncher/issues) и приложите вывод команды. |

О вкладе и лицензиях — [CONTRIBUTING.md](CONTRIBUTING.ru.md), [LICENSE](LICENSE), [NOTICE](NOTICE), [TRADEMARK.ru.md](TRADEMARK.ru.md).
