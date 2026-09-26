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

#[cfg(test)]
mod tests {
    use super::*;

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
