# How to contribute

Millida Launcher is a desktop Minecraft launcher built with Tauri 2 (Rust) and React 19.
The core (`src-tauri`) installs and starts the game and works with files and
secrets. The frontend (`src`) is the view on top of the core's IPC commands.

Thank you for wanting to help. Below is everything you need to set up the project,
make your change look like the rest of the code, and write a pull request that
can be reviewed quickly.

## What to install

- [Bun](https://bun.sh) is the package manager and test runner of the project. `npm`, `yarn`
  and `pnpm` are not used: the repository has a `bun.lock`.
- [Rust](https://rustup.rs) from the stable channel with the `clippy` component. CI uses
  the current stable, so there is no pinned version.
- Tauri 2 system dependencies, by platform:

**Windows**

- Visual Studio Build Tools with the "Desktop development with C++" workload
  (you need the MSVC linker).
- WebView2 Runtime. Windows 11 already has it. On Windows 10 you install it separately.

**macOS**

- Xcode Command Line Tools: `xcode-select --install`.

**Linux (Debian/Ubuntu)**

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libxdo-dev \
  libssl-dev \
  build-essential \
  file \
  wget
```

This is the same list that CI installs ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
Other distributions use other package names. See the
[Tauri docs](https://tauri.app/start/prerequisites/).

## Run the project

```bash
bun install
bun run tauri dev
```

The first Rust build takes a few minutes. After that, only the changed
crates are rebuilt.

If your change touches only layout and screen logic, it is faster to run the frontend
on its own:

```bash
bun run dev      # http://127.0.0.1:5173, without the core
```

In a browser without Tauri, the sections that need the core show "Available in the app"
placeholders, and requests to `api.millida.net` fail on CORS. In the
app they go through the Rust command `millida_api`. To check anything that
touches installation, starting the game, paths or secrets, you need `bun run tauri dev`.

Signing in with a Microsoft license needs your own Azure app: the `client_id` is built in
at compile time from the `MILLIDA_MS_CLIENT_ID` variable. Without it, the launcher
builds and works, and the sign-in button says plainly that sign-in is not set up.

## What to run before a pull request

```bash
bun run typecheck                                  # tsc -b, strict
bun test                                           # frontend tests

cd src-tauri
cargo clippy --all-targets -- -D warnings          # required
cargo test
```

`-D warnings` is not a wish: CI runs
`cargo clippy --all-targets --all-features -- -D warnings`, and any warning
fails the check. The project has no formatter (no Prettier and no mandatory
`cargo fmt`). Clippy is what keeps the code quality, so a change
with warnings cannot be merged.

It also helps to run `bun run build:web`. CI builds the web part and checks it with
a gate, so a build error will show up anyway.

## Code style

There is no single formatter config, so the reference is the neighboring code. What it
actually does:

**TypeScript and React (`src/`)**

- Indent with 2 spaces, no semicolons at the end of lines, single quotes for
  strings.
- Lines stay around 100 characters. Half of the lines are shorter than 30. Lines longer than 100
  are rare and are usually a long literal or a JSX attribute.
- `camelCase` for variables and functions, `PascalCase` for components and types,
  `UPPER_SNAKE_CASE` for module constants. Files are `camelCase.ts`. Components and
  screens are `PascalCase.tsx`.
- TypeScript runs in `strict` mode, plus `noUnusedLocals`, `noUnusedParameters` and
  `verbatimModuleSyntax`. A type import is written as `import type { … }`.
- State is one zustand store per module (`src/state/*.ts`). The IPC wrappers live in
  `src/ipc/commands.ts`. Pure helpers are in `src/lib/`.
- CSS is plain files in `src/styles/`. Do not change the import order `01…04`:
  the cascade depends on it.

**Rust (`src-tauri/`)**

- Standard rustfmt style: 4-space indent, line width around 100.
  Running `cargo fmt` is not required, but the code must look as if it was run.
- `snake_case` for functions and modules, `CamelCase` for types,
  `SCREAMING_SNAKE_CASE` for constants.
- The engine is split into submodules (`engine/core`, `engine/game`, `engine/content`,
  `engine/skins`, `engine/profiles`). IPC commands are in `commands/`. Put a new function
  next to related ones, not in a general module.
- Unit tests live in `#[cfg(test)] mod tests` **at the end of the file**. Clippy with
  `-D warnings` complains about `items_after_test_module` if more code
  appears after the test module.

**Comments**

The code should read on its own: clear names, small functions, explicit types instead of
explanations. Leave a comment where it explains a non-obvious "why", and does not
retell the "what". Examples: a workaround for a platform bug, a requirement of the Minecraft protocol or
an external API, the reason for a non-intuitive order of steps. For example, why the vault
does not use the Keychain, why `reqwest` is built on rustls, why CSS files
are included in this exact order. Such things cannot be recovered without a note.

Write these comments in English, so that everyone who looks into the repository
can read the code equally. The interface may be in any language. This rule is only about
comments in code.

## Commits

Two forms exist in the history, and both are fine:

- Conventional Commits with a scope: `feat(profiles): …`, `fix(java): …`,
  `ci: …`, `docs: …`, `chore: …`, `security: …`.
- A plain sentence that describes the result for the user, for example "Avatars: the core
  brings the head with a disk cache", "The update does not fall back to the backup channel".

Write the title in English (Russian titles also appear in the history), on one line, with no period
at the end, in the spirit of "what it is now", not "what I touched".

Add a commit body where the change is not clear from the title. The usual format:
a paragraph about why it was like this and what broke, then a list of changes, then
a line about checking, for example `typecheck, bun test (8), clippy -D warnings,
cargo test (64) all green`.

One commit is one change. Keep README and docs changes separate from code: a push
that touches only documentation does not start a release build.

## Pull request

Work from `main`. In the PR description, write:

- **What and why**: which problem the change solves. If there is an issue, link to
  it.
- **How you checked**: which commands you ran and what you did by hand: on which OS,
  with which Minecraft version and loader, which scenario you reproduced.
- **A screenshot or a short recording**: required for anything that changes the interface.
  If the change touches a theme, attach both versions: light and dark.

Say separately if the change alters user data format: keys in
`localStorage`, `profiles.json`, the layout of game files. Such things break
installed launchers, so they need a migration and a clear note in the description.

## Where to write

- **A bug**: an issue with the
  ["Bug report"](.github/ISSUE_TEMPLATE/bug_report.yml) template.
- **An idea or a wish**: an issue with the
  ["Suggestion"](.github/ISSUE_TEMPLATE/feature_request.yml) template. Describe the task and
  how you work around it now. We will find the solution together.
- **A vulnerability**: not in an issue. The procedure is in [SECURITY.md](SECURITY.md).

In communication we follow the [code of conduct](CODE_OF_CONDUCT.md).

---

<details>
<summary><b>Русская версия</b></summary>

# Как участвовать в разработке

Millida Launcher — десктопный лаунчер Minecraft на Tauri 2 (Rust) и React 19.
Ядро (`src-tauri`) отвечает за установку, запуск игры, работу с файлами и
секретами; фронтенд (`src`) — вид поверх IPC-команд ядра.

Спасибо, что хотите помочь. Ниже — всё, что нужно, чтобы поднять проект, привести
правку в тот же вид, что и остальной код, и оформить pull request так, чтобы его
можно было быстро проверить.

## Что нужно установить

- [Bun](https://bun.sh) — пакетный менеджер и тест-раннер проекта. `npm`, `yarn`
  и `pnpm` не используются: в репозитории лежит `bun.lock`.
- [Rust](https://rustup.rs) стабильного канала с компонентом `clippy`. CI берёт
  актуальный stable, поэтому специально закреплённой версии нет.
- Системные зависимости Tauri 2 — по платформам:

**Windows**

- Visual Studio Build Tools с рабочей нагрузкой «Разработка классических
  приложений на C++» (нужен линкер MSVC).
- WebView2 Runtime. В Windows 11 он уже есть; на Windows 10 ставится отдельно.

**macOS**

- Xcode Command Line Tools: `xcode-select --install`.

**Linux (Debian/Ubuntu)**

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  patchelf \
  libxdo-dev \
  libssl-dev \
  build-essential \
  file \
  wget
```

Это тот же список, который ставит CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)).
В других дистрибутивах пакеты называются иначе — сверяйтесь с
[документацией Tauri](https://tauri.app/start/prerequisites/).

## Поднять проект

```bash
bun install
bun run tauri dev
```

Первая сборка Rust занимает несколько минут, дальше пересборка идёт по изменённым
крейтам.

Если правка касается только вёрстки и логики экранов, быстрее гонять фронтенд
отдельно:

```bash
bun run dev      # http://127.0.0.1:5173, без ядра
```

В браузере без Tauri разделы, которым нужно ядро, показывают заглушки
«Доступно в приложении», а запросы к `api.millida.net` падают на CORS — в
приложении они идут через Rust-команду `millida_api`. Для проверки всего, что
трогает установку, запуск игры, пути или секреты, нужен `bun run tauri dev`.

Вход по лицензии Microsoft требует своего Azure-приложения: `client_id` вшивается
на этапе компиляции из переменной `MILLIDA_MS_CLIENT_ID`. Без неё лаунчер
собирается и работает, а кнопка входа честно сообщает, что вход не настроен.

## Что прогнать перед pull request

```bash
bun run typecheck                                  # tsc -b, strict
bun test                                           # тесты фронтенда

cd src-tauri
cargo clippy --all-targets -- -D warnings          # обязательно
cargo test
```

`-D warnings` — не пожелание: CI гоняет
`cargo clippy --all-targets --all-features -- -D warnings`, и любое предупреждение
роняет проверку. Форматтера в проекте нет (ни Prettier, ни обязательного
`cargo fmt`) — качество кода держит именно clippy, поэтому правку с
предупреждениями смержить не получится.

Полезно прогнать и `bun run build:web` — CI собирает витрину и проверяет её
гейтом, так что ошибка сборки всплывёт в любом случае.

## Стиль кода

Единого конфига форматтера нет, поэтому ориентир — соседний код. Что в нём есть
фактически:

**TypeScript и React (`src/`)**

- Отступ — 2 пробела, точки с запятой в конце строк не ставятся, строки в
  одинарных кавычках.
- Строки держатся примерно в 100 символов; половина строк короче 30, длиннее 100
  встречаются редко и обычно это длинный литерал или JSX-атрибут.
- `camelCase` для переменных и функций, `PascalCase` для компонентов и типов,
  `UPPER_SNAKE_CASE` для констант модуля. Файлы — `camelCase.ts`, компоненты и
  экраны — `PascalCase.tsx`.
- TypeScript в `strict`, плюс `noUnusedLocals`, `noUnusedParameters` и
  `verbatimModuleSyntax` — импорт типа пишется как `import type { … }`.
- Состояние — zustand-стор на модуль (`src/state/*.ts`), обёртки IPC живут в
  `src/ipc/commands.ts`, чистые помощники — в `src/lib/`.
- CSS — обычные файлы в `src/styles/`, порядок импорта `01…04` менять нельзя:
  на нём завязан каскад.

**Rust (`src-tauri/`)**

- Стандартное оформление rustfmt: отступ 4 пробела, ширина строки в районе 100.
  Прогонять `cargo fmt` необязательно, но код должен выглядеть так, будто его
  прогнали.
- `snake_case` для функций и модулей, `CamelCase` для типов,
  `SCREAMING_SNAKE_CASE` для констант.
- Движок разложен по подмодулям (`engine/core`, `engine/game`, `engine/content`,
  `engine/skins`, `engine/profiles`), IPC-команды — в `commands/`. Новую функцию
  кладите рядом с родственной, а не в общий модуль.
- Юнит-тесты живут в `#[cfg(test)] mod tests` **в конце файла**: clippy с
  `-D warnings` ругается на `items_after_test_module`, если после тест-модуля
  появляется ещё код.

**Комментарии**

Код должен читаться сам: понятные имена, небольшие функции, явные типы вместо
пояснений. Комментарий оставляем там, где он объясняет неочевидное «почему», а не
пересказывает «что»: обход бага платформы, требование протокола Minecraft или
внешнего API, причина неинтуитивного порядка действий. Например, почему vault
не использует Keychain, почему `reqwest` собран на rustls, почему CSS-файлы
подключаются именно в таком порядке — такие вещи без пометки восстановить
невозможно.

Пишем такие пояснения по-английски, чтобы код одинаково читался всеми, кто
заглянет в репозиторий. Интерфейс, документация и обсуждения — русскоязычные,
это касается только комментариев в коде.

## Коммиты

В истории сложились две формы, обе нормальные:

- Conventional Commits с областью — `feat(profiles): …`, `fix(java): …`,
  `ci: …`, `docs: …`, `chore: …`, `security: …`.
- Обычное предложение, описывающее результат для пользователя, — «Аватары: голову
  приносит ядро с кэшем на диске», «Обновление не срывается в запасной канал».

Заголовок пишем по-русски (английский тоже встречается), в одну строку, без точки
в конце, в духе «что стало», а не «что я потрогал».

Тело коммита нужно там, где правка не очевидна из заголовка. Сложившийся формат:
абзац о том, почему так было и что сломалось, затем список изменений, затем
строка о проверке — например `typecheck, bun test (8), clippy -D warnings,
cargo test (64) — зелёные`.

Один коммит — одно изменение. Правки README и доков отделяйте от кода: пуш,
который трогает только документацию, не будит релизную сборку.

## Pull request

Работаем от `main`. В описании PR нужно:

- **Что и зачем** — какую проблему решает правка. Если есть issue, сошлитесь на
  него.
- **Как проверяли** — какие команды прогнали и что делали руками: на какой ОС,
  с какой версией Minecraft и загрузчиком, какой сценарий воспроизводили.
- **Скриншот или короткая запись** — обязательно для всего, что меняет интерфейс.
  Если правка касается темы, приложите оба варианта — светлый и тёмный.

Отдельно отметьте, если правка меняет формат данных пользователя: ключи в
`localStorage`, `profiles.json`, раскладку файлов игры. Такие вещи ломают
установленные лаунчеры, поэтому нужны миграция и явное упоминание в описании.

## Куда писать

- **Баг** — issue по шаблону
  [«Ошибка»](.github/ISSUE_TEMPLATE/bug_report.yml).
- **Идея или пожелание** — issue по шаблону
  [«Предложение»](.github/ISSUE_TEMPLATE/feature_request.yml). Опишите задачу и
  то, как обходитесь сейчас; решение придумаем вместе.
- **Уязвимость** — не в issue. Порядок описан в [SECURITY.md](SECURITY.md).

В общении держимся [кодекса поведения](CODE_OF_CONDUCT.md).

</details>
