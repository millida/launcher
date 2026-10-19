# How to build Millida Launcher yourself

Russian version: [BUILDING.ru.md](BUILDING.ru.md)

Three commands. The first build takes 10–20 minutes, depending on your computer. Later builds are faster: Rust rebuilds only what changed.

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

After the install, close PowerShell and open it again. Otherwise it will not see `bun` and `cargo`.

Windows 11 already has WebView2. On Windows 10, [download it from Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/).
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

For other distributions, see the package names in the [Tauri docs](https://tauri.app/start/prerequisites/#linux).
</details>

## 2. Build

```bash
git clone https://github.com/millida/launcher.git
cd launcher
bun install
bun run tauri build
```

To build exactly the version that was released on the site, switch to its tag before you build:

```bash
git checkout v2.0.177
```

The list of versions is on the [releases](https://github.com/millida/launcher/releases) page.

## 3. Get the result

| System | Where it is |
| --- | --- |
| Windows | `src-tauri\target\release\bundle\nsis\Millida Launcher_<version>_x64-setup.exe` |
| macOS | `src-tauri/target/release/bundle/dmg/` and `bundle/macos/Millida Launcher.app` |
| Linux | `src-tauri/target/release/bundle/`: `deb/`, `rpm/`, `appimage/` |

To run it straight from the source without installing: `bun run tauri dev`.

## How your build differs from ours

| | Your build | From millida.net |
| --- | --- | --- |
| Code | The same as in this repository | The same. Every release here is the commit the installer was built from |
| Digital signature | None. Windows shows "Unknown publisher" | Yes. No developer publishes the signing key: with it, anyone could release a virus in our name |
| Version | `2.0.0` | The build number, for example `2.0.177` |
| Updates | On first start the launcher updates itself to the official version | Installed automatically |

To stay on your own build, change `"version": "2.0.0"` to `"version": "99.0.0"` in [`src-tauri/tauri.conf.json`](src-tauri/tauri.conf.json) before `bun run tauri build`. With a number higher than ours, the update will not touch your build.

Updates are checked with the signature key from [`tauri.conf.json`](src-tauri/tauri.conf.json) (`plugins.updater.pubkey`). The launcher will not install a swapped file.

## How to check the official installer

- Download only from [millida.net/launcher](https://millida.net/launcher) or from the [releases](https://github.com/millida/launcher/releases) page. Anything else is not ours.
- Windows: right-click the file, then "Properties", then "Digital Signatures", then "This digital signature is OK".
- To check that a release file was built here, from this code: the [Release workflow](.github/workflows/release.yml) builds every installer on GitHub servers, and GitHub signs which commit it came from. Check with `gh attestation verify <file> -R millida/launcher`. Or download `provenance.sigstore.json` from the release and add `--bundle provenance.sigstore.json`.
- The VirusTotal report for every installer is at [millida.net/launcher/antivirus](https://millida.net/launcher/antivirus).

## If the build fails

| Error | What to do |
| --- | --- |
| `linker 'link.exe' not found` | The C++ Build Tools are missing. Use the Windows command from step 1 |
| `bun` or `cargo` "is not recognized as a command" | Restart the terminal after the install |
| `webkit2gtk-4.1 not found` | The Linux packages from step 1 are not installed |
| AppImage fails on `linuxdeploy` | Build without it: `bun run tauri build --bundles deb` |
| Something else | [Open an issue](https://github.com/millida/launcher/issues/new/choose) and attach the command output |

Want to send a fix? See [CONTRIBUTING.md](CONTRIBUTING.md). Want a fork under your own name? See [TRADEMARK.md](TRADEMARK.md).
