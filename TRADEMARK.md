# Millida trademarks and brand

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

---

<details>
<summary><b>Русская версия</b></summary>

# Товарные знаки и бренд Millida

Исходный код Millida Launcher распространяется под лицензией **GPL-3.0-only** (файл
[LICENSE](LICENSE)). На бренд эта лицензия **не распространяется**: авторское право
и права на товарный знак — это разные вещи, и GPL передаёт только права на код.

## Что не покрывается GPL

Следующие материалы остаются собственностью Millida и лицензией на код не выдаются:

- название **«Millida»**, «Millida Launcher», «Millida Skins», «Millida Trade» и любые
  словесные и графические обозначения, сходные с ними до степени смешения;
- логотип — `public/millida-logo.svg`, `public/favicon.svg`, иконки приложения в
  `src-tauri/icons/`;
- фирменный плащ `public/capes/millida.png`;
- обложки, баннеры, фоновые изображения и прочие оформительские материалы в
  `public/bg/`, `public/hero-*.png` и подобных;
- доменные имена и оформление сайтов Millida.

Эти файлы включены в репозиторий только для того, чтобы официальные сборки
собирались из исходников «как есть». Их наличие в дереве проекта не даёт права
использовать их в производных продуктах.

## Требования к форкам

Если вы форкаете проект и распространяете собственные сборки — сам код вы можете
использовать и модифицировать по условиям GPL-3.0. Но при этом вы обязаны:

1. **Сменить название.** Продукт не должен называться «Millida», «Millida Launcher»
   или похоже. Это касается имени приложения, идентификатора бандла
   (`identifier` в `src-tauri/tauri.conf.json`), названия исполняемого файла,
   заголовка окна и записей в меню/автозапуске.
2. **Заменить визуальный бренд.** Уберите или замените логотип, иконки, favicon,
   фирменный плащ и оформительские изображения из списка выше на свои.
3. **Не заявлять аффилиацию.** Нельзя утверждать или намекать, что ваша сборка
   выпущена Millida, одобрена Millida, поддерживается Millida или является
   «официальной». Формулировка вида «форк проекта Millida Launcher» допустима —
   это фактическое утверждение о происхождении кода, и мы против неё не возражаем.
   А вот «Millida Launcher Pro» или логотип Millida на лендинге — нет.
4. **Подставить свои ключи и эндпоинты.** Сборочные переменные и адреса сервисов
   Millida принадлежат нам и рассчитаны на официальные сборки:
   - `MILLIDA_MS_CLIENT_ID` — client ID приложения Microsoft Entra ID (Azure).
     Зарегистрируйте **собственное** приложение в Azure и укажите свой ID. Наш
     идентификатор использовать нельзя: он привязан к нашей организации, и вход
     через него от имени чужой сборки будет считаться злоупотреблением.
   - `MILLIDA_DISCORD_APP_ID` — своё приложение в Discord Developer Portal, иначе
     отключите Rich Presence.
   - `MILLIDA_API` и связанные адреса API, CDN, прокси CurseForge, скинов, плащей,
     статистики и обновлений — поднимите свои сервисы либо отключите функции,
     которые к ним обращаются.

   Обращения к инфраструктуре Millida из неофициальных сборок могут быть
   заблокированы на нашей стороне без предупреждения.

5. **Сохранить лицензионные уведомления.** Файлы `LICENSE`, `NOTICE`,
   `THIRD-PARTY.md` и этот файл должны остаться в вашем форке (текст `TRADEMARK.md`
   при этом описывает наши знаки, а не ваши — при желании добавьте свой раздел).

## Что делать можно без отдельного разрешения

- Упоминать Millida в текстах: «основано на Millida Launcher», «совместимо с
  Millida», сравнения, обзоры, обсуждения, багрепорты.
- Ссылаться на официальный репозиторий и сайт.
- Собирать неизменённый код для личного использования, включая сборки для себя
  с оригинальным брендом (не распространяя их).
- Распространять патчи и диффы к проекту.

## Сомневаетесь — спросите

Мы не ставим целью мешать форкам, задача правил ровно одна: пользователь должен
понимать, чья сборка у него запущена и кому писать, если что-то сломалось.
Если ваш сценарий не описан выше — напишите нам, договоримся.

</details>
