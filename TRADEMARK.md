# Millida trademarks and brand

Russian version: [TRADEMARK.ru.md](TRADEMARK.ru.md)

The source code of Millida Launcher is distributed under the **GPL-3.0-only** license (the file
[LICENSE](LICENSE)). This license **does not cover the brand**. Copyright
and trademark rights are different things, and the GPL grants rights to the code only.

## What the GPL does not cover

The following materials remain the property of Millida. The code license does not grant rights to them:

- the name **"Millida"**, "Millida Launcher", "Millida Skins", "Millida Trade" and any
  word or graphic marks that are confusingly similar to them;
- the logo: `public/millida-logo.svg`, `public/favicon.svg`, the app icons in
  `src-tauri/icons/`;
- the Millida cape `public/capes/millida.png`;
- covers, banners, background images and other design materials in
  `public/bg/`, `public/hero-*.png` and similar places;
- the domain names and the design of Millida sites.

These files are in the repository only so that official builds
can be built from source "as is". Having them in the project tree does not give you the right
to use them in derived products.

## Requirements for forks

If you fork the project and distribute your own builds, you can use and modify
the code under the terms of GPL-3.0. But you must also do this:

1. **Change the name.** Your product must not be called "Millida", "Millida Launcher"
   or anything similar. This applies to the app name, the bundle identifier
   (`identifier` in `src-tauri/tauri.conf.json`), the name of the executable,
   the window title and the entries in the menu and autostart.
2. **Replace the visual brand.** Remove or replace the logo, icons, favicon,
   the Millida cape and the design images from the list above with your own.
3. **Do not claim affiliation.** You must not say or hint that your build
   was released by Millida, approved by Millida, supported by Millida or is
   "official". A phrase like "a fork of the Millida Launcher project" is fine.
   It is a statement of fact about where the code comes from, and we do not object to it.
   But "Millida Launcher Pro" or the Millida logo on a landing page is not fine.
4. **Use your own keys and endpoints.** The build variables and service addresses
   of Millida belong to us and are meant for official builds:
   - `MILLIDA_MS_CLIENT_ID` is the client ID of a Microsoft Entra ID (Azure) app.
     Register **your own** app in Azure and set your own ID. You must not use our
     ID: it is tied to our organization, and signing in with it from someone else's build
     counts as abuse.
   - `MILLIDA_DISCORD_APP_ID`: use your own app in the Discord Developer Portal, or
     turn Rich Presence off.
   - `MILLIDA_API` and the related addresses of the API, CDN, CurseForge proxy, skins, capes,
     statistics and updates: run your own services, or turn off the features
     that call them.

   Requests to the Millida infrastructure from unofficial builds may be
   blocked on our side without notice.

5. **Keep the license notices.** The files `LICENSE`, `NOTICE`,
   `THIRD-PARTY.md` and this file must stay in your fork (the text of `TRADEMARK.md`
   describes our marks, not yours. You can add a section of your own).

## What you can do without separate permission

- Mention Millida in texts: "based on Millida Launcher", "compatible with
  Millida", comparisons, reviews, discussions, bug reports.
- Link to the official repository and site.
- Build the unchanged code for personal use, including builds for yourself
  with the original brand (without distributing them).
- Distribute patches and diffs for the project.

## If in doubt, ask

We do not want to get in the way of forks. The rules have one goal: the user must
know whose build is running and whom to write to if something breaks.
If your case is not described above, write to us and we will agree on it.

Copyright and DMCA notices go to [dmca@millida.net](mailto:dmca@millida.net); see [DMCA.md](DMCA.md).
