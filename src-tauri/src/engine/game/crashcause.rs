//! Улики из лога вылета: чей код упал и какой строкой это сказано.
//!
//! Два вопроса, на которые раньше отвечали поиском слова по всему логу.
//! «Виноват ли мод» решался по имени мода рядом со словом failed/exception в
//! ЛЮБОЙ строке — и мод, который сам поймал сетевую ошибку и честно написал о
//! ней WARN, отправлялся в карантин за чужой вылет (25.09.2026: «Косметика
//! Millida не запустилась» у 2432 игроков на всех версиях и загрузчиках).
//! «Что сломалось» не отвечалось вовсе: 3189 игроков получили «загляни в лог»,
//! а телеметрия — ничего.

/// Строка лога задаёт уровень для себя и для продолжения (стек, «Caused by»).
/// `Some(true)` — предупреждение/инфо: игра это пережила; `Some(false)` —
/// ошибка или отчёт о вылете; `None` — строка уровень не меняет.
fn sets_benign(line: &str) -> Option<bool> {
    let t = line.trim_start();
    let low = t.to_lowercase();
    if low.starts_with("---- ")
        || low.starts_with("-- ")
        || low.starts_with("description:")
        || low.starts_with("exception in thread")
        || low.starts_with("# a fatal error")
    {
        return Some(false);
    }
    if is_thread_dump_entry(t) {
        return Some(true);
    }
    if !t.starts_with('[') {
        return None;
    }
    let head: String = low.chars().take(160).collect();
    const BENIGN: [&str; 7] = ["/warn]", "/info]", "/debug]", "/trace]", "[warn]", "[info]", "[debug]"];
    const FATAL: [&str; 6] = ["/error]", "/fatal]", "[error]", "[fatal]", "[severe]", "/severe]"];
    if BENIGN.iter().any(|m| head.contains(m)) {
        return Some(true);
    }
    if FATAL.iter().any(|m| head.contains(m)) {
        return Some(false);
    }
    None
}

/// Header of one thread in a watchdog "Thread Dump" (`ThreadInfo.toString`):
/// `"millida-realtime" daemon prio=5 Id=51 RUNNABLE`. The dump lists every live
/// thread, so a frame under it is a bystander, not the code that failed.
fn is_thread_dump_entry(line: &str) -> bool {
    let t = line.strip_prefix("Threads: ").unwrap_or(line);
    let Some(rest) = t.strip_prefix('"') else {
        return false;
    };
    rest.contains("\" ") && (rest.contains(" Id=") || rest.contains(" prio="))
}

/// Строки вместе с признаком «это только предупреждение».
fn with_levels(text: &str) -> Vec<(&str, bool)> {
    let mut benign = false;
    text.lines()
        .map(|l| {
            if let Some(b) = sets_benign(l) {
                benign = b;
            }
            (l, benign)
        })
        .collect()
}

/// «at pkg.Class.method(File.java:1)» без модульного префикса Forge
/// («TRANSFORMER/minecraft@1.20.1/…») и Fabric («knot//…»).
fn frame_method(line: &str) -> Option<String> {
    let rest = line.trim_start().strip_prefix("at ")?;
    let call = rest.split('(').next().unwrap_or(rest).trim();
    let path = call.rsplit('/').next().unwrap_or(call);
    (!path.is_empty()).then(|| path.to_string())
}

/// Пакеты, которые сами по себе ничего не доказывают: игра, загрузчики, JDK.
/// Вылет проходит через них всегда, а отвечает первый кадр ПОСЛЕ них.
const FRAMEWORK: [&str; 21] = [
    "java.", "javax.", "jdk.", "sun.", "com.sun.", "net.minecraft.", "com.mojang.", "org.lwjgl.",
    "net.fabricmc.", "org.quiltmc.", "net.minecraftforge.", "net.neoforged.", "cpw.mods.",
    "org.spongepowered.", "com.google.", "it.unimi.", "io.netty.", "org.apache.", "com.llamalad7.",
    "oshi.", "org.slf4j.",
];

/// Мод, чей миксин влит в метод игры: «handler$zza000$millida$render».
fn mixin_owner(method: &str) -> Option<String> {
    let name = method.rsplit('.').next()?;
    let parts: Vec<&str> = name.split('$').collect();
    if parts.len() < 4 || parts[0].is_empty() || !parts[0].chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let tag = parts[1];
    let digits = tag.chars().rev().take(3).filter(|c| c.is_ascii_digit()).count();
    if !(4..=8).contains(&tag.len()) || digits != 3 || parts[2].is_empty() {
        return None;
    }
    Some(parts[2].to_lowercase())
}

/// Опознавательные знаки мода в логе.
pub(crate) struct ModMarks {
    /// Mod id, как его пишут загрузчики.
    pub id: &'static str,
    /// Пакеты классов (в точечной и слэшевой записи).
    pub packages: &'static [&'static str],
    /// Прочие знаки в строке: конфиг миксинов, имя файла.
    pub files: &'static [&'static str],
}

pub(crate) const OWN_MOD: ModMarks = ModMarks {
    id: "millida",
    packages: &["net.millida.", "net/millida/", "millidaforge"],
    files: &["millida.mixins", "millida-mod-"],
};

pub(crate) const SKIN_MOD: ModMarks = ModMarks {
    id: "customskinloader",
    packages: &["customskinloader.", "customskinloader/"],
    files: &["customskinloader"],
};

enum FrameOwner {
    Ours,
    Foreign,
    Framework,
}

fn frame_owner(method: &str, marks: &ModMarks) -> FrameOwner {
    let low = method.to_lowercase();
    if let Some(owner) = mixin_owner(&low) {
        return if owner == marks.id { FrameOwner::Ours } else { FrameOwner::Foreign };
    }
    if marks.packages.iter().any(|p| low.contains(p)) {
        return FrameOwner::Ours;
    }
    if FRAMEWORK.iter().any(|p| low.starts_with(p)) {
        return FrameOwner::Framework;
    }
    FrameOwner::Foreign
}

const MIXIN_FAILURES: [&str; 7] = [
    "mixin apply failed",
    "mixinapplyerror",
    "mixintransformererror",
    "mixinprepareerror",
    "invalidinjectionexception",
    "injectionerror",
    "critical injection failure",
];

const CLASS_FAILURES: [&str; 3] = ["unsupportedclassversionerror", "noclassdeffounderror", "classnotfoundexception"];

/// Упал ли именно этот мод.
///
/// Уликой считается только то, что называет мод ВИНОВНИКОМ:
/// - первый не-служебный кадр стека ошибки — его код (или его миксин);
/// - не лёгший миксин из его конфига;
/// - его классы не загрузились (байткод новее Java, класса нет);
/// - загрузчик сам назвал его: «provided by 'id'», «(id) has failed to load».
///
/// Стек под WARN/INFO — это ошибка, которую кто-то поймал и пережил; мод,
/// сообщивший о своей сетевой неудаче, вылет не вызывал.
pub(crate) fn mod_implicated(text: &str, marks: &ModMarks) -> bool {
    let quoted = format!("'{}'", marks.id);
    let failed_to_load = format!("({}) has failed to load", marks.id);
    // Кадр в самом начале текста (обрезанный хвост лога) тоже решает.
    let mut deciding = true;
    let mut block_benign = false;
    for (line, benign) in with_levels(text) {
        if let Some(method) = frame_method(line) {
            if !deciding {
                continue;
            }
            match frame_owner(&method, marks) {
                FrameOwner::Framework => {}
                FrameOwner::Ours => {
                    if !block_benign {
                        return true;
                    }
                    deciding = false;
                }
                FrameOwner::Foreign => deciding = false,
            }
            continue;
        }
        let low = line.to_lowercase();
        if low.trim().is_empty() {
            continue;
        }
        // Новая строка-заголовок: следующий стек решается заново.
        deciding = true;
        block_benign = benign;
        let named = marks.packages.iter().chain(marks.files.iter()).any(|m| low.contains(m));
        // Байткод новее Java валит мод на любом уровне лога: это та самая
        // поломка 16.09.2026, после которой не запускалась ни одна сборка.
        if named && low.contains("unsupportedclassversionerror") {
            return true;
        }
        if benign {
            continue;
        }
        if named && CLASS_FAILURES.iter().any(|m| low.contains(m)) {
            return true;
        }
        if named && MIXIN_FAILURES.iter().any(|m| low.contains(m)) {
            return true;
        }
        if low.contains(&format!("provided by {}", quoted))
            || (low.contains("entrypoint") && low.contains(&quoted))
            || low.contains(&failed_to_load)
        {
            return true;
        }
    }
    false
}

/// Строка — исключение Java: «java.lang.IllegalStateException: …»,
/// «Caused by: net.foo.BarError», «Exception in thread "main" …».
pub(crate) fn is_exception_line(line: &str) -> bool {
    let t = line.trim();
    if t.starts_with("at ") || t.is_empty() {
        return false;
    }
    t.split(|c: char| c.is_whitespace() || c == ':' || c == '(' || c == '[')
        .any(|tok| {
            let tok = tok.trim_matches(|c: char| !c.is_alphanumeric() && c != '.' && c != '$' && c != '_');
            tok.contains('.')
                && !tok.starts_with('.')
                && (tok.ends_with("Exception") || tok.ends_with("Error") || tok.ends_with("Throwable"))
        })
}

/// Сообщение без префикса лога «[12:00:00] [Render thread/ERROR]: ».
fn message_of(line: &str) -> &str {
    let t = line.trim();
    if t.starts_with('[') {
        let head_end = t.char_indices().nth(220).map(|(i, _)| i).unwrap_or(t.len());
        if let Some(i) = t[..head_end].rfind("]: ") {
            return t[i + 3..].trim();
        }
    }
    t.trim_start_matches('#').trim()
}

/// Корень цепочки: последний «Caused by» стека, начатого строкой `from`.
fn root_cause<'a>(lines: &[&'a str], from: usize) -> Option<&'a str> {
    let mut root = None;
    for l in lines.iter().skip(from + 1) {
        let t = l.trim();
        if t.starts_with("at ") || t.starts_with("... ") || t.is_empty() {
            continue;
        }
        if t.starts_with("Caused by:") {
            root = Some(*l);
            continue;
        }
        if t.starts_with("Suppressed:") {
            continue;
        }
        break;
    }
    root
}

/// Строки загрузчика, отказавшегося собрать моды.
/// Fabric lists optional mods it would like as "recommends …, which is missing!"
/// under a WARN and starts anyway: such a line is never why the game stopped.
pub(crate) fn is_recommendation(low: &str) -> bool {
    low.contains(" recommends ")
}

fn is_resolution_line(low: &str) -> bool {
    if is_recommendation(low) {
        return false;
    }
    low.contains("requested by:")
        || (low.contains("requires") && low.contains("mod '"))
        || low.contains(", which is missing")
        || low.contains("but only the wrong version is present")
}

/// Первая осмысленная причина вылета, как её сказала сама игра. Сырая, до
/// маскировки: вызывающий обязан пропустить её через `scrub_cause`.
pub(crate) fn crash_cause(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let levels = with_levels(text);
    let mut pieces: Vec<String> = vec![];
    let push = |pieces: &mut Vec<String>, s: &str| {
        let s = message_of(s).to_string();
        if !s.is_empty() && !pieces.contains(&s) && pieces.len() < 2 {
            pieces.push(s);
        }
    };

    // Загрузчик отказался собрать моды: его строки и есть причина.
    for l in &lines {
        if is_resolution_line(&l.to_lowercase()) {
            push(&mut pieces, l);
        }
    }
    if !pieces.is_empty() {
        return pieces.join(" | ");
    }

    // Отчёт JVM о нативном падении: код исключения и кадр.
    if let Some(i) = lines.iter().position(|l| l.contains("# Problematic frame:")) {
        if let Some(code) = lines.iter().find(|l| {
            let t = l.trim_start_matches('#').trim();
            t.starts_with("EXCEPTION_") || t.starts_with("SIG") || t.starts_with("Internal Error") || t.starts_with("Out of Memory")
        }) {
            let code = code.trim_start_matches('#').trim();
            push(&mut pieces, code.split(" at pc=").next().unwrap_or(code));
        }
        if let Some(frame) = lines.get(i + 1) {
            push(&mut pieces, frame);
        }
        return pieces.join(" | ");
    }

    // Отчёт о вылете: исключение после «Description:» и корень его цепочки.
    if let Some(d) = lines.iter().rposition(|l| l.trim_start().starts_with("Description:")) {
        if let Some(off) = lines[d + 1..].iter().take(8).position(|l| is_exception_line(l)) {
            let at = d + 1 + off;
            push(&mut pieces, lines[at]);
            if let Some(root) = root_cause(&lines, at) {
                push(&mut pieces, root);
            }
            return pieces.join(" | ");
        }
    }

    // Необработанное исключение потока или первое исключение не под WARN/INFO.
    let thrown = lines
        .iter()
        .position(|l| l.trim_start().starts_with("Exception in thread"))
        .or_else(|| levels.iter().position(|(l, benign)| !benign && is_exception_line(l)));
    if let Some(at) = thrown {
        push(&mut pieces, lines[at]);
        if let Some(root) = root_cause(&lines, at) {
            push(&mut pieces, root);
        }
        return pieces.join(" | ");
    }

    // Загрузчик написал FATAL/ERROR без исключения.
    let loud = |m: &str| lines.iter().find(|l| l.to_lowercase().contains(m));
    if let Some(l) = loud("/fatal]").or_else(|| lines.iter().rev().find(|l| l.to_lowercase().contains("/error]"))) {
        push(&mut pieces, l);
        return pieces.join(" | ");
    }

    // Иначе — последняя строка, которая не кадр стека.
    if let Some(l) = lines.iter().rev().find(|l| !l.trim().is_empty() && frame_method(l).is_none()) {
        push(&mut pieces, l);
    }
    pieces.join(" | ")
}

pub(crate) const CAUSE_MAX: usize = 300;

/// Причина уходит в телеметрию: домашняя папка → «~», имя сборки и ник
/// вырезаны, токен скрыт, длина — не больше `CAUSE_MAX` символов.
pub(crate) fn scrub_cause(raw: &str, home: Option<&str>, nick: &str) -> String {
    let mut out = crate::engine::redact_log(raw, home);
    // Имя сборки — личное (аудит 24.09.2026): «profiles/Моя сборка/mods/x.jar».
    for sep in ['/', '\\'] {
        let key = format!("profiles{}", sep);
        let mut rebuilt = String::with_capacity(out.len());
        let mut rest = out.as_str();
        while let Some(i) = rest.find(&key) {
            let after = i + key.len();
            rebuilt.push_str(&rest[..after]);
            let tail = &rest[after..];
            let end = tail.find(['/', '\\', '\'', '"', ',', ')', ']', '\n']).unwrap_or(tail.len());
            rebuilt.push_str("<build>");
            rest = &tail[end..];
        }
        rebuilt.push_str(rest);
        out = rebuilt;
    }
    let nick = nick.trim();
    if nick.chars().count() >= 3 {
        out = replace_ci(&out, nick, "<nick>");
    }
    for key in ["token:", "accessToken=", "access_token="] {
        out = hide_after(&out, key);
    }
    let out = out.split_whitespace().collect::<Vec<_>>().join(" ");
    out.chars().take(CAUSE_MAX).collect()
}

fn replace_ci(text: &str, needle: &str, with: &str) -> String {
    let low = text.to_lowercase();
    let want = needle.to_lowercase();
    // Нижний регистр меняет длину у части символов: тогда просто точная замена.
    if low.len() != text.len() || want.len() != needle.len() {
        return text.replace(needle, with);
    }
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for (i, _) in low.match_indices(&want) {
        out.push_str(&text[last..i]);
        out.push_str(with);
        last = i + want.len();
    }
    out.push_str(&text[last..]);
    out
}

fn hide_after(text: &str, key: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find(key) {
        let after = i + key.len();
        out.push_str(&rest[..after]);
        let tail = &rest[after..];
        let end = tail.find([' ', ',', '&', '"', '\'', ']', ')', '\n']).unwrap_or(tail.len());
        if end > 0 {
            out.push_str("<hidden>");
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

/// A mod as a loader names it: `name` is what it quoted (a title on Fabric and
/// Quilt, the id on Forge and NeoForge), `id` the mod id.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ModRef {
    pub name: String,
    pub id: String,
}

impl ModRef {
    fn same(name: &str) -> Self {
        Self { name: name.to_string(), id: name.to_lowercase() }
    }
}

/// What a loader said stopped it, one line at a time. `range` is always in the
/// predicate syntax of `version_satisfies` (`>=1.2 <2`, `*`), whatever notation
/// the loader printed.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum LoaderFinding {
    /// `by` needs `dep` in `range`; `present` is the version found, `None`
    /// when it is not installed at all.
    Requires { by: ModRef, dep: ModRef, range: String, present: Option<String> },
    /// `by` refuses to run next to `other`.
    Incompatible { by: ModRef, other: ModRef },
    /// The mixins of `by` did not apply.
    MixinFailed { by: ModRef },
    /// A jar in mods/ built for another loader.
    WrongLoader { file: String, loader: String },
    /// One mod id in several files.
    Duplicate { id: String, files: Vec<String> },
}

/// Requirements that are about the game or the loader rather than a mod: the
/// jar is built for another version, and no download of a mod satisfies them.
pub(crate) fn is_platform_id(id: &str) -> bool {
    matches!(
        id,
        "minecraft" | "java" | "fabricloader" | "fabric-loader" | "quilt_loader" | "quilt-loader" | "forge" | "neoforge" | "javafml" | "fml"
    )
}

/// Every `'…'` in the text with what follows it: `(id)` right after the quote
/// makes it a title with an id, as Fabric and Quilt print mods.
fn quoted_ref(s: &str) -> Option<(ModRef, &str)> {
    let start = s.find('\'')? + 1;
    let end = s[start..].find('\'')? + start;
    let name = s[start..end].trim();
    if name.is_empty() || name.len() > 80 {
        return None;
    }
    let rest = &s[end + 1..];
    let trimmed = rest.trim_start();
    if let Some(inner) = trimmed.strip_prefix('(') {
        if let Some(close) = inner.find(')') {
            let id = inner[..close].trim();
            if !id.is_empty() && id.len() <= 64 && !id.contains(' ') {
                let consumed = rest.len() - trimmed.len() + close + 2;
                return Some((ModRef { name: name.to_string(), id: id.to_lowercase() }, &rest[consumed..]));
            }
        }
    }
    Some((ModRef::same(name), rest))
}

/// The mod after « of »: `mod 'Sodium' (sodium)`, `'Sodium' (sodium)` or a bare
/// id as Fabric prints a mod that is not installed (`fabric-api, which…`).
fn target_ref(s: &str) -> Option<(ModRef, &str)> {
    let t = s.trim_start();
    let t = t.strip_prefix("mod ").unwrap_or(t);
    if t.starts_with('\'') {
        return quoted_ref(t);
    }
    let end = t.find([',', '!', ' ', ';']).unwrap_or(t.len());
    let id = t[..end].trim();
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    ok.then(|| (ModRef::same(id), &t[end..]))
}

fn bump(v: &str) -> String {
    v.parse::<u64>().map(|n| (n + 1).to_string()).unwrap_or_else(|_| v.to_string())
}

/// A Maven range as Forge and NeoForge print it (`[5.8.1,)`, `[1.20,1.21)`,
/// `[1.0]`, a bare `1.0`) in the predicate syntax. A bare version is Maven's
/// «recommended» — any version passes it, the named one is only preferred.
pub(crate) fn maven_range(spec: &str) -> String {
    let s = spec.trim();
    let first = match s.find("],").or_else(|| s.find("),")) {
        Some(i) => &s[..=i],
        None => s,
    };
    let (open, close) = (first.chars().next(), first.chars().last());
    if !matches!(open, Some('[') | Some('(')) || !matches!(close, Some(']') | Some(')')) {
        return if first.is_empty() { "*".into() } else { format!(">={}", first) };
    }
    let inner = &first[1..first.len() - 1];
    let Some((lo, hi)) = inner.split_once(',') else {
        return format!("={}", inner.trim());
    };
    let mut parts: Vec<String> = vec![];
    if !lo.trim().is_empty() {
        parts.push(format!("{}{}", if open == Some('[') { ">=" } else { ">" }, lo.trim()));
    }
    if !hi.trim().is_empty() {
        parts.push(format!("{}{}", if close == Some(']') { "<=" } else { "<" }, hi.trim()));
    }
    if parts.is_empty() { "*".into() } else { parts.join(" ") }
}

/// The version phrase of a Fabric or Quilt requirement in predicate syntax.
pub(crate) fn phrase_range(phrase: &str) -> String {
    let p = phrase.trim().trim_end_matches(',');
    let tok = |s: &str| s.split_whitespace().next().unwrap_or("").to_string();
    if p.is_empty() || p == "any version" {
        return "*".into();
    }
    if let Some(rest) = p.strip_prefix("any version between ") {
        let (a, b) = rest.split_once(" and ").unwrap_or((rest, ""));
        let lo = if a.contains("(exclusive)") { ">" } else { ">=" };
        let hi = if b.contains("(exclusive)") { "<" } else { "<=" };
        return format!("{}{} {}{}", lo, tok(a), hi, tok(b));
    }
    for (prefix, op) in [
        ("any version after ", ">"),
        ("any version above ", ">"),
        ("any version before ", "<"),
        ("any version below ", "<"),
        ("at least version ", ">="),
        ("a version in the range ", ""),
    ] {
        if let Some(rest) = p.strip_prefix(prefix) {
            return if op.is_empty() { maven_range(rest) } else { format!("{}{}", op, tok(rest)) };
        }
    }
    if let Some(rest) = p.strip_prefix("any ").and_then(|r| r.strip_suffix(" version")) {
        let nums: Vec<&str> = rest.trim_end_matches(".x").split('.').collect();
        return match nums.as_slice() {
            [major] => format!(">={} <{}", major, bump(major)),
            [major, minor] => format!(">={}.{} <{}.{}", major, minor, major, bump(minor)),
            _ => "*".into(),
        };
    }
    if let Some(rest) = p.strip_prefix("version ") {
        let v = tok(rest);
        if rest.contains("or later") || rest.contains("or any newer") {
            return format!(">={}", v);
        }
        if rest.contains("or earlier") || rest.contains("or any earlier") {
            return format!("<={}", v);
        }
        if v.starts_with(['>', '<', '=', '~', '^']) {
            return v;
        }
        return format!("={}", v);
    }
    "*".into()
}

/// Fabric/Quilt: «Mod 'Iris' (iris) 1.7.0 requires version 0.5.8 or later of
/// mod 'Sodium' (sodium), but only the wrong version is present: 0.5.3!».
fn fabric_requirement(line: &str) -> Option<LoaderFinding> {
    let low = line.to_lowercase();
    if is_recommendation(&low) {
        return None;
    }
    let (verb, is_break) = [(" is incompatible with ", true), (" breaks with ", true), (" requires ", false)]
        .into_iter()
        .find(|(v, _)| line.contains(v))?;
    let at = line.find(verb)?;
    let (by, _) = quoted_ref(&line[..at])?;
    let rest = &line[at + verb.len()..];
    let of = rest.find(" of ");
    let (dep, tail) = target_ref(of.map(|i| &rest[i + 4..]).unwrap_or(rest))?;
    if is_break {
        return Some(LoaderFinding::Incompatible { by, other: dep });
    }
    let of = of?;
    let phrase = rest[..of].trim_start_matches("transitively ").trim();
    let present = tail.find("present: ").map(|i| {
        tail[i + "present: ".len()..].trim().trim_end_matches('!').split(',').next().unwrap_or("").trim().to_string()
    });
    Some(LoaderFinding::Requires { by, dep, range: phrase_range(phrase), present })
}

/// Forge 1.13+ and NeoForge: «Mod ID: 'craftedcore', Requested by: 'walkers',
/// Expected range: '[5.8.1,)', Actual version: '[MISSING]'».
fn forge_requirement(line: &str) -> Option<LoaderFinding> {
    let field = |key: &str| -> Option<String> {
        let rest = &line[line.find(key)? + key.len()..];
        let start = rest.find('\'')? + 1;
        let end = rest[start..].find('\'')? + start;
        Some(rest[start..end].trim().to_string())
    };
    let dep = field("Mod ID:")?;
    let by = field("Requested by:")?;
    let range = field("Expected range:").map(|r| maven_range(&r)).unwrap_or_else(|| "*".into());
    let present = field("Actual version:").filter(|v| !v.eq_ignore_ascii_case("[missing]") && !v.eq_ignore_ascii_case("null"));
    Some(LoaderFinding::Requires { by: ModRef::same(&by), dep: ModRef::same(&dep), range, present })
}

/// Forge 1.12: «Mod jeresources (Just Enough Resources) requires [jei@[4.15,)]».
fn legacy_forge_requirements(line: &str, out: &mut Vec<LoaderFinding>) {
    let Some(at) = line.find(" requires ") else { return };
    let Some(open) = line[at..].find('[').map(|i| at + i) else { return };
    let head = &line[..at];
    let Some(mod_at) = head.rfind("mod ").max(head.rfind("Mod ")) else { return };
    let by = line[mod_at + 4..at].split_whitespace().next().unwrap_or("");
    if by.is_empty() || by.contains('\'') {
        return;
    }
    let Some(close) = line.rfind(']') else { return };
    if close <= open {
        return;
    }
    let list = &line[open + 1..close];
    let mut depth = 0i32;
    let mut item = String::new();
    let mut items: Vec<String> = vec![];
    for c in list.chars() {
        match c {
            '[' | '(' => depth += 1,
            ']' | ')' => depth -= 1,
            ',' if depth == 0 => {
                items.push(std::mem::take(&mut item));
                continue;
            }
            _ => {}
        }
        item.push(c);
    }
    items.push(item);
    for it in items {
        let it = it.trim();
        let Some((id, range)) = it.split_once('@') else { continue };
        let id = id.trim();
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')) {
            continue;
        }
        out.push(LoaderFinding::Requires { by: ModRef::same(by), dep: ModRef::same(id), range: maven_range(range), present: None });
    }
}

/// NeoForge: «Mod 'iris' is incompatible with 'embeddium', versions: '[0,)'».
fn forge_incompatibility(line: &str) -> Option<LoaderFinding> {
    let t = line.trim_start().trim_start_matches(['-', '\t', ' ']);
    let rest = t.strip_prefix("Mod '")?;
    let (by, after) = rest.split_once('\'')?;
    let after = after.trim_start();
    let other = after.strip_prefix("is incompatible with '")?.split('\'').next()?;
    (!by.is_empty() && !other.is_empty()).then(|| LoaderFinding::Incompatible { by: ModRef::same(by), other: ModRef::same(other) })
}

/// «Mixin apply for mod sodium failed sodium.mixins.json:…», «Mixin apply
/// failed iris.mixins.json:…», NeoForge «Mixin application of X from Name (id)
/// has failed» and the «from mod id» Mixin adds to injection errors.
fn mixin_owner_of(line: &str) -> Option<ModRef> {
    let low = line.to_lowercase();
    if !MIXIN_FAILURES.iter().any(|m| low.contains(m)) && !low.contains("mixin application of") && !low.contains("mixin apply for mod ") {
        return None;
    }
    let word_after = |key: &str| -> Option<String> {
        let rest = &low[low.find(key)? + key.len()..];
        let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')).collect();
        (!id.is_empty()).then_some(id)
    };
    if let Some(id) = word_after("mixin apply for mod ").or_else(|| word_after(" from mod ")) {
        return Some(ModRef::same(&id));
    }
    if low.contains("mixin application of") {
        if let Some(open) = low.rfind(" (") {
            let id: String = low[open + 2..].chars().take_while(|c| *c != ')').collect();
            if !id.is_empty() && !id.contains(' ') {
                return Some(ModRef::same(&id));
            }
        }
    }
    let cfg_at = low.find(".mixins.json").or_else(|| low.find(".mixin.json"))?;
    let head = &low[..cfg_at];
    let start = head.rfind(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))).map(|i| i + 1).unwrap_or(0);
    let cfg = &head[start..];
    let id = cfg.split(['.', '-']).next().unwrap_or("");
    (!id.is_empty()).then(|| ModRef::same(id))
}

/// «File mods/x.jar is a Fabric mod and cannot be loaded» (NeoForge, Forge).
fn wrong_loader_of(line: &str) -> Option<LoaderFinding> {
    let at = line.find("File ")?;
    let rest = &line[at + 5..];
    let (marker, loader) = [
        (" is a Fabric mod and cannot be loaded", "fabric"),
        (" is a Quilt mod and cannot be loaded", "quilt"),
        (" is for Minecraft Forge", "forge"),
        (" is for an old version of Minecraft Forge", "forge"),
        (" is a LiteLoader mod", "liteloader"),
    ]
    .into_iter()
    .find(|(m, _)| rest.contains(m))?;
    let path = rest[..rest.find(marker)?].trim().trim_matches(['\'', '"']);
    let file = path.rsplit(['/', '\\']).next().unwrap_or(path).to_string();
    (!file.is_empty()).then(|| LoaderFinding::WrongLoader { file, loader: loader.into() })
}

/// Forge «Mod ID: 'jei' from mod files: a.jar, b.jar», NeoForge «Mod jei is
/// present in multiple files: a.jar, b.jar», Quilt «Duplicate mod: jei».
fn duplicate_of(line: &str) -> Option<LoaderFinding> {
    let files = |list: &str| -> Vec<String> {
        list.split(',')
            .map(|f| f.trim().trim_matches(['\'', '"', '.']).rsplit(['/', '\\']).next().unwrap_or("").to_string())
            .filter(|f| !f.is_empty())
            .collect()
    };
    if let Some(i) = line.find(" from mod files: ") {
        let id = line[..i].rsplit('\'').nth(1).unwrap_or("").to_lowercase();
        return (!id.is_empty()).then(|| LoaderFinding::Duplicate { id, files: files(&line[i + 17..]) });
    }
    if let Some(i) = line.find(" is present in multiple files: ") {
        let id = line[..i].rsplit(' ').next().unwrap_or("").to_lowercase();
        return (!id.is_empty()).then(|| LoaderFinding::Duplicate { id, files: files(&line[i + 31..]) });
    }
    let low = line.to_lowercase();
    for key in ["duplicate mod: ", "found a duplicate mod: "] {
        if let Some(i) = low.find(key) {
            let id: String = low[i + key.len()..].chars().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')).collect();
            return (!id.is_empty()).then(|| LoaderFinding::Duplicate { id, files: vec![] });
        }
    }
    None
}

fn push(f: LoaderFinding, out: &mut Vec<LoaderFinding>) {
    if !out.contains(&f) {
        out.push(f);
    }
}

/// NeoForge colours its messages with Minecraft formatting codes («§e»).
fn strip_formatting(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        if c == '§' {
            chars.next();
        } else {
            out.push(c);
        }
    }
    out
}

/// Every refusal a loader printed, in the order it printed them, without
/// repeats. A line under WARN/INFO is something the game lived through, so it
/// never becomes a finding — except the Fabric/Forge requirement listings,
/// which follow their ERROR header without a level of their own.
pub(crate) fn loader_findings(text: &str) -> Vec<LoaderFinding> {
    let mut out: Vec<LoaderFinding> = vec![];
    let mut optional_block = false;
    for (raw, benign) in with_levels(text) {
        let clean = strip_formatting(raw);
        let line = clean.as_str();
        if line.contains("optional dependencies:") {
            optional_block = true;
        } else if line.contains("mandatory dependencies:") || line.trim_start().starts_with('[') {
            optional_block = false;
        }
        if line.contains("Requested by:") {
            if optional_block {
                continue;
            }
            if let Some(f) = forge_requirement(line) {
                push(f, &mut out);
            }
            continue;
        }
        let low = line.to_lowercase();
        if benign && line.trim_start().starts_with('[') {
            continue;
        }
        if let Some(f) = duplicate_of(line) {
            push(f, &mut out);
            continue;
        }
        if let Some(f) = wrong_loader_of(line) {
            push(f, &mut out);
            continue;
        }
        if let Some(f) = forge_incompatibility(line) {
            push(f, &mut out);
            continue;
        }
        if low.contains(" requires ") && low.contains('@') && low.contains('[') && !low.contains("mod '") {
            let mut legacy = vec![];
            legacy_forge_requirements(line, &mut legacy);
            for f in legacy {
                push(f, &mut out);
            }
            continue;
        }
        if (low.contains(" requires ") || low.contains(" is incompatible with ") || low.contains(" breaks with ")) && low.contains('\'') {
            if let Some(f) = fabric_requirement(line) {
                push(f, &mut out);
                continue;
            }
        }
        if let Some(by) = mixin_owner_of(line) {
            push(LoaderFinding::MixinFailed { by }, &mut out);
        }
    }
    out
}

/// Minecraft catches an exception that escapes its game loop, logs it and lets
/// `main` return, so the process can exit with code 0 after a crash on startup.
/// These lines are printed only on that path, never on a normal quit.
const CRASH_MARKERS: [&str; 7] = [
    "unhandled game exception",
    "reported exception thrown",
    "unreported exception thrown",
    "#@!@# game crashed",
    "shutdown failure",
    "minecraft has crashed",
    "---- minecraft crash report ----",
];

pub(crate) fn reports_crash(text: &str) -> bool {
    let low = text.to_lowercase();
    CRASH_MARKERS.iter().any(|m| low.contains(m))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_crash_is_recognised_even_when_the_exit_code_says_success() {
        let cases: &[(&str, bool, &str)] = &[
            (
                "[09:46:03] [Render thread/ERROR]: Unhandled game exception\njava.lang.RuntimeException: boom\nCaused by: java.lang.NullPointerException: No fabric renderer found",
                true,
                "Supplementaries без Indium на macOS: игра вышла с кодом 0, окно вылета не появилось",
            ),
            (
                "[09:46:03] [Render thread/ERROR]: Shutdown failure!\njava.util.ConcurrentModificationException",
                true,
                "сбой при закрытии после вылета тоже вылет",
            ),
            ("[12:00:00] [Render thread/FATAL]: Reported exception thrown!", true, "классический отчёт о вылете"),
            ("#@!@# Game crashed! Crash report saved to: #@!@# crash-reports/crash.txt", true, "строка отчёта в stdout"),
            ("---- Minecraft Crash Report ----\n// Oops", true, "свежий файл crash-reports"),
            (
                "[12:00:00] [Render thread/INFO]: Stopping!\n[12:00:01] [Render thread/INFO]: Saving worlds",
                false,
                "обычный выход кнопкой не вылет",
            ),
            (
                "[12:00:00] [Worker/WARN]: Could not fetch skin: java.net.SocketTimeoutException: Read timed out",
                false,
                "пойманное модом исключение не вылет",
            ),
            ("", false, "пустой лог при коде 0 — игрок закрыл игру"),
        ];
        for (log, want, why) in cases {
            assert_eq!(
                reports_crash(log),
                *want,
                "вылет с кодом 0 распознан неверно — игрок не увидит окно «Игра вылетела» или увидит его после обычного выхода. Случай: {why}",
            );
        }
    }

    /// вход → вердикт: за что косметика уходит в карантин, а за что нет.
    #[test]
    fn only_our_code_at_the_top_of_a_real_failure_blames_our_mod() {
        let cases: &[(&str, bool, &str)] = &[
            (
                "[12:00:01] [Render thread/WARN] [net.millida.mod.net.SkinFetch/]: Could not fetch skin: java.net.SocketTimeoutException: Read timed out\n\
                 \tat java.net.Socket.read(Socket.java:1)\n\
                 \tat net.millida.mod.net.SkinFetch.get(SkinFetch.java:40)\n\
                 [12:05:00] [Render thread/ERROR]: Reported exception thrown!\n\
                 java.lang.NullPointerException: Cannot invoke \"Object.hashCode()\"\n\
                 \tat net.irisshaders.iris.pipeline.Pipeline.render(Pipeline.java:10)",
                false,
                "наш мод сам поймал сетевую ошибку и написал WARN — а упал Iris; раньше это отключало косметику (Forge пишет имя класса в имени логгера)",
            ),
            (
                "java.lang.IllegalStateException: boom\n\
                 \tat net.minecraft.client.renderer.entity.PlayerRenderer.render(PlayerRenderer.java:1)\n\
                 \tat net.minecraft.client.renderer.entity.PlayerRenderer.handler$zza000$millida$renderCape(PlayerRenderer.java:2)",
                true,
                "наш миксин влит в метод игры — первый не-служебный кадр наш",
            ),
            (
                "java.lang.IllegalStateException: boom\n\
                 \tat net.minecraft.client.renderer.entity.PlayerRenderer.handler$zzb000$sodium$render(PlayerRenderer.java:2)\n\
                 \tat net.millida.mod.cosmetics.CosmeticRenderer.render(CosmeticRenderer.java:88)",
                false,
                "первым отвечает чужой миксин (sodium), наш кадр ниже по стеку — не улика",
            ),
            (
                "---- Minecraft Crash Report ----\nDescription: Rendering entity\n\njava.lang.NullPointerException\n\
                 \tat TRANSFORMER/millida@0.1.11/net.millida.mod.cosmetics.CosmeticRenderer.render(CosmeticRenderer.java:88)",
                true,
                "отчёт о вылете Forge: кадр с модульным префиксом, код наш",
            ),
            (
                "[main/ERROR]: Could not execute entrypoint stage 'client' due to errors, provided by 'millida' at 'net.millida.mod.MillidaMod'!",
                true,
                "Fabric сам назвал наш мод",
            ),
            (
                "[main/INFO]: Loading 92 mods:\n\t- millida 0.1.11\n[main/WARN]: Error loading class: net/millida/compat/IrisCompat (java.lang.ClassNotFoundException: net/millida/compat/IrisCompat)",
                false,
                "WARN миксина про необязательную совместимость — игра это переживает",
            ),
            (
                "---- Minecraft Crash Report ----\n\
                 // Why did you do that?\n\n\
                 Description: Client shutdown from post-main\n\n\
                 java.lang.Error: Watchdog\n\n\n\
                 -- Thread Dump --\n\
                 Details:\n\
                 \tThreads: \"Reference Handler\" daemon prio=10 Id=9 RUNNABLE\n\
                 \tat java.base@21.0.7/java.lang.ref.Reference.waitForReferencePendingList(Native Method)\n\n\n\
                 \"millida-realtime-reader\" daemon prio=5 Id=58 RUNNABLE (in native)\n\
                 \tat java.base@21.0.7/sun.nio.ch.SocketDispatcher.read0(Native Method)\n\
                 \tat java.base@21.0.7/sun.nio.ch.NioSocketImpl.read(NioSocketImpl.java:309)\n\
                 \tat net.millida.core.realtime.WebSocketClient$1.run(WebSocketClient.java:270)\n\
                 \t-  locked java.lang.Object@1b2c3d\n\
                 \tat java.base@21.0.7/java.lang.Thread.run(Thread.java:1583)\n\n\
                 \"millida-voice-udp\" daemon prio=5 Id=61 RUNNABLE\n\
                 \tat java.base@21.0.7/sun.nio.ch.DatagramChannelImpl.receive0(Native Method)\n\
                 \tat net.millida.core.voice.net.VoiceConnection.run(VoiceConnection.java:120)\n\n\
                 -- System Details --\n\
                 Details:\n\
                 \tMinecraft Version: 26.2",
                false,
                "сторож выхода (07.10.2026, Sw1ftCore) печатает стеки ВСЕХ живых потоков — наш поток в дампе свидетель, а не виновник; раньше это отключало косметику ~60 игрокам в день",
            ),
            (
                "-- Thread Dump --\n\
                 Details:\n\
                 \tThreads: \"millida-net-1\" daemon prio=5 Id=40 WAITING\n\
                 \tat net.millida.core.platform.ThreadPoolScheduler$1.run(ThreadPoolScheduler.java:25)\n\n\
                 -- System Details --\n\
                 [12:05:00] [Render thread/ERROR]: Reported exception thrown!\n\
                 java.lang.IllegalStateException: boom\n\
                 \tat net.millida.mod.cosmetics.CosmeticRenderer.render(CosmeticRenderer.java:88)",
                true,
                "после дампа потоков настоящий стек ошибки с нашим кадром наверху по-прежнему улика",
            ),
        ];
        for (text, want, why) in cases {
            assert_eq!(mod_implicated(text, &OWN_MOD), *want, "{why}\n{text}");
        }
    }

    /// Причина — то, ради чего телеметрия вообще нужна для «загляни в лог».
    #[test]
    fn cause_is_the_first_meaningful_error_line() {
        let cases: &[(&str, &str, &str)] = &[
            (
                "[12:00:00] [main/INFO]: Loading 12 mods\n\
                 [12:00:01] [main/ERROR]: Incompatible mods found!\n\
                 net.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!\n\
                 \t - Mod 'Sodium' (sodium) 0.6.0 requires version 1.21.4 of minecraft, but only the wrong version is present: 1.21.1!",
                "Mod 'Sodium' (sodium) 0.6.0 requires version 1.21.4 of minecraft",
                "Fabric: строка отказа загрузчика",
            ),
            (
                "[25сент.2026 13:29:03.409] [main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:\n\
                 \tMod ID: 'craftedcore', Requested by: 'walkers', Expected range: '[5.8.1,)', Actual version: '[MISSING]'",
                "Mod ID: 'craftedcore', Requested by: 'walkers'",
                "Forge: какой мод чего требует",
            ),
            (
                "---- Minecraft Crash Report ----\n// Oops.\n\nTime: 2026-09-25\nDescription: Initializing game\n\n\
                 java.lang.RuntimeException: Could not execute entrypoint stage 'main' due to errors, provided by 'create'!\n\
                 \tat net.fabricmc.loader.impl.FabricLoaderImpl.lambda$invokeEntrypoints$2(FabricLoaderImpl.java:388)\n\
                 Caused by: java.lang.NoSuchFieldError: TOOLTIP\n\tat com.simibubi.create.Create.init(Create.java:10)\n\n\
                 A detailed walkthrough of the error, its code path and all known details is as follows:",
                "java.lang.RuntimeException: Could not execute entrypoint stage 'main' due to errors, provided by 'create'! | Caused by: java.lang.NoSuchFieldError: TOOLTIP",
                "отчёт о вылете: исключение и корень цепочки",
            ),
            (
                "[12:00:00] [Render thread/WARN]: Skipping: java.lang.NoClassDefFoundError: dev/emi/Api\n\
                 [12:00:05] [Render thread/ERROR]: Unreported exception thrown!\n\
                 java.lang.IllegalArgumentException: bad texture\n\tat net.minecraft.client.X.y(X.java:1)",
                "java.lang.IllegalArgumentException: bad texture",
                "WARN с исключением — не причина, причина — то, что под ERROR",
            ),
            (
                "#\n# A fatal error has been detected by the Java Runtime Environment:\n#\n\
                 #  EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ff93c726200, pid=16520, tid=17728\n\
                 # Problematic frame:\n# C  [atio6axx.dll+0x196200]\n#",
                "EXCEPTION_ACCESS_VIOLATION (0xc0000005) | C [atio6axx.dll+0x196200]",
                "hs_err: код и кадр",
            ),
        ];
        for (text, want, why) in cases {
            let got = scrub_cause(&crash_cause(text), None, "");
            assert!(got.contains(want), "{why}: ждали {want:?} внутри {got:?}");
            assert!(got.chars().count() <= CAUSE_MAX);
        }
    }

    fn r(name: &str, id: &str) -> ModRef {
        ModRef { name: name.into(), id: id.into() }
    }

    fn req(by: ModRef, dep: ModRef, range: &str, present: Option<&str>) -> LoaderFinding {
        LoaderFinding::Requires { by, dep, range: range.into(), present: present.map(String::from) }
    }

    /// log fragment -> findings. The strings are the loaders' own templates
    /// (Fabric Messages.properties, Quilt quilt_loader.properties, Forge and
    /// NeoForge ModSorter), each as it lands in latest.log. A line the parser
    /// misses leaves «Починить сборку» with nothing to do but re-hash files.
    #[test]
    fn loader_refusals_become_findings() {
        let cases: Vec<(&str, &str, Vec<LoaderFinding>)> = vec![
            (
                "Fabric: нет зависимости",
                "[main/ERROR]: Incompatible mods found!\nnet.fabricmc.loader.impl.FormattedException: Some of your mods are incompatible with the game or each other!\nMore details:\n\t - Mod 'Mod Menu' (modmenu) 7.2.2 requires any version of fabric-api, which is missing!",
                vec![req(r("Mod Menu", "modmenu"), r("fabric-api", "fabric-api"), "*", None)],
            ),
            (
                "Fabric: зависимость не той версии",
                "\t - Mod 'Iris' (iris) 1.7.0+mc1.20.1 requires version 0.5.8 or later of mod 'Sodium' (sodium), but only the wrong version is present: 0.5.3!",
                vec![req(r("Iris", "iris"), r("Sodium", "sodium"), ">=0.5.8", Some("0.5.3"))],
            ),
            (
                "Fabric: мод под другую версию игры",
                "\t - Mod 'Sodium' (sodium) 0.6.0 requires version 1.21.4 of minecraft, but only the wrong version is present: 1.21.1!",
                vec![req(r("Sodium", "sodium"), r("minecraft", "minecraft"), "=1.21.4", Some("1.21.1"))],
            ),
            (
                "Fabric: диапазон мажорной версии",
                "\t - Mod 'Archers' (archers) 1.0.6 requires any 0.12.x version of spell_engine, which is missing!",
                vec![req(r("Archers", "archers"), r("spell_engine", "spell_engine"), ">=0.12 <0.13", None)],
            ),
            (
                "Fabric: несовместимые моды",
                "\t - Mod 'Iris' (iris) 1.7.0 is incompatible with any version of mod 'OptiFabric' (optifabric), yet a conflicting version is present: 1.13.0!",
                vec![LoaderFinding::Incompatible { by: r("Iris", "iris"), other: r("OptiFabric", "optifabric") }],
            ),
            (
                "Fabric: рекомендация не мешает запуску",
                "[main/WARN]: Warnings were found!\n - Mod 'Debugify' (debugify) 1.20.1+2.0 recommends any 3.x version of yet-another-config-lib, which is missing!",
                vec![],
            ),
            (
                "Fabric: миксин мода не встал",
                "[main/ERROR]: Mixin apply for mod entityculling failed entityculling.mixins.json:WorldRendererMixin from mod entityculling -> net.minecraft.class_761: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException",
                vec![LoaderFinding::MixinFailed { by: r("entityculling", "entityculling") }],
            ),
            (
                "Quilt: требование по шаблону quilt_loader",
                "[main/ERROR]: 'Iris' (iris) requires any version between 0.5.0 (inclusive) and 0.6.0 (exclusive) of 'Sodium' (sodium)",
                vec![req(r("Iris", "iris"), r("Sodium", "sodium"), ">=0.5.0 <0.6.0", None)],
            ),
            (
                "Quilt: дубль мода",
                "[main/ERROR]: Duplicate mod: sodium",
                vec![LoaderFinding::Duplicate { id: "sodium".into(), files: vec![] }],
            ),
            (
                "Forge: нет обязательной зависимости и не та версия игры",
                "[25сент.2026 13:29:03.409] [main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:\n\tMod ID: 'minecraft', Requested by: 'walkers', Expected range: '[1.20.4,)', Actual version: '1.20.1'\n\tMod ID: 'craftedcore', Requested by: 'walkers', Expected range: '[5.8.1,)', Actual version: '[MISSING]'",
                vec![
                    req(r("walkers", "walkers"), r("minecraft", "minecraft"), ">=1.20.4", Some("1.20.1")),
                    req(r("walkers", "walkers"), r("craftedcore", "craftedcore"), ">=5.8.1", None),
                ],
            ),
            (
                "Forge: необязательные зависимости не чинятся",
                "[main/ERROR] [net.minecraftforge.fml.loading.ModSorter/LOADING]: Unsupported installed optional dependencies:\n\tMod ID: 'jei', Requested by: 'appleskin', Expected range: '[15.0,)', Actual version: '11.6.0'",
                vec![],
            ),
            (
                "Forge: дубли",
                "[main/ERROR] [net.minecraftforge.fml.loading.UniqueModListBuilder/LOADING]: Found duplicate mods:\n\tMod ID: 'jei' from mod files: jei-1.20.1-forge-15.2.0.27.jar, jei-1.20.1-forge-15.3.0.4.jar",
                vec![LoaderFinding::Duplicate {
                    id: "jei".into(),
                    files: vec!["jei-1.20.1-forge-15.2.0.27.jar".into(), "jei-1.20.1-forge-15.3.0.4.jar".into()],
                }],
            ),
            (
                "Forge 1.12: список требований",
                "[Client thread/ERROR] [FML]: The mod jeresources (Just Enough Resources) requires mods [jei@[4.15.0,)] to be available",
                vec![req(r("jeresources", "jeresources"), r("jei", "jei"), ">=4.15.0", None)],
            ),
            (
                "NeoForge: зависимость не той версии",
                "[main/ERROR] [net.neoforged.fml.loading.ModSorter/LOADING]: Missing or unsupported mandatory dependencies:\n\tMod ID: 'curios', Requested by: 'artifacts', Expected range: '[9.0.5,10)', Actual version: '8.0.1'",
                vec![req(r("artifacts", "artifacts"), r("curios", "curios"), ">=9.0.5 <10", Some("8.0.1"))],
            ),
            (
                "NeoForge: несовместимость",
                "[main/ERROR] [net.neoforged.fml.loading.ModSorter/LOADING]: Incompatibilities between mods:\n\tMod 'iris' is incompatible with 'embeddium', versions: '[0,)'; Version found: '0.3.31'",
                vec![LoaderFinding::Incompatible { by: r("iris", "iris"), other: r("embeddium", "embeddium") }],
            ),
            (
                "NeoForge: мод другого загрузчика",
                "[main/ERROR]: File mods/sodium-fabric-0.5.11+mc1.21.jar is a Fabric mod and cannot be loaded",
                vec![LoaderFinding::WrongLoader { file: "sodium-fabric-0.5.11+mc1.21.jar".into(), loader: "fabric".into() }],
            ),
            (
                "NeoForge: дубль с кодами цвета",
                "Mod §ejei§r is present in multiple files: jei-a.jar, jei-b.jar",
                vec![LoaderFinding::Duplicate { id: "jei".into(), files: vec!["jei-a.jar".into(), "jei-b.jar".into()] }],
            ),
            (
                "NeoForge: миксин по шаблону FML",
                "[main/ERROR]: Mixin application of create.mixins.json from Create (create) has failed",
                vec![LoaderFinding::MixinFailed { by: r("create", "create") }],
            ),
            (
                "INFO-строка Angelica не отказ загрузчика",
                "[main/INFO]: Mod 'angelica' may be incompatible with other incompatible mods (if present)",
                vec![],
            ),
        ];
        for (why, log, want) in cases {
            assert_eq!(loader_findings(log), want, "{}: разбор отказа загрузчика неверен — починка сделает не то\n{}", why, log);
        }
    }

    /// loader notation -> predicate. Ranges are compared by the catalogue pick,
    /// so a wrong bound installs a version the loader refuses again.
    #[test]
    fn loader_ranges_read_as_predicates() {
        let cases: [(&str, &str, &str); 10] = [
            ("[5.8.1,)", ">=5.8.1", "Forge: от версии"),
            ("[1.20,1.21)", ">=1.20 <1.21", "Forge: полуинтервал"),
            ("(,2.0]", "<=2.0", "Forge: до версии"),
            ("[1.0]", "=1.0", "Forge: ровно"),
            ("1.0", ">=1.0", "Maven: рекомендованная версия"),
            ("[1,2),[3,4)", ">=1 <2", "объединение: берётся первый интервал"),
            ("", "*", "пусто — любая"),
            ("[9.0.5,10)", ">=9.0.5 <10", "NeoForge"),
            ("(1.0,2.0)", ">1.0 <2.0", "строгие границы"),
            ("[,)", "*", "без границ"),
        ];
        for (spec, want, why) in cases {
            assert_eq!(maven_range(spec), want, "{}: {}", spec, why);
        }
        let phrases: [(&str, &str, &str); 9] = [
            ("any version", "*", "Fabric: любая"),
            ("version 0.5.8 or later", ">=0.5.8", "Fabric: от"),
            ("version 2.0 or earlier", "<=2.0", "Fabric: до"),
            ("any version after 1.2", ">1.2", "Fabric: строго после"),
            ("any version before 3", "<3", "Fabric: строго до"),
            ("any 3.x version", ">=3 <4", "Fabric: мажорная"),
            ("version 1.21.4", "=1.21.4", "Fabric: ровно"),
            ("at least version 1.0 or any newer version", ">=1.0", "Quilt: от"),
            ("a version in the range [1.0,2.0)", ">=1.0 <2.0", "Quilt: интервал Maven"),
        ];
        for (phrase, want, why) in phrases {
            assert_eq!(phrase_range(phrase), want, "{}: {}", phrase, why);
        }
    }

    #[test]
    fn cause_leaves_no_home_build_nick_or_token() {
        let raw = "java.io.FileNotFoundException: C:\\Users\\Вася\\AppData\\Roaming\\net.millida.launcher\\minecraft\\profiles\\Моя сборка\\config\\Grash.json (Session ID is token:eyJhbGciOi.abc) player Grash";
        let got = scrub_cause(raw, Some("C:\\Users\\Вася"), "grash");
        for leaked in ["Вася", "Моя сборка", "Grash", "eyJhbGciOi"] {
            assert!(!got.contains(leaked), "{leaked} утёк: {got}");
        }
        assert!(got.contains("~\\AppData") && got.contains("profiles\\<build>\\config"), "{got}");
        let long = "x".repeat(1000);
        assert_eq!(scrub_cause(&long, None, "").chars().count(), CAUSE_MAX);
    }
}
