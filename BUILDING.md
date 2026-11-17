# Build Aera Launcher

Russian version: [BUILDING.ru.md](BUILDING.ru.md)

> **Development/testing only.** This rebrand intentionally preserves the existing Millida account, API, CDN, catalog and updater integrations. The updater endpoint and signing key are still upstream-owned; a packaged release build may contact those services and can update itself to an upstream build. Do not distribute or use a packaged build as a public Aera release until those services, signing, identity, and trademark-sensitive assets are migrated with authorization. See [README.md](README.md) and [TRADEMARK.md](TRADEMARK.md).

## 1. Install the tools

<details open>
<summary><b>Windows 10/11</b></summary>

In PowerShell:

```powershell
winget install --id Git.Git -e
winget install --id Oven-sh.Bun -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

After installation, close PowerShell and open it again so it can find `bun` and `cargo`.
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

For other distributions, see the package names in the [Tauri prerequisites](https://tauri.app/start/prerequisites/#linux).
</details>

## 2. Build and run for development

```bash
git clone https://github.com/deadlyghost90/aeralauncher.git
cd aeralauncher
bun install
bun run typecheck
bun run build:web
bun run tauri dev
```

A development session can still contact the connected Millida services when you sign in or open service-backed features. Requests may be unavailable or blocked by the service owner. Do not use another person's credentials or represent the integration as Aera-owned.

## 3. Package output (not for public distribution)

`bun run tauri build` creates a local, unsigned package for testing. Do not install/run that packaged build as a normal Aera release: its retained updater configuration is still connected to the upstream feed and signing key. A safe public release needs an authorized Aera update feed and key, coordinated application identity/data migration, service registrations, and review of all third-party branding and assets.

## Troubleshooting

| Error | What to check |
| --- | --- |
| `linker 'link.exe' not found` | Install the C++ workload from Visual Studio Build Tools. |
| `bun` or `cargo` is not recognized | Restart the terminal after installing the toolchain. |
| `webkit2gtk-4.1 not found` | Install the Linux packages listed above. |
| Something else | Open an issue in the [Aera Launcher repository](https://github.com/deadlyghost90/aeralauncher/issues) and include the command output. |

For contribution and legal details, see [CONTRIBUTING.md](CONTRIBUTING.md), [LICENSE](LICENSE), [NOTICE](NOTICE), and [TRADEMARK.md](TRADEMARK.md).
