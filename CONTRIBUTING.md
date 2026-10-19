# How to contribute

Russian version: [CONTRIBUTING.ru.md](CONTRIBUTING.ru.md)

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
