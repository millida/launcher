# Aera Launcher signing status

Russian version: [CODE_SIGNING.ru.md](CODE_SIGNING.ru.md)

Aera Launcher is a rebrand/fork of the GPL-licensed Millida Launcher source. **This repository does not currently publish Aera-signed or Aera-attested release builds.** A local Aera build must not be represented as official, signed, or security-reviewed by Aera unless a separately authorized release process is established.

## Current state

- **Build attestation:** No Aera release attestation is issued for this branch. Upstream repository attestations do not attest to this rebranded source or to an Aera release.
- **Windows/macOS signing:** This fork has no Aera Authenticode certificate or Apple Developer signing identity configured. A locally built package may be unsigned and receive operating-system warnings.
- **Updater:** The Tauri configuration intentionally retains the existing upstream Millida update feed and public verification key for compatibility. A public key verifies signatures; it cannot sign releases. The feed may serve upstream builds, so a packaged test build can be replaced by one. Do not distribute a public Aera package until an authorized Aera feed, signing key, and update procedure are set up.
- **Connected services:** Account, API, catalog, CDN, and related integrations are still upstream-connected; they are not Aera-operated by virtue of this rebrand.

Do not reuse or claim upstream signing credentials, attestations, certificates, malware scans, or release provenance as Aera credentials. Preserve the upstream copyright and license notices; see [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD-PARTY.md](THIRD-PARTY.md), and [TRADEMARK.md](TRADEMARK.md).

## Data and security

What the launcher sends, why, and how to turn it off: [TELEMETRY.md](TELEMETRY.md). Account and file safety: [SAFETY.md](SAFETY.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).
