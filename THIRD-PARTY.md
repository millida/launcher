# Third-party components

Russian version: [THIRD-PARTY.ru.md](THIRD-PARTY.ru.md)

Millida Launcher is distributed under [GPL-3.0-only](LICENSE). Below are the components
of third parties that end up in the build or are used to make it, together with their
licenses.

The lists were collected automatically:

- Rust: `cargo metadata --format-version 1` in `src-tauri`, the `license` field of each
  package (including transitive dependencies and build dependencies).
- JS: the project's `package.json` plus the `license` fields from `node_modules/*/package.json`.

The data is current as of the last update of this file. When dependencies change,
the lists must be rebuilt.

## Compatibility with GPL-3.0

We checked all direct and transitive dependencies.
**No licenses incompatible with GPL-3.0 were found.** Some cases are not obvious, so we
explain them:

- `MPL-2.0` (Rust: `cssparser`, `cssparser-macros`, `dtoa-short`, `option-ext`,
  `selectors`; npm: `lightningcss`, `lightningcss-win32-x64-msvc`). MPL 2.0
  explicitly lists GPL-3.0 as a compatible secondary license (section 3.3). Files under
  MPL stay under MPL.
- `Unicode-3.0` (18 crates of the ICU4X family) is a permissive Unicode license.
  The FSF recognizes it as compatible with the GPL.
- `CDLA-Permissive-2.0` (`webpki-roots`, `webpki-root-certs`) is a permissive
  license for data (root certificates). It puts no limits on distribution.
- `BSL-1.0` (`clipboard-win`, `error-code`, an option for `ryu`) is the Boost Software
  License. It is compatible with the GPL.
- `CC0-1.0` (`tiny-keccak`; an option for `dunce`) is a waiver of rights. It is compatible with the GPL.
- `CC-BY-4.0` (`caniuse-lite`) is a browser database. It is used only at
  build time (Browserslist) and does not end up in the shipped binary.
- For dual licenses like `MIT OR Apache-2.0` we use either the MIT or the
  Apache-2.0 option. Both are compatible with GPL-3.0 (Apache-2.0 is compatible with
  version 3 of the GPL specifically, not with version 2).

## Vendored code in the repository

- `src/vendor/mine3d` is the source of the 3D skin preview engine
  [mine3d-embedded](https://github.com/studioberry-hub/mine3d-embedded) (Undefined
  Studio), license **MIT**. The license text is next to it in `src/vendor/mine3d/LICENSE`.
  The code is version `0.2.0` and is built together with the frontend. Differences from upstream:

  - removed the module that loads a skin by nickname through third-party CDNs. The core fetches textures;
  - added the `preserveDrawingBuffer` option and the `setContactShadowVisible` method;
  - outer-layer voxels are built without faces that touch a neighboring voxel, and with
    a UV offset from the texel edge. Without this, a dark grid appears on the second layer;
  - ACES tone mapping is replaced with Neutral: ACES shifted the colors of pixel art;
  - the look-at-cursor direction is computed from the direction to the camera, not in the model's local
    coordinates. Otherwise, when the model turns its back, the head looks the wrong way;
  - the gaze follows the target with a speed limit and a smooth weight: right behind
    the back the target jumps from one shoulder to the other, and entering and leaving the "nudge"
    would otherwise break the head pose;
  - a repeated click during a "nudge" does not restart it from zero;
  - shadow map 2048 instead of 4096, a devicePixelRatio cap of 2 instead of 2.5, and
    automatic quality reduction when the FPS drops.

  The engine relies on the npm packages [three.js](https://github.com/mrdoob/three.js),
  [skin3d](https://github.com/cosmic-fi/skin3d) and
  [skinview-utils](https://github.com/bs-community/skinview-utils). All are under **MIT**.

## Fonts

All three fonts in `public/fonts/` are under the **SIL Open Font License 1.1**. The full text
is in [`public/fonts/OFL.txt`](public/fonts/OFL.txt):

| Font | Files | Copyright holder |
| --- | --- | --- |
| Manrope | `Manrope-cyrillic.woff2`, `Manrope-latin.woff2` | The Manrope Project Authors, 2018 |
| Geist | `Geist-Variable.woff2` | The Geist Project Authors, 2024 (Vercel) |
| Unbounded | `Unbounded-latin.woff2` | The Unbounded Project Authors, 2022 |

OFL 1.1 is compatible with the GPL: fonts are separate works. They are distributed
under their own license and do not make the program a derivative of them.

## Music

The tracks in `media/music/` are works of other people under free licenses.
The GPL does not apply to them:

- "Chibi Ninja", "Jumpshot", "HHavok", "A Night Of Dizzy Spells":
  Music: Eric Skiff, Resistor Anthems, https://ericskiff.com/music/,
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- "Secret Base": PPEAK (Preston Peak), "FREE Action Chiptune Music Pack",
  https://opengameart.org/content/free-action-chiptune-music-pack,
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- "Starlight City": Zane Little,
  https://opengameart.org/content/starlight-city-loop-included,
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
- "Level 2": Juhani Junkala (SubspaceAudio), "5 Chiptunes (Action)",
  https://opengameart.org/content/5-chiptunes-action,
  [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

Changes: the volume is leveled (EBU R128, −18 LUFS), and the files are re-encoded to MP3.

## Other resources

- Background images and videos (`public/bg/`, `media/bg/`), block
  icons (`public/block-icons/`), brand images: see `TRADEMARK.md`.
  Millida brand assets are not covered by the GPL.
- Minecraft, Mojang/Microsoft resources, and CurseForge/Modrinth content
  are not distributed by the launcher. It only downloads them from the official sources
  to the user's machine.
