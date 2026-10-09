//! Invite codes of partner games. A code arrives from the website (deep link,
//! or claimed once per install for a player who had no launcher yet), waits in
//! the prefs file and is handed to the game on its first successful start.
//!
//! The formats live only here: the webview names a slug and a raw code, and the
//! core decides whether it is one.

use crate::engine::*;
use serde_json::json;

struct InviteFormat {
    slug: &'static str,
    prefix: &'static str,
    body_len: usize,
}

const INVITE_FORMATS: &[InviteFormat] = &[InviteFormat { slug: "prisonrpg", prefix: "PRISON-", body_len: 5 }];

const MAX_RAW_LEN: usize = 64;
const CLAIM_PATH: &str = "/launcher/game-invites/claim";
const CLAIMED: &str = "1";

fn format_for(slug: &str) -> Option<&'static InviteFormat> {
    INVITE_FORMATS.iter().find(|f| f.slug == slug)
}

fn invite_key(slug: &str) -> String {
    format!("game-invite-{}", slug)
}

fn claimed_key(slug: &str) -> String {
    format!("game-invite-claimed-{}", slug)
}

/// Digits 0 and 1 are left out of the partner's alphabet: they read as O and I.
fn code_char_ok(b: u8) -> bool {
    b.is_ascii_uppercase() || (b'2'..=b'9').contains(&b)
}

/// The canonical code, or None when the slug has no invites or the text is not
/// one of its codes.
pub fn normalize_invite(slug: &str, raw: &str) -> Option<String> {
    let format = format_for(slug)?;
    if raw.len() > MAX_RAW_LEN {
        return None;
    }
    let code = raw.trim().to_ascii_uppercase();
    let body = code.strip_prefix(format.prefix)?;
    (body.len() == format.body_len && body.bytes().all(code_char_ok)).then_some(code)
}

/// The stored code, checked again: the prefs file may come from an older
/// version, a cloud restore or a hand edit.
pub fn game_invite(slug: &str) -> Option<String> {
    format_for(slug)?;
    ui_pref(&invite_key(slug)).and_then(|v| normalize_invite(slug, &v))
}

/// The invite reached this launcher, so the server-side copy for a fresh
/// install is no longer needed: claiming it later would hand back the code the
/// player has already used.
fn store_invite(slug: &str, code: String) -> Result<(), String> {
    set_ui_pref(invite_key(slug), code)?;
    set_ui_pref(claimed_key(slug), CLAIMED.into())
}

/// Ok(false) for a slug without invites or a malformed code: a bad link still
/// opens the game card, it just carries nothing.
pub fn set_game_invite(slug: &str, raw: &str) -> Result<bool, String> {
    match normalize_invite(slug, raw) {
        Some(code) => store_invite(slug, code).map(|_| true),
        None => Ok(false),
    }
}

pub fn clear_game_invite(slug: &str) -> Result<(), String> {
    set_ui_pref(invite_key(slug), String::new())
}

enum ClaimStep {
    Done,
    Ask,
}

fn claim_step(slug: &str) -> Result<ClaimStep, String> {
    if format_for(slug).is_none() || ui_pref(&claimed_key(slug)).as_deref() == Some(CLAIMED) {
        return Ok(ClaimStep::Done);
    }
    if game_invite(slug).is_some() {
        set_ui_pref(claimed_key(slug), CLAIMED.into())?;
        return Ok(ClaimStep::Done);
    }
    Ok(ClaimStep::Ask)
}

fn accept_claimed(slug: &str, answer: &serde_json::Value) -> Result<bool, String> {
    match answer["code"].as_str().and_then(|c| normalize_invite(slug, c)) {
        Some(code) => store_invite(slug, code).map(|_| true),
        None => set_ui_pref(claimed_key(slug), CLAIMED.into()).map(|_| false),
    }
}

/// The server hands a code out only once, so the claim is marked done after an
/// answer, never before. True when a new code was stored.
async fn claim_one(slug: &'static str) -> Result<bool, String> {
    let step = tauri::async_runtime::spawn_blocking(move || claim_step(slug)).await.map_err(|e| e.to_string())??;
    if let ClaimStep::Done = step {
        return Ok(false);
    }
    let answer = post_json(&format!("{}{}", MILLIDA_API, CLAIM_PATH), &json!({ "slug": slug })).await?;
    tauri::async_runtime::spawn_blocking(move || accept_claimed(slug, &answer)).await.map_err(|e| e.to_string())?
}

/// Asks the website, once per install and game, for an invite the player
/// followed before the launcher existed on this machine. A game whose claim
/// failed is simply asked again on the next start. Returns the games that got
/// a new code.
pub async fn claim_game_invites() -> Vec<String> {
    let mut claimed = Vec::new();
    for format in INVITE_FORMATS {
        match claim_one(format.slug).await {
            Ok(true) => claimed.push(format.slug.to_string()),
            Ok(false) => {}
            Err(e) => eprintln!("[invite] {}: приглашение не запрошено, повторим при следующем запуске: {}", format.slug, e),
        }
    }
    claimed
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (slug, raw text) -> stored code. The code ends up on the game's command
    /// line, so anything but the partner's exact format must be refused.
    #[test]
    fn only_the_partner_format_is_accepted() {
        let cases: [(&str, &str, Option<&str>, &str); 12] = [
            ("prisonrpg", "PRISON-22G6C", Some("PRISON-22G6C"), "код партнёра принимается как есть"),
            ("prisonrpg", "  prison-22g6c \n", Some("PRISON-22G6C"), "регистр и пробелы из ссылки выравниваются"),
            ("prisonrpg", "PRISN-22G6C", None, "чужой префикс — не код этой игры"),
            ("prisonrpg", "22G6C", None, "без префикса не принимается"),
            ("prisonrpg", "PRISON-22G6", None, "четыре символа — обрезанный код"),
            ("prisonrpg", "PRISON-22G6CX", None, "шесть символов — не формат партнёра"),
            ("prisonrpg", "PRISON-10G6C", None, "цифр 0 и 1 в алфавите партнёра нет"),
            ("prisonrpg", "PRISON-22G6C --x", None, "хвост после кода стал бы лишним ключом игры"),
            ("prisonrpg", "PRISON-22-6C", None, "знаки препинания внутри кода"),
            ("prisonrpg", "PRISON-22G6\u{0421}", None, "кириллица, похожая на латиницу"),
            ("prisonrpg", "", None, "пустая ссылка ничего не хранит"),
            ("otherpack", "PRISON-22G6C", None, "у неизвестной игры инвайтов нет"),
        ];
        for (slug, raw, want, why) in cases {
            assert_eq!(normalize_invite(slug, raw).as_deref(), want, "{slug} {raw:?}: {why}");
        }
        let long = format!("PRISON-22G6C{}", " ".repeat(MAX_RAW_LEN));
        assert_eq!(normalize_invite("prisonrpg", &long), None, "ссылка длиннее предела не разбирается");
    }

    #[test]
    fn invite_keys_fit_the_prefs_file() {
        for f in INVITE_FORMATS {
            for key in [invite_key(f.slug), claimed_key(f.slug)] {
                assert!(
                    key.len() <= 48 && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'),
                    "{key}: the prefs file rejects this key, so the invite of {} would never be stored",
                    f.slug,
                );
            }
        }
    }
}
