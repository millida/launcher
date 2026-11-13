# Code signing policy

Russian version: [CODE_SIGNING.ru.md](CODE_SIGNING.ru.md)

How Millida Launcher files are signed and who is responsible for it.

## What we have now

- **Build attestation.** GitHub Actions builds every release file in this repository. GitHub issues an
  attestation (Sigstore) for it: which commit and which run built it. Check it with
  `gh attestation verify <file> -R millida/launcher`. The sums of all files are in `SHA256SUMS` of the release.
- **Update signature.** Launcher updates are signed with a Millida key (minisign). The public part of the key is in
  [tauri.conf.json](src-tauri/tauri.conf.json). The launcher will not install an update without this signature.
- **Windows signature (Authenticode).** The launcher and its installer in every release are signed with a
  [Certum](https://www.certum.eu) code signing certificate kept in the Certum cloud, with an RFC 3161 timestamp, so the
  signature stays valid after the certificate expires. The installer on the download button of the site is signed
  separately, with an EV certificate.
- **macOS signature.** The build is signed without a developer certificate (ad-hoc). macOS will not open a downloaded disk image.
  Installing with the command from the [README](README.md) works, because the file arrives without the quarantine flag.

## Roles

- **Committers and reviewers** are members of the [millida](https://github.com/orgs/millida/people) organization.
  They write code and review other people's changes. Changes from outsiders are accepted only through a pull request.
- **Release managers**: only organization admins can push release tags. The signing credentials are available only to
  builds of release tags, through a protected GitHub environment.

All members sign in to GitHub with two-factor authentication. The policy on the site: [millida.net/launcher/code-signing](https://millida.net/launcher/code-signing).

## What is signed

Only files that are built automatically from the source of this repository by the build scripts in
[.github/workflows](.github/workflows). Third-party libraries and ready-made third-party files are not signed with our signature.

## Data

What the launcher sends, why, and how to turn it off: [TELEMETRY.md](TELEMETRY.md).
Account and file safety: [SAFETY.md](SAFETY.md). To report a vulnerability: [SECURITY.md](SECURITY.md).
