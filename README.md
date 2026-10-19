<p align="center">
  <img src=".github/readme/banner-en.png" alt="Millida Launcher: a Minecraft launcher with mods, skins and friends">
</p>

<p align="center">
  <a href="https://millida.net/launcher/dl/windows"><img src=".github/readme/download-windows-en.png" width="32%" alt="Download for Windows"></a>
  <a href="https://millida.net/launcher/dl/macos"><img src=".github/readme/download-macos-en.png" width="32%" alt="Download for macOS"></a>
  <a href="https://millida.net/launcher/dl/linux"><img src=".github/readme/download-linux-en.png" width="32%" alt="Download for Linux"></a>
</p>

<p align="center">
  <a href="https://github.com/millida/launcher/releases/latest"><img src="https://img.shields.io/github/v/release/millida/launcher?label=version&color=9B6BFF" alt="Latest version"></a>
  <a href="https://millida.net/launcher/antivirus"><img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Flauncher-storage.millida.net%2Fsetup%2Fscan.json&query=%24.files%5B0%5D.malicious&label=VirusTotal&suffix=%20threats&color=2ea043" alt="VirusTotal scan"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-555" alt="License GPL-3.0"></a>
</p>

<p align="center">
  <a href="https://millida.net/launcher/antivirus"><img src=".github/readme/trust-virus-en.png" width="49%" alt="No viruses: every installer is checked by VirusTotal"></a>
  <img src=".github/readme/trust-account-en.png" width="49%" alt="Your account is safe: you enter your password only on the Microsoft site">
  <img src=".github/readme/trust-signed-en.png" width="49%" alt="The installer from the site is signed with a GlobalSign EV certificate">
  <a href="ARCHITECTURE.md"><img src=".github/readme/trust-open-en.png" width="49%" alt="Open source: you can check any line right here"></a>
</p>

<p align="center">
  <img src="screenshots/lobby.png" alt="Launcher lobby">
</p>

| Instances | Catalog |
| :---: | :---: |
| <img src="screenshots/library.png" alt="My instances"> | <img src="screenshots/catalog.png" alt="Catalog of Modrinth and CurseForge mods and modpacks"> |
| **Wardrobe** | **Your own server** |
| <img src="screenshots/wardrobe.png" alt="Skins, capes and cosmetics"> | <img src="screenshots/server.png" alt="Control panel of your own server"> |

*English | Russian version: [README.ru.md](README.ru.md)*

## Install

<details>
<summary><b>Windows</b>: <code>.exe</code> installer</summary>

1. Download and run the [signed installer](https://github.com/millida/launcher/releases/download/setup-signed-1/MillidaLauncherSetup.exe). The launcher opens by itself.
2. If you see a blue window "Windows protected your PC": click **"More info"**, then **"Run anyway"**.

The launcher updates itself.
</details>

<details>
<summary><b>macOS</b>: <code>.dmg</code> image or one command</summary>

Drag **Millida Launcher** to "Applications". If macOS says the app is "damaged", run this in Terminal:

```bash
chmod -R u+w "/Applications/Millida Launcher.app" && xattr -cr "/Applications/Millida Launcher.app"
```

Or install with one command and skip that step:

```bash
curl -fsSL https://launcher-storage.millida.net/setup/install.sh | sh
```
</details>

<details>
<summary><b>Linux</b>: Flatpak or one command</summary>

```bash
flatpak install --user https://launcher-flatpak.millida.net/millida-launcher.flatpakref
```

Without Flatpak (AppImage with a menu shortcut):

```bash
curl -fsSL https://launcher-storage.millida.net/setup/install.sh | sh
```

`.deb` and `.rpm` files are on the [download page](https://millida.net/launcher#download).
</details>

## FAQ

<details>
<summary><b>Is it free?</b></summary>

Yes. There are no ads and no extra software in the installer.
</details>

<details>
<summary><b>Do I need a paid copy of Minecraft?</b></summary>

No. You can play with just a nickname. If you own the game, you sign in through the official Microsoft window. The launcher never sees your password.
</details>

<details>
<summary><b>Do I need to install Java?</b></summary>

No. The launcher downloads the right version itself.
</details>

<details>
<summary><b>My antivirus complains</b></summary>

The VirusTotal report for every installer is at [millida.net/launcher/antivirus](https://millida.net/launcher/antivirus). Download only from millida.net or from the [releases](https://github.com/millida/launcher/releases) page. Anything else is not ours.
</details>

<details>
<summary><b>Something does not work</b></summary>

Write in [Discord](https://discord.gg/mcru) or open an issue. Attach `logs/launcher-latest.log` from the instance folder to your report.
</details>

<details>
<summary><b>Why does the launcher have telemetry?</b></summary>

We want to learn about breakages before players write to support, and fix them faster. For example, on 13.10.2026 the crash events showed that some Fabric instances crash because of an old Fabric Loader. The same data shows which screens are slow and what people cannot find in the interface. When you sign in to a Millida account, the statistics are linked to it. Passwords, tokens, files and chat texts are never sent. You can turn it off in "Settings → Account → Usage statistics". The full list of what is sent and the code that sends it: [TELEMETRY.md](TELEMETRY.md).
</details>

<details>
<summary><b>How do I uninstall it?</b></summary>

Windows: "Settings" → "Apps". macOS: move it to the Trash. Flatpak: `flatpak uninstall net.millida.launcher`.
</details>

## For developers

Rust core (Tauri 2) and a React interface. License: [GPL-3.0-only](LICENSE).

[How to build it yourself](BUILDING.md) · [Architecture](ARCHITECTURE.md) · [How to send a fix](CONTRIBUTING.md) · [Vulnerabilities](SECURITY.md) · [Name and logo](TRADEMARK.md)

<details>
<summary><b>Why the code is open</b></summary>

The launcher handles your Microsoft sign-in, the game files and network requests. The honest answer to "what does it do with my account" is to let you read all of the code. From January to June 2026, fake Minecraft clients [infected more than a hundred thousand machines](https://thehackernews.com/2026/08/weedhack-malware-spreads-via-fake.html) and stole exactly the Microsoft sign-in token.

- Official builds come only from [millida.net/launcher](https://millida.net/launcher) and from the [releases](https://github.com/millida/launcher/releases) of this repository.
- We do not support third-party builds. You can still build the code for yourself.
- We accept fixes here, so every player gets them at once.
- GPL-3.0 gives you the right to fork. The brand, the keys and our services are not covered by it. See [TRADEMARK.md](TRADEMARK.md).

A fork needs its own name, its own icons and its own app registration in Azure (`MILLIDA_MS_CLIENT_ID`). Game installation, loaders, Java and Modrinth work without our servers. Millida sign-in, friends, skins, the rating, the hosting panel and the CurseForge proxy use `api.millida.net`.
</details>

## Copyright / DMCA

Copyright and DMCA takedown notices: [dmca@millida.net](mailto:dmca@millida.net). What a notice must contain: [DMCA.md](DMCA.md).

<sub>Millida Launcher is not affiliated with Mojang AB or Microsoft. Minecraft is a trademark of Mojang AB.</sub>
