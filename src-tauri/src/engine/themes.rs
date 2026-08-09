use std::path::{Path, PathBuf};

use crate::engine::{data_dir, open_path, safe_child, safe_join};

const MAX_CSS_BYTES: u64 = 512 * 1024;
const MAX_TOTAL_BYTES: u64 = 16 * 1024 * 1024;
const MAX_FILES: usize = 300;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_OPTIONS: usize = 40;

/// Everything a theme pack may carry. A theme is untrusted content that ends up
/// inside a <style> tag, so anything that could execute, fetch or embed is left
/// out: no svg (scriptable when opened directly), no html, no archives.
const ALLOWED_EXT: &[&str] =
    &["css", "json", "png", "jpg", "jpeg", "webp", "gif", "woff2", "woff", "ttf", "otf"];

/// Declarative control shown in Settings. The value reaches the CSS as the
/// custom property `--o-<key>`, and for toggles and selects also as the
/// attribute `data-o-<key>` so a theme can branch on it with a selector.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeOption {
    pub key: String,
    /// `toggle` | `color` | `select` | `slider`
    pub kind: String,
    pub label: String,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub default: String,
    #[serde(default)]
    pub items: Vec<ThemeOptionItem>,
    #[serde(default)]
    pub min: Option<f64>,
    #[serde(default)]
    pub max: Option<f64>,
    #[serde(default)]
    pub step: Option<f64>,
    #[serde(default)]
    pub unit: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ThemeOptionItem {
    pub value: String,
    pub label: String,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// `dark` | `light` | `any` — which palette the pack was drawn against.
    #[serde(default = "any_base")]
    pub base: String,
    /// Swatches for the card in Settings: background, surface, accent.
    #[serde(default)]
    pub preview: Vec<String>,
    #[serde(default)]
    pub options: Vec<ThemeOption>,
}

fn any_base() -> String {
    "any".into()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledTheme {
    #[serde(flatten)]
    pub manifest: ThemeManifest,
    pub dir: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSource {
    pub css: String,
    pub dir: String,
}

pub fn themes_dir() -> PathBuf {
    data_dir().join("themes")
}

fn slug_ok(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !s.starts_with('-')
}

fn validate_manifest(m: &ThemeManifest) -> Result<(), String> {
    if !slug_ok(&m.id, 32) {
        return Err(format!(
            "идентификатор темы «{}» недопустим: только строчные латинские буквы, цифры и дефис",
            m.id
        ));
    }
    if m.name.trim().is_empty() || m.name.len() > 64 {
        return Err("название темы пустое или длиннее 64 символов".into());
    }
    if !matches!(m.base.as_str(), "dark" | "light" | "any") {
        return Err(format!("поле base должно быть dark, light или any, а не «{}»", m.base));
    }
    if m.options.len() > MAX_OPTIONS {
        return Err(format!("в теме больше {MAX_OPTIONS} настроек"));
    }
    for o in &m.options {
        if !slug_ok(&o.key, 24) {
            return Err(format!("ключ настройки «{}» недопустим", o.key));
        }
        if !matches!(o.kind.as_str(), "toggle" | "color" | "select" | "slider") {
            return Err(format!("тип настройки «{}» неизвестен", o.kind));
        }
        if o.kind == "select" && o.items.is_empty() {
            return Err(format!("у списка «{}» нет вариантов", o.key));
        }
    }
    Ok(())
}

fn strip_comments(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let bytes = css.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
            match css[i + 2..].find("*/") {
                Some(end) => i = i + 2 + end + 2,
                None => break,
            }
            out.push(' ');
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

/// CSS escapes are legal inside identifiers, so `@\69 mport` and `\75 rl(` parse
/// exactly like `@import` and `url(` while defeating a plain substring scan.
/// Every escape is resolved before the guard looks at the text.
fn decode_escapes(css: &str) -> String {
    let mut out = String::with_capacity(css.len());
    let mut chars = css.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        let Some(&next) = chars.peek() else {
            out.push('\\');
            break;
        };
        if next == '\n' || next == '\r' {
            chars.next();
            continue;
        }
        if !next.is_ascii_hexdigit() {
            chars.next();
            out.push(next);
            continue;
        }
        let mut hex = String::new();
        while hex.len() < 6 {
            match chars.peek() {
                Some(&h) if h.is_ascii_hexdigit() => {
                    hex.push(h);
                    chars.next();
                }
                _ => break,
            }
        }
        // A single whitespace character ends a hex escape and is consumed with it.
        if matches!(chars.peek(), Some(&w) if w.is_whitespace()) {
            chars.next();
        }
        let code = u32::from_str_radix(&hex, 16).unwrap_or(0);
        out.push(char::from_u32(code).filter(|c| *c != '\0').unwrap_or('\u{FFFD}'));
    }
    out
}

/// A theme is author-supplied CSS. It cannot execute scripts under the app's
/// CSP, but plain CSS can still reach the network — `@import` and any remote
/// `url()` turn a theme into a beacon that reports every launch. Both are
/// rejected outright rather than stripped, so the author sees what is wrong.
pub fn check_css(css: &str) -> Result<(), String> {
    let lower = decode_escapes(&strip_comments(css)).to_ascii_lowercase();
    for (needle, why) in [
        ("@import", "@import загружает внешний файл"),
        ("expression(", "expression() — исполняемый код"),
        ("-moz-binding", "-moz-binding подключает XBL"),
        ("behavior:", "behavior: подключает HTC-скрипт"),
        ("javascript:", "javascript: — исполняемая ссылка"),
        ("</", "закрывающий тег внутри стилей"),
    ] {
        if lower.contains(needle) {
            return Err(format!("тема отклонена: {why}"));
        }
    }
    let mut rest = lower.as_str();
    while let Some(at) = rest.find("url(") {
        rest = &rest[at + 4..];
        let end = rest.find(')').unwrap_or(rest.len());
        let raw = rest[..end].trim().trim_matches(['"', '\''].as_ref()).trim();
        // Escapes are already resolved, so a backslash left here is a literal one
        // and has no business inside an address.
        if raw.contains('\\') {
            return Err("тема отклонена: экранирование внутри url() запрещено".into());
        }
        let external = raw.starts_with("http:")
            || raw.starts_with("https:")
            || raw.starts_with("//")
            || raw.starts_with("file:")
            || raw.starts_with("ftp:")
            || raw.starts_with("blob:");
        if external {
            return Err(format!(
                "тема отклонена: url({raw}) ведёт наружу. Файлы должны лежать внутри темы"
            ));
        }
        rest = &rest[end.min(rest.len())..];
    }
    Ok(())
}

fn read_manifest(dir: &Path) -> Result<ThemeManifest, String> {
    let file = dir.join("theme.json");
    let meta = std::fs::metadata(&file).map_err(|_| "в теме нет файла theme.json".to_string())?;
    if meta.len() > MAX_MANIFEST_BYTES {
        return Err("theme.json слишком большой".into());
    }
    let raw = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let manifest: ThemeManifest =
        serde_json::from_str(&raw).map_err(|e| format!("theme.json повреждён: {e}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn list_themes() -> Vec<InstalledTheme> {
    let root = themes_dir();
    let Ok(entries) = std::fs::read_dir(&root) else { return Vec::new() };
    let mut out: Vec<InstalledTheme> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let dir = e.path();
            let folder = e.file_name().to_string_lossy().to_string();
            let manifest = read_manifest(&dir).ok()?;
            // The folder name is what `read_theme` and `delete_theme` resolve,
            // so a manifest claiming a different id would address another pack.
            if manifest.id != folder || !dir.join("theme.css").is_file() {
                return None;
            }
            Some(InstalledTheme { manifest, dir: dir.to_string_lossy().to_string() })
        })
        .collect();
    out.sort_by_key(|t| t.manifest.name.to_lowercase());
    out
}

pub fn read_theme(id: &str) -> Result<ThemeSource, String> {
    let dir = safe_child(&themes_dir(), id)?;
    let file = dir.join("theme.css");
    let meta = std::fs::metadata(&file).map_err(|_| format!("тема «{id}» не установлена"))?;
    if meta.len() > MAX_CSS_BYTES {
        return Err("theme.css больше 512 КБ".into());
    }
    let css = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    check_css(&css)?;
    Ok(ThemeSource { css, dir: dir.to_string_lossy().to_string() })
}

pub fn delete_theme(id: &str) -> Result<(), String> {
    let dir = safe_child(&themes_dir(), id)?;
    if !dir.join("theme.json").is_file() {
        return Err(format!("тема «{id}» не установлена"));
    }
    std::fs::remove_dir_all(&dir).map_err(|e| format!("не удалось удалить тему: {e}"))
}

pub fn open_themes_folder() {
    let dir = themes_dir();
    std::fs::create_dir_all(&dir).ok();
    open_path(&dir.to_string_lossy());
}

/// Removes the staging directory unless it was handed over, so a pack that
/// fails validation halfway leaves nothing behind.
struct Staging(Option<PathBuf>);

impl Staging {
    fn keep(mut self) -> PathBuf {
        self.0.take().expect("staging path is taken once")
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        if let Some(p) = self.0.take() {
            std::fs::remove_dir_all(p).ok();
        }
    }
}

fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

/// Drops the archive's single top-level folder when it has one, so packs
/// zipped either way install the same.
fn common_prefix(names: &[String]) -> String {
    let first = match names.first() {
        Some(n) => n,
        None => return String::new(),
    };
    let Some((head, _)) = first.split_once('/') else { return String::new() };
    if head.is_empty() || !names.iter().all(|n| n.starts_with(&format!("{head}/"))) {
        return String::new();
    }
    format!("{head}/")
}

pub fn install_theme_from(archive: &Path) -> Result<InstalledTheme, String> {
    let f = std::fs::File::open(archive).map_err(|e| format!("не удалось открыть файл: {e}"))?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(f))
        .map_err(|_| "это не zip-архив с темой".to_string())?;
    if zip.len() > MAX_FILES {
        return Err(format!("в архиве больше {MAX_FILES} файлов"));
    }

    let mut names: Vec<String> = Vec::new();
    for i in 0..zip.len() {
        let Ok(entry) = zip.by_index(i) else { continue };
        if entry.is_dir() {
            continue;
        }
        if let Some(name) = entry.enclosed_name() {
            names.push(name.to_string_lossy().replace('\\', "/"));
        }
    }
    let prefix = common_prefix(&names);

    let root = themes_dir();
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let stage_dir = root.join(".staging");
    std::fs::remove_dir_all(&stage_dir).ok();
    std::fs::create_dir_all(&stage_dir).map_err(|e| e.to_string())?;
    let stage = Staging(Some(stage_dir.clone()));

    let mut written: u64 = 0;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let Some(name) = entry.enclosed_name() else { continue };
        let name = name.to_string_lossy().replace('\\', "/");
        let rel = name.strip_prefix(&prefix).unwrap_or(&name).to_string();
        if rel.is_empty() || !ALLOWED_EXT.contains(&ext_of(&rel).as_str()) {
            continue;
        }
        // The declared size is attacker-controlled, so the cap is enforced on
        // what actually lands on disk as well.
        if entry.size() > MAX_TOTAL_BYTES || written + entry.size() > MAX_TOTAL_BYTES {
            return Err("тема больше 16 МБ".into());
        }
        let out = safe_join(&stage_dir, &rel)?;
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        let mut sink = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        let mut limited = std::io::Read::take(&mut entry, MAX_TOTAL_BYTES - written + 1);
        let copied = std::io::copy(&mut limited, &mut sink).map_err(|e| e.to_string())?;
        written += copied;
        if written > MAX_TOTAL_BYTES {
            return Err("тема больше 16 МБ".into());
        }
    }

    let manifest = read_manifest(&stage_dir)?;
    let css_file = stage_dir.join("theme.css");
    let css_len = std::fs::metadata(&css_file).map(|m| m.len()).unwrap_or(0);
    if css_len == 0 {
        return Err("в теме нет файла theme.css".into());
    }
    if css_len > MAX_CSS_BYTES {
        return Err("theme.css больше 512 КБ".into());
    }
    check_css(&std::fs::read_to_string(&css_file).map_err(|e| e.to_string())?)?;

    let target = safe_child(&root, &manifest.id)?;
    let staged = stage.keep();
    // The previous copy goes only once the new one is validated and staged.
    std::fs::remove_dir_all(&target).ok();
    std::fs::rename(&staged, &target).map_err(|e| {
        std::fs::remove_dir_all(&staged).ok();
        format!("не удалось установить тему: {e}")
    })?;

    Ok(InstalledTheme { manifest, dir: target.to_string_lossy().to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// css -> verdict. Themes are untrusted text that lands in a <style> tag;
    /// each case here is a way a pack could phone home or break out of it.
    #[test]
    fn css_guard_rejects_the_ways_out_of_a_style_tag() {
        let cases: [(&str, bool); 12] = [
            (":root{--m-bg:#000}", true),
            (".card{background:url(bg.png)}", true),
            (".card{background:url('./art/bg.png')}", true),
            (".card{background:url(\"data:image/png;base64,AAA\")}", true),
            ("@import url(https://evil.example/x.css);", false),
            ("@IMPORT 'x.css';", false),
            (".a{background:url(https://evil.example/pixel.png)}", false),
            (".a{background:url(//evil.example/pixel.png)}", false),
            (".a{background:url(file:///etc/passwd)}", false),
            (".a{background:url(\\68 ttps://evil.example/x)}", false),
            (".a{width:expression(alert(1))}", false),
            ("a{}</style><script>alert(1)</script>", false),
        ];
        for (css, want_ok) in cases {
            assert_eq!(
                check_css(css).is_ok(),
                want_ok,
                "CSS {css:?} must be {}: a theme cannot execute scripts under the app CSP, but a \
                 remote url() still reports every start of the launcher to its author, and a \
                 closing tag is the classic way out of an inline <style>",
                if want_ok { "accepted" } else { "rejected" },
            );
        }
    }

    /// css -> verdict. An identifier may be spelled with escapes and still parse
    /// as the same keyword, so a guard that only matches literal text lets the
    /// exact rules it blocks straight back in.
    #[test]
    fn escaped_spellings_of_the_blocked_keywords_are_caught() {
        let cases: [(&str, bool); 8] = [
            ("@\\69 mport url(https://evil.example/x.css);", false),
            ("@\\49\tmport 'https://evil.example/x.css';", false),
            (".a{background:\\75 rl(https://evil.example/p.png)}", false),
            (".a{background:u\\72 l(//evil.example/p.png)}", false),
            (".a{background:url(\\68 ttps://evil.example/x)}", false),
            (".a{width:expres\\73 ion(alert(1))}", false),
            (".a::after{content:\"\\2192\"}", true),
            (".a{background:url(art/bg.png)}", true),
        ];
        for (css, want_ok) in cases {
            assert_eq!(
                check_css(css).is_ok(),
                want_ok,
                "CSS {css:?} must be {}: CSS resolves escapes inside identifiers before it acts on \
                 them, so `@\\69 mport` fetches exactly like `@import` while reading as neither to \
                 a substring search",
                if want_ok { "accepted" } else { "rejected" },
            );
        }
    }

    /// input -> decoded. The guard reads the decoded text, so a wrong decoder is
    /// a hole in every check above.
    #[test]
    fn escape_decoding_follows_the_css_rules() {
        let cases: [(&str, &str); 6] = [
            ("\\69 mport", "import"),
            ("\\000069mport", "import"),
            ("\\49\tmport", "Import"),
            ("a\\\nb", "ab"),
            ("\\@media", "@media"),
            ("plain text", "plain text"),
        ];
        for (input, want) in cases {
            assert_eq!(
                decode_escapes(input),
                want,
                "{input:?} must decode to {want:?}: hex escapes take up to six digits and swallow \
                 one following whitespace, a backslash before a newline is a line continuation, \
                 and any other escaped character stands for itself",
            );
        }
    }

    #[test]
    fn commented_out_rules_do_not_trip_the_guard() {
        assert!(
            check_css("/* @import is not allowed, see docs */\n:root{--m-bg:#000}").is_ok(),
            "a mention of @import inside a comment is documentation, not a fetch; rejecting it \
             would make the error message impossible to explain in the theme itself",
        );
    }

    fn manifest(id: &str, base: &str) -> ThemeManifest {
        ThemeManifest {
            id: id.into(),
            name: "Тема".into(),
            author: String::new(),
            version: String::new(),
            description: String::new(),
            base: base.into(),
            preview: Vec::new(),
            options: Vec::new(),
        }
    }

    /// id -> verdict. The id becomes a directory name and a CSS attribute
    /// value, so anything but a slug either escapes the themes folder or
    /// breaks the selector the frontend writes.
    #[test]
    fn only_slug_ids_are_accepted() {
        for id in ["mario", "win98", "my-theme-2"] {
            assert!(validate_manifest(&manifest(id, "any")).is_ok(), "«{id}» is a plain slug");
        }
        for id in ["", "../evil", "Mario", "my theme", "-lead", "тема"] {
            assert!(
                validate_manifest(&manifest(id, "any")).is_err(),
                "«{id}» must be rejected: the id is used as a folder name under themes/ and as an \
                 attribute value in the injected stylesheet",
            );
        }
        assert!(
            validate_manifest(&manifest("ok", "neon")).is_err(),
            "an unknown base leaves the frontend without a palette to start the theme from",
        );
    }

    #[test]
    fn nested_pack_folder_is_stripped() {
        let names: Vec<String> =
            ["pack/theme.json", "pack/theme.css"].iter().map(|s| s.to_string()).collect();
        assert_eq!(common_prefix(&names), "pack/", "a pack zipped with its folder must still install");
        let flat: Vec<String> =
            ["theme.json", "theme.css"].iter().map(|s| s.to_string()).collect();
        assert_eq!(common_prefix(&flat), "", "a flat pack has nothing to strip");
        let mixed: Vec<String> =
            ["a/theme.json", "b/theme.css"].iter().map(|s| s.to_string()).collect();
        assert_eq!(mixed.len(), 2);
        assert_eq!(
            common_prefix(&mixed),
            "",
            "two top-level folders are not a wrapper; stripping one would scatter the pack",
        );
    }
}
