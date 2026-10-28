# Where the launcher comes from and how to verify it

Russian version: [SAFETY.ru.md](SAFETY.ru.md)

## In short

```
code in this repository ──► GitHub Actions ──► Releases ──► installer and auto-update
```

1. The code you see here is all of the launcher's code. The Millida in-game mod (skins and cosmetics) is built
   separately and is not part of this repository. How the launcher verifies it is in the table below.
2. It is built not by a person but by a GitHub robot ([release.yml](.github/workflows/release.yml)) on GitHub's machines.
3. The finished files are in [Releases](https://github.com/millida/launcher/releases). Each one has a
   [GitHub attestation](https://github.com/millida/launcher/attestations) showing which commit and which workflow produced it.
   Tampering is visible: a swapped file will have no attestation.
4. The launcher learns the latest version from our server (`launcher-storage.millida.net`) and downloads the file itself from
   GitHub Releases; if GitHub is unreachable, it takes the same copy from our server. Before installing, the file is checked
   against the Millida signature (the public half of the key is in [tauri.conf.json](src-tauri/tauri.conf.json)): without the
   private half, a foreign file will not install, wherever it came from. The signature is a separate file and does not change
   the program's bytes.

## Verify it yourself in a minute

**The main check is the GitHub attestation** (needs the [GitHub CLI](https://cli.github.com)): it proves that GitHub built
the file from this repository.

```bash
gh attestation verify Millida-Launcher_X.Y.Z_x64-setup.exe -R millida/launcher
```

**Without any tools:** compare the file from the website with the one on GitHub. Compute the fingerprint:

| System | Command |
| --- | --- |
| Windows (PowerShell) | `Get-FileHash .\Millida-Launcher_X.Y.Z_x64-setup.exe` |
| macOS | `shasum -a 256 Millida-Launcher_X.Y.Z_aarch64.dmg` |
| Linux | `sha256sum Millida-Launcher_X.Y.Z_amd64.AppImage` |

The fingerprint must match the line in the `SHA256SUMS` file of the same release. You can also paste the same fingerprint into the search on
[virustotal.com](https://www.virustotal.com) to see the scan by dozens of antivirus engines.

**Build it yourself:** three commands in [BUILDING.md](BUILDING.md).

## What the launcher downloads and from where

Everything is visible in the code. Intercept the traffic and compare it with this table.

| What | From where | How it is checked |
| --- | --- | --- |
| The launcher itself and its updates | [Releases](https://github.com/millida/launcher/releases) of this repository; our `launcher-storage.millida.net` is a backup copy of the same bytes | update signature ([selfupdate.rs](src-tauri/src/engine/core/selfupdate.rs)) |
| Minecraft, Java, Fabric/Forge/NeoForge/Quilt | the official sites of Mojang, Adoptium/Azul and the loaders | hashes from their own lists |
| Mods and modpacks | Modrinth, CurseForge, the Millida catalog | hash of every file |
| The Millida mod (skins and cosmetics in game) | `cdn.millida.net/mod` | sha256 of every jar from the version list; if the list is signed, the signature as well ([millida_mod.rs](src-tauri/src/engine/content/millida_mod.rs)) |
| The authlib-injector skin agent | the project's site and its GitHub | sha256 |

Modrinth, CurseForge and some Mojang sites do not open for everyone in Russia. In that case the same file goes through
our proxy server (the list of addresses is in [mirror.rs](src-tauri/src/engine/core/mirror.rs)); where a site
is reachable, the launcher connects directly.

## Your account cannot be stolen, and here is why

| The fear | How it really works | Where to check |
| --- | --- | --- |
| The launcher will see your password | You enter the password on the Microsoft site using a code; the launcher never receives it | [microsoft.rs](src-tauri/src/engine/accounts/microsoft.rs), `devicecode` |
| The token will go to Millida | The Microsoft token goes only to Microsoft and Mojang servers and is handed to the game itself at launch, as in any launcher. Never to Millida servers. | [microsoft.rs](src-tauri/src/engine/accounts/microsoft.rs), [accounts.rs](src-tauri/src/commands/accounts.rs) |
| A site inside the launcher will grab the token | The interface never sees the token: the core strips it from the response | [session.rs](src-tauri/src/engine/accounts/session.rs), `keep_tokens` |
| The launcher will rummage through files or run anything | The interface has no access to the disk or the command line, only to the core's commands | [capabilities/default.json](src-tauri/capabilities/default.json) |
| A fake update is slipped in | An update without our signature will not install | [selfupdate.rs](src-tauri/src/engine/core/selfupdate.rs), the key is in [tauri.conf.json](src-tauri/tauri.conf.json) |

Tokens are stored only on your computer, in an encrypted file ([secrets.rs](src-tauri/src/secrets.rs)).
The encryption prevents carrying the file to another PC. No launcher can protect you from a virus that already sits on your computer.

Statistics (version, hardware, crashes, clicks; tied to your account if you are signed in): what is sent and why is in [TELEMETRY.md](TELEMETRY.md). It can be turned off in "Settings → Account → Usage statistics".

## Honestly, about what is not here

- **Development** happens in an internal repository: it holds tasks, drafts and publishing keys. Every release
  arrives here in full, and it is built here, not there. The `Release X.Y.Z` commit contains all the code of that version and a changelog.
- **Update signing** is done with our key after the build. The signature does not change the file: the bytes are the ones GitHub built,
  and the fingerprint matches `SHA256SUMS`.
- **The "Download" button on the website** serves not a build from Releases but an installer. What those files are is described below, and
  their checksums are in [installer/site-files.json](installer/site-files.json).

  | System | File behind the button | Where it was built | Who signed it |
  | --- | --- | --- | --- |
  | Windows | `MillidaLauncherSetup.exe`, 1.9 MB, in the [setup-signed-1](https://github.com/millida/launcher/releases/tag/setup-signed-1) release. It does not contain the launcher: it downloads the installer of the current version, the same bytes as in the release here | outside GitHub, 2026-09-03 | GlobalSign EV certificate, sole proprietor Veselov Nikita Nikolaevich |
  | macOS | `Millida-Launcher-aarch64.dmg`, `Millida-Launcher-x64.dmg`. After that the launcher updates from builds in Releases | outside GitHub, 2026-09-10 | Developer ID: Mark Sheremeta (G6P84BXZCC), notarized by Apple |
  | Linux | `.deb`, `.rpm`, AppImage | here; these are the release files | not signed; checked against `SHA256SUMS` and the attestation |

  Why the Windows installer and the macOS image were not built here: GitHub builds for them are not signed (the Windows signature
  lives on a hardware key, and the Apple signature is not yet set up in the build), and Windows and macOS discourage running
  an unsigned file, and some antivirus engines flag it for no reason. What we are doing about it: the Windows installer is already
  built here, as `setup-v*` releases with an attestation; the website button will switch to it once that build gets
  a signature. It takes everything from GitHub: the version list (`latest.json`, attached to every launcher release by a run of
  [Manifest](https://github.com/millida/launcher/actions/workflows/manifest.yml) after checking against `SHA256SUMS`), the
  launcher installer itself and its checksum; Millida storage is a backup mirror with the same bytes. It has no Windows signature yet,
  so on first launch Windows shows an "Unknown publisher" window. How this works and what we are doing about it is in
  [CODE_SIGNING.md](CODE_SIGNING.md).
- **Verification without us.** [Verify downloads](https://github.com/millida/launcher/actions/workflows/verify.yml) runs four times
  a day, downloads everything that is served (the update files and the installers behind the button) and compares: the former with the `SHA256SUMS`
  of the release, the latter with the list above. A mismatch turns the run red. You can run the same thing yourself:
  `node scripts/verify-downloads.mjs`.
- **The mobile launcher** is a separate open repository, [millida/launcher-mobile](https://github.com/millida/launcher-mobile): every version arrives there as a commit with the version number.

Found a security hole? See [SECURITY.md](SECURITY.md).
