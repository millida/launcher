<p align="center">
  <img src=".github/readme/banner.png" alt="Millida Launcher — лаунчер Minecraft с модами, скинами и друзьями">
</p>

<p align="center">
  <a href="https://millida.net/launcher/dl/windows"><img src=".github/readme/dl-windows.png" width="32%" alt="Скачать для Windows"></a>
  <a href="https://millida.net/launcher/dl/macos"><img src=".github/readme/dl-macos.png" width="32%" alt="Скачать для macOS"></a>
  <a href="https://millida.net/launcher/dl/linux"><img src=".github/readme/dl-linux.png" width="32%" alt="Скачать для Linux"></a>
</p>

<p align="center">
  <a href="https://github.com/millida/launcher/releases/latest"><img src="https://img.shields.io/github/v/release/millida/launcher?label=%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%8F&color=9B6BFF" alt="Последняя версия"></a>
  <a href="https://millida.net/launcher/antivirus"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Flauncher-storage.millida.net%2Fsetup%2Fscan.json&query=%24.files%5B0%5D.malicious&label=VirusTotal&suffix=%20%D1%83%D0%B3%D1%80%D0%BE%D0%B7&color=2ea043" alt="Проверка VirusTotal"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/%D0%BB%D0%B8%D1%86%D0%B5%D0%BD%D0%B7%D0%B8%D1%8F-GPL--3.0-555" alt="Лицензия GPL-3.0"></a>
</p>

<p align="center">
  <a href="https://millida.net/launcher/antivirus"><img src=".github/readme/trust-virus.png" width="49%" alt="Без вирусов: каждый установщик проверен VirusTotal"></a>
  <img src=".github/readme/trust-account.png" width="49%" alt="Аккаунт в безопасности: пароль вводится только на сайте Microsoft">
  <img src=".github/readme/trust-signed.png" width="49%" alt="Есть цифровая подпись: EV-сертификат GlobalSign">
  <a href="ARCHITECTURE.md"><img src=".github/readme/trust-open.png" width="49%" alt="Код открыт: любую строку можно проверить здесь"></a>
</p>

<p align="center">
  <img src="screenshots/lobby.png" alt="Лобби лаунчера">
</p>

| Сборки | Каталог |
| :---: | :---: |
| <img src="screenshots/library.png" alt="Мои сборки"> | <img src="screenshots/catalog.png" alt="Каталог модов и сборок Modrinth и CurseForge"> |
| **Гардероб** | **Свой сервер** |
| <img src="screenshots/wardrobe.png" alt="Скины, плащи и косметика"> | <img src="screenshots/server.png" alt="Панель своего сервера"> |

## Установка

<details>
<summary><b>Windows</b> — установщик <code>.exe</code></summary>

1. Скачай и запусти установщик — лаунчер откроется сам.
2. Если появилось синее окно «Windows защитила ваш компьютер»: **«Подробнее»** → **«Выполнить в любом случае»**.

Обновления лаунчер ставит сам.
</details>

<details>
<summary><b>macOS</b> — образ <code>.dmg</code> или одна команда</summary>

Перетащи **Millida Launcher** в «Программы». Пишет «повреждено» — выполни в Терминале:

```bash
chmod -R u+w "/Applications/Millida Launcher.app" && xattr -cr "/Applications/Millida Launcher.app"
```

Или поставь одной командой, без этого шага:

```bash
curl -fsSL https://launcher-storage.millida.net/setup/install.sh | sh
```
</details>

<details>
<summary><b>Linux</b> — Flatpak или одна команда</summary>

```bash
flatpak install --user https://launcher-flatpak.millida.net/millida-launcher.flatpakref
```

Без Flatpak (AppImage с ярлыком в меню):

```bash
curl -fsSL https://launcher-storage.millida.net/setup/install.sh | sh
```

`.deb` и `.rpm` — на [странице загрузки](https://millida.net/launcher#download).
</details>

## Вопросы

<details>
<summary><b>Это бесплатно?</b></summary>

Да. Без рекламы и постороннего софта в установщике.
</details>

<details>
<summary><b>Нужен купленный Minecraft?</b></summary>

Нет: можно играть по нику. С лицензией — вход через официальное окно Microsoft, пароль лаунчер не видит.
</details>

<details>
<summary><b>Java ставить нужно?</b></summary>

Нет, лаунчер скачает подходящую сам.
</details>

<details>
<summary><b>Антивирус ругается</b></summary>

Отчёт VirusTotal по каждому установщику — на [millida.net/launcher/antivirus](https://millida.net/launcher/antivirus). Качай только с millida.net или со страницы [релизов](https://github.com/millida/launcher/releases) — всё остальное не наше.
</details>

<details>
<summary><b>Что-то не работает</b></summary>

Напиши в [Discord](https://discord.gg/mcru) или заведи issue. К отчёту приложи `logs/launcher-latest.log` из папки сборки.
</details>

<details>
<summary><b>Как удалить?</b></summary>

Windows — «Параметры» → «Приложения»; macOS — в корзину; Flatpak — `flatpak uninstall net.millida.launcher`.
</details>

## Разработчикам

Rust-ядро (Tauri 2) и интерфейс на React, лицензия [GPL-3.0-only](LICENSE).

[Устройство](ARCHITECTURE.md) · [Как прислать правку](CONTRIBUTING.md) · [Уязвимости](SECURITY.md) · [Название и логотип](TRADEMARK.md)

<details>
<summary><b>Зачем открыт код</b></summary>

Лаунчер держит вход в аккаунт Microsoft, файлы игры и сетевые запросы — честный ответ на вопрос «что он делает с моим аккаунтом» — дать прочитать код целиком. С января по июнь 2026 года поддельные клиенты Minecraft [заразили больше ста тысяч машин](https://thehackernews.com/2026/08/weedhack-malware-spreads-via-fake.html) и крали именно токен входа Microsoft.

- Официальные сборки — только с [millida.net/launcher](https://millida.net/launcher) и из [релизов](https://github.com/millida/launcher/releases) этого репозитория.
- Сторонние сборки мы не поддерживаем. Собрать код для себя это не мешает.
- Правки принимаем сюда — так они достаются всем игрокам сразу.
- GPL-3.0 даёт право на форк, но бренд, ключи и наши сервисы под неё не подпадают — см. [TRADEMARK.md](TRADEMARK.md).

Форку нужны своё имя, свои иконки и своя регистрация приложения в Azure (`MILLIDA_MS_CLIENT_ID`). Установка игры, загрузчики, Java и Modrinth работают без наших серверов; вход Millida, друзья, скины, рейтинг, панель хостинга и прокси к CurseForge ходят в `api.millida.net`.
</details>

<sub>Millida Launcher не связан с Mojang AB и Microsoft. Minecraft — товарный знак Mojang AB.</sub>
