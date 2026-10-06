# Как собрать Millida Launcher самому

<p align="center">
  <a href="https://github.com/millida/launcher/raw/main/.github/readme/build-guide.mp4"><img src=".github/readme/build-guide.gif" alt="Сборка лаунчера из исходников: клонирование, зависимости, сборка установщика" width="100%"></a>
  <br>
  <a href="https://github.com/millida/launcher/raw/main/.github/readme/build-guide.mp4"><b>Смотреть видео целиком (MP4, 75 с)</b></a>
</p>

Три команды. Первая сборка — 10–20 минут, смотря какой компьютер. Дальше — быстрее: Rust пересобирает только изменённое.

## 1. Поставь инструменты

<details open>
<summary><b>Windows 10/11</b></summary>

В PowerShell:

```powershell
winget install --id Git.Git -e
winget install --id Oven-sh.Bun -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

После установки закрой и открой PowerShell заново — иначе он не увидит `bun` и `cargo`.

WebView2 в Windows 11 уже есть. На Windows 10 — [скачать у Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
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

Другие дистрибутивы — названия пакетов в [документации Tauri](https://tauri.app/start/prerequisites/#linux).
</details>

## 2. Собери

```bash
git clone https://github.com/millida/launcher.git
cd launcher
bun install
bun run tauri build
```

Хочешь собрать ровно ту версию, что вышла на сайте, — переключись на её тег перед сборкой:

```bash
git checkout v2.0.177
```

Список версий — на странице [релизов](https://github.com/millida/launcher/releases).

## 3. Забери результат

| Система | Где лежит |
| --- | --- |
| Windows | `src-tauri\target\release\bundle\nsis\Millida Launcher_<версия>_x64-setup.exe` |
| macOS | `src-tauri/target/release/bundle/dmg/` и `bundle/macos/Millida Launcher.app` |
| Linux | `src-tauri/target/release/bundle/` — `deb/`, `rpm/`, `appimage/` |

Запустить без установки, прямо из исходников: `bun run tauri dev`.

## Чем твоя сборка отличается от нашей

| | Твоя сборка | С millida.net |
| --- | --- | --- |
| Код | Тот же, что в этом репозитории | Тот же: каждый релиз здесь — коммит, из которого собран установщик |
| Цифровая подпись | Нет — Windows покажет «Неизвестный издатель» | Есть. Ключ подписи не публикует ни один разработчик: с ним любой выпустил бы вирус от нашего имени |
| Версия | `2.0.0` | Номер сборки, например `2.0.177` |
| Обновления | При первом запуске лаунчер сам обновится до официальной версии | Ставятся сами |

Остаться на своей сборке — перед `bun run tauri build` поменяй `"version": "2.0.0"` на `"version": "99.0.0"` в [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json). Номер выше нашего — обновление сборку не тронет.

Обновление проверяется подписью из [`tauri.conf.json`](src-tauri/tauri.conf.json) (`plugins.updater.pubkey`): подменённый файл лаунчер не установит.

## Как проверить официальный установщик

- Скачивай только с [millida.net/launcher](https://millida.net/launcher) или со страницы [релизов](https://github.com/millida/launcher/releases). Всё остальное — не наше.
- Windows: правый клик по файлу → «Свойства» → «Цифровые подписи» → «Подпись действительна».
- Отчёт VirusTotal по каждому установщику — [millida.net/launcher/antivirus](https://millida.net/launcher/antivirus).

## Если не собирается

| Ошибка | Что сделать |
| --- | --- |
| `linker 'link.exe' not found` | Не стоит Build Tools с C++ — команда из шага 1 для Windows |
| `bun` или `cargo` «не является командой» | Перезапусти терминал после установки |
| `webkit2gtk-4.1 not found` | Не поставлены пакеты из шага 1 для Linux |
| AppImage падает на `linuxdeploy` | Собери без него: `bun run tauri build --bundles deb` |
| Что-то другое | [Заведи issue](https://github.com/millida/launcher/issues/new/choose) и приложи вывод команды |

Хочешь прислать правку — [CONTRIBUTING.md](CONTRIBUTING.md). Форк под своим именем — [TRADEMARK.md](TRADEMARK.md).
