# Security

Russian version: [SECURITY.ru.md](SECURITY.ru.md)

Thank you for taking the time to report a problem. The launcher starts the game, uses the
network, unpacks archives from external catalogs and stores the user's tokens.
A bug in any of these places can cost a person their account or files, so
we handle such reports first.

## Where to report

**security@millida.net**

Please do not open a public issue. Do not describe the vulnerability in a pull
request, discussions or chats until it is fixed. A public description before
the update is out gives a ready attack scenario against users who have an
old build. Give us time to fix it and ship a release. After that we
do not mind a publication, and we will credit you if you want that.

Copyright and DMCA notices are not security reports. Send them to [dmca@millida.net](mailto:dmca@millida.net); see [DMCA.md](DMCA.md).

What helps us understand faster:

- the launcher version and the operating system;
- steps to reproduce, or a minimal proof of concept;
- the practical impact: what exactly the attacker gets;
- logs or files, if they are needed to understand the problem. Please do not send tokens or the contents of `secrets.bin`
  and `vault.key`.

## Timing

We give the first answer within **72 hours**. In it we confirm that we got your report and say
whether we reproduced the problem. After that we keep you updated during the review and tell you
when the fix is in a release.

## In scope

The launcher itself: the code in this repository and the builds made from it:

- handling content from external catalogs (Modrinth, CurseForge, modpacks,
  archives, worlds, resource packs): everything that is unpacked and run;
- path handling: leaving the data directory during unpacking or import,
  replacing game files, symbolic links;
- storing and passing credentials: the local secret storage, the boundary
  between the core and the webview, Minecraft and Microsoft sessions;
- the update mechanism: signature check, fallback channel, artifact replacement;
- starting the game: building JVM arguments, choosing Java, work with the server and
  `servers.dat`;
- core integrations: deep link, tray, clipboard, opening external links and
  folders;
- the security configuration of the build: CSP, Tauri capabilities, file permissions.

## Out of scope

- Our servers and services: `api.millida.net`, `millida.net`, the update CDN,
  sites and panels. Testing them is not agreed at this address. Report problems in
  them to the same address, but in a separate message and without active scanning.
- Vulnerabilities in third-party services and catalogs (Modrinth, CurseForge, Microsoft,
  mc-heads.net). Report them to their owners.
- Social engineering, phishing, physical access to someone else's device, attacks on
  employees.
- Reports from automatic scanners and linters without confirmed exploitation:
  a list of "vulnerable" dependencies, scores without a working scenario, antivirus
  detections on an unsigned installer.
- Scenarios where the attacker already needs administrator rights or
  access to the user's account on their machine.
- A missing protection that we never promised. For example, the launcher is not meant to
  stop a user who changes their own game files.

## Supported builds

Fixes ship only in the latest release. The launcher updates itself, so
before you send a report, check that the problem still happens on the current
version. The number is shown in the launcher settings.

| Version | Support |
| --- | --- |
| latest release | yes |
| anything older | no |
