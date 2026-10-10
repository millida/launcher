use crate::engine::*;
use serde_json::Value;

/// Where a catalogue build remembers that its author keeps the contents to
/// themselves, so an offline start still hides them.
pub const PACK_PROTECTED_KEY: &str = "catalogPackProtected";
/// Which catalogue icon the build wears and a fingerprint of the picture we
/// put there: a picture with another fingerprint is the player's own choice.
pub const PACK_ICON_KEY: &str = "catalogPackIcon";

const ICON_HOST: &str = "cdn.millida.trade";
const ICON_MAX_BYTES: usize = 2 * 1024 * 1024;
const ICON_WAIT: std::time::Duration = std::time::Duration::from_secs(20);

pub const PROTECTED_REFUSAL: &str =
    "Автор сборки закрыл её содержимое — поделиться можно ссылкой на сборку в каталоге Millida";

/// Only a boolean from our card counts: an older API without the field says
/// nothing, and nothing must not switch the protection off.
pub fn pack_protected_flag(view: &Value) -> Option<bool> {
    view["protectedContent"].as_bool()
}

pub(crate) fn remember_protected(settings: &mut serde_json::Map<String, Value>, view: &Value) {
    if let Some(on) = pack_protected_flag(view) {
        settings.insert(PACK_PROTECTED_KEY.into(), Value::Bool(on));
    }
}

/// Only a build installed from our catalogue can be protected: the flag alone
/// in a settings file copied into another build means nothing.
pub fn content_protected(settings: &Value) -> bool {
    let from_catalogue = settings["catalogPackSlug"].as_str().map(str::trim).is_some_and(catalog_slug_ok);
    from_catalogue && settings[PACK_PROTECTED_KEY].as_bool() == Some(true)
}

pub fn profile_content_protected(profile: &str) -> bool {
    content_protected(&profile_settings(profile))
}

pub(crate) fn refuse_protected(profile: &str) -> Result<(), String> {
    if profile_content_protected(profile) {
        return Err(PROTECTED_REFUSAL.into());
    }
    Ok(())
}

/// A build the player already changed shows its contents: the list is theirs
/// to manage, and hiding it left them with a build whose mods they could not see.
pub fn protected_builds() -> Vec<String> {
    load_profiles()
        .into_iter()
        .filter(|p| profile_content_protected(&p.name) && !mods_modified(&profile_dir(&p.name)))
        .map(|p| p.name)
        .collect()
}

fn icon_url_allowed(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw.trim()) else { return false };
    url.scheme() == "https" && url.host_str() == Some(ICON_HOST) && url.port().is_none() && url.username().is_empty()
}

#[derive(Debug, PartialEq)]
pub enum IconStep {
    Keep,
    Apply,
}

/// Whether the build takes the icon from its catalogue card. A player picks a
/// block or their own picture; an empty icon, a web address (the cover older
/// launchers put there) and the old wallpaper default were never a choice.
pub fn catalog_icon_step(card_icon: &str, current: Option<&str>, marker: &Value) -> IconStep {
    if !icon_url_allowed(card_icon) {
        return IconStep::Keep;
    }
    let current = current.map(str::trim).filter(|c| !c.is_empty());
    let Some(icon) = current else { return IconStep::Apply };
    if icon.starts_with("https://") || icon.starts_with("http://") || icon.starts_with("/bg/") {
        return IconStep::Apply;
    }
    if marker["sum"].as_str() != Some(sha256_hex(icon.as_bytes()).as_str()) {
        return IconStep::Keep;
    }
    // Тот же значок, но снятый в старом размере (128) — перерисовываем чётче.
    if marker["from"].as_str() == Some(card_icon.trim()) && marker["px"].as_u64() == Some(COVER_PX as u64) {
        return IconStep::Keep;
    }
    IconStep::Apply
}

async fn fetch_icon(url: &str) -> Result<String, String> {
    let res = client().get(url.trim()).timeout(ICON_WAIT).send().await.map_err(|e| net_err(&e))?;
    if !icon_url_allowed(res.url().as_str()) {
        return Err("иконка переехала на чужой адрес".into());
    }
    if !res.status().is_success() {
        return Err(format!("сервер ответил {}", res.status()));
    }
    let bytes = read_capped(res, ICON_MAX_BYTES).await?;
    tauri::async_runtime::spawn_blocking(move || pack_icon_data_url(&bytes)).await.map_err(|e| e.to_string())?
}

fn current_icon(profile: &str) -> Option<Option<String>> {
    load_profiles().into_iter().find(|p| p.name == profile).map(|p| p.icon)
}

/// Puts the card's icon on the build unless the player chose their own.
/// Returns whether the icon changed. A failed download changes nothing and is
/// tried again at the next check: the icon is never worth a failed install.
pub async fn sync_pack_icon(profile: &str, view: &Value) -> bool {
    let card_icon = view["icon"].as_str().unwrap_or("").trim().to_string();
    let Some(before) = current_icon(profile) else { return false };
    let marker = profile_settings(profile)[PACK_ICON_KEY].clone();
    if catalog_icon_step(&card_icon, before.as_deref(), &marker) == IconStep::Keep {
        return false;
    }
    let data = match fetch_icon(&card_icon).await {
        Ok(data) => data,
        Err(e) => {
            eprintln!("[pack] иконка сборки «{}» не скачалась, попробуем при следующей проверке: {}", profile, e);
            return false;
        }
    };
    // The player may have picked an icon while this one downloaded.
    if current_icon(profile) != Some(before) {
        return false;
    }
    // The marker goes first: cut between the two writes, the old icon is still
    // one we may replace, while our icon without its marker would pass for the
    // player's choice for good.
    let mut patch = serde_json::Map::new();
    patch.insert(PACK_ICON_KEY.into(), serde_json::json!({ "from": card_icon, "sum": sha256_hex(data.as_bytes()), "px": COVER_PX }));
    merge_settings(profile, patch);
    set_profile_cover(profile, Some(data));
    true
}

/// What a fresh card changes in an installed build besides its version: the
/// protection of its contents and its icon. Returns whether anything changed.
pub async fn apply_pack_card(profile: &str, view: &Value) -> bool {
    let settings = profile_settings(profile);
    let mut patch = serde_json::Map::new();
    remember_protected(&mut patch, view);
    let flag_changed = patch.get(PACK_PROTECTED_KEY).is_some_and(|v| settings.get(PACK_PROTECTED_KEY) != Some(v));
    if flag_changed {
        merge_settings(profile, patch);
    }
    sync_pack_icon(profile, view).await | flag_changed
}

/// The check the build page and the lobby run next to the update check. The
/// webview names only the build; the card address comes from its settings.
pub async fn sync_catalog_pack(profile: String) -> Result<bool, String> {
    let settings = profile_settings(&profile);
    let Some(slug) = settings["catalogPackSlug"].as_str().map(str::trim).filter(|s| catalog_slug_ok(s)) else {
        return Ok(false);
    };
    let view = millida_api(format!("/catalog/packs/{}", slug), "GET".into(), None, millida_token()).await?;
    Ok(apply_pack_card(&profile, &view).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ICON: &str = "https://cdn.millida.trade/catalog/launcher-packs/oneblock-metalabs/2026-09-27/oneblock-icon.png";

    /// (card icon, build icon, marker) -> does the build take the card's icon.
    #[test]
    fn the_catalogue_icon_never_replaces_the_players_choice() {
        let ours = "data:image/png;base64,AAAA";
        let marked = json!({ "from": ICON, "sum": sha256_hex(ours.as_bytes()), "px": COVER_PX });
        let older = json!({ "from": "https://cdn.millida.trade/old.png", "sum": sha256_hex(ours.as_bytes()), "px": COVER_PX });
        let blurry = json!({ "from": ICON, "sum": sha256_hex(ours.as_bytes()) });
        let cases: [(&str, Option<&str>, Value, IconStep, &str); 13] = [
            (ICON, Some(ours), blurry, IconStep::Apply, "our icon taken at the old 128 px is redrawn sharper"),
            (ICON, None, Value::Null, IconStep::Apply, "a build without an icon shows the bookshelf; the pack has its own"),
            (ICON, Some(""), Value::Null, IconStep::Apply, "an empty icon is no choice"),
            (ICON, Some("https://cdn.millida.trade/x/banner.png"), Value::Null, IconStep::Apply, "older launchers put the cover there, the player never did"),
            (ICON, Some("/bg/forest.jpg"), Value::Null, IconStep::Apply, "the old wallpaper default reads as the default icon"),
            (ICON, Some("/build-icons/grass.png#bg=1f3b22"), Value::Null, IconStep::Keep, "a block the player picked stays"),
            (ICON, Some("data:image/png;base64,BBBB"), marked.clone(), IconStep::Keep, "the player's own picture stays even when we once set ours"),
            (ICON, Some(ours), marked.clone(), IconStep::Keep, "our icon is already the card's one: no download on every check"),
            (ICON, Some(ours), older, IconStep::Apply, "the author changed the icon: ours follows"),
            (ICON, Some(ours), json!({ "from": ICON, "sum": 1 }), IconStep::Keep, "the settings file is on the player's disk: a broken marker proves nothing"),
            ("", None, Value::Null, IconStep::Keep, "a card without an icon leaves the build as it is"),
            ("https://evil.example/icon.png", None, Value::Null, IconStep::Keep, "the icon is downloaded only from our CDN"),
            ("http://cdn.millida.trade/icon.png", None, Value::Null, IconStep::Keep, "plain http can be swapped on the way"),
        ];
        for (card, current, marker, want, why) in cases {
            assert_eq!(catalog_icon_step(card, current, &marker), want, "{}", why);
        }
    }

    #[test]
    fn only_our_cdn_serves_pack_icons() {
        let cases: [(&str, bool, &str); 6] = [
            (ICON, true, "the catalogue stores pack icons here"),
            ("https://cdn.millida.trade.evil.example/i.png", false, "a look-alike host is not ours"),
            ("https://cdn.millida.trade:8443/i.png", false, "our CDN has no other port"),
            ("https://user@cdn.millida.trade/i.png", false, "credentials in the address are a disguise"),
            ("https://127.0.0.1/i.png", false, "loopback is never a pack icon"),
            ("not a url", false, "garbage from the card is refused"),
        ];
        for (url, want, why) in cases {
            assert_eq!(icon_url_allowed(url), want, "{}", why);
        }
    }

    /// (card answer, settings) -> are the build's contents hidden.
    #[test]
    fn protection_comes_from_our_card_and_survives_offline() {
        let cases: [(Value, bool, &str); 6] = [
            (json!({ "catalogPackSlug": "oneblock-metalabs", PACK_PROTECTED_KEY: true }), true, "OneBlock card asked to hide the contents"),
            (json!({ "catalogPackSlug": "arcania", PACK_PROTECTED_KEY: false }), false, "a withdrawn protection shows the contents again"),
            (json!({ "catalogPackSlug": "aeronautics" }), false, "packs are not protected by default"),
            (json!({ PACK_PROTECTED_KEY: true }), false, "the flag outside a catalogue build means nothing"),
            (json!({ "catalogPackSlug": "oneblock-metalabs", PACK_PROTECTED_KEY: "true" }), false, "only a real boolean counts"),
            (Value::Null, false, "unreadable settings are no protection"),
        ];
        for (settings, want, why) in cases {
            assert_eq!(content_protected(&settings), want, "{}", why);
        }
        assert_eq!(pack_protected_flag(&json!({ "slug": "arcania" })), None, "an older API without the field says nothing");
        assert_eq!(pack_protected_flag(&json!({ "protectedContent": 1 })), None, "only a boolean from the card counts");
        assert_eq!(pack_protected_flag(&json!({ "protectedContent": true })), Some(true));
        let mut kept = serde_json::Map::new();
        kept.insert(PACK_PROTECTED_KEY.into(), Value::Bool(true));
        remember_protected(&mut kept, &json!({}));
        assert_eq!(kept[PACK_PROTECTED_KEY], Value::Bool(true), "a card without the field must not switch a stored protection off");
    }

    #[test]
    fn pixel_art_icons_keep_hard_edges() {
        let blocky = image::DynamicImage::ImageRgba8(image::RgbaImage::from_fn(512, 512, |x, y| {
            image::Rgba([((x / 4) % 256) as u8, ((y / 4) % 256) as u8, 0, 255])
        }));
        let painted = image::DynamicImage::ImageRgba8(image::RgbaImage::from_fn(256, 256, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, 0, 255])
        }));
        let small = image::DynamicImage::ImageRgba8(image::RgbaImage::new(16, 16));
        let wide = image::DynamicImage::ImageRgba8(image::RgbaImage::new(256, 128));
        assert!(pixel_art(&blocky), "OneBlock's 512 px grass block is drawn in 4 px blocks");
        assert!(!pixel_art(&painted), "a painted icon is smoothed, not cut into steps");
        assert!(pixel_art(&small), "a 16 px texture is blown up by a whole factor");
        assert!(!pixel_art(&wide), "a non-square picture is cropped, and cropping is smoothed");
    }
}
