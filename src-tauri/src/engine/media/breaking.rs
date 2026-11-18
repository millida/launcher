// Block-breaking frames for the chest reveal. They are read from a client jar the player already has
// (versions/<id>/<id>.jar), so the launcher never ships or downloads game textures for this.
use crate::engine::*;
use std::io::Read;
use std::path::{Path, PathBuf};

pub const BREAKING_STAGES: usize = 10;
const MAX_FRAME_BYTES: u64 = 64 * 1024;
const MAX_JARS: usize = 8;
// 1.13 renamed textures/blocks to textures/block.
const FOLDERS: [&str; 2] = ["assets/minecraft/textures/block/", "assets/minecraft/textures/blocks/"];
const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

fn client_jars(versions: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(versions) else { return vec![] };
    let mut jars: Vec<(std::time::SystemTime, PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().to_string_lossy().to_string();
            let jar = e.path().join(format!("{id}.jar"));
            let modified = std::fs::metadata(&jar).ok().filter(|m| m.is_file())?.modified().ok()?;
            Some((modified, jar))
        })
        .collect();
    jars.sort_by_key(|j| std::cmp::Reverse(j.0));
    jars.into_iter().take(MAX_JARS).map(|(_, p)| p).collect()
}

fn read_frame<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>, name: &str) -> Option<Vec<u8>> {
    let entry = zip.by_name(name).ok()?;
    if entry.size() > MAX_FRAME_BYTES {
        return None;
    }
    let mut buf = Vec::new();
    entry.take(MAX_FRAME_BYTES + 1).read_to_end(&mut buf).ok()?;
    (buf.len() as u64 <= MAX_FRAME_BYTES && buf.starts_with(&PNG_MAGIC)).then_some(buf)
}

pub fn read_breaking_stages<R: Read + std::io::Seek>(reader: R) -> Option<Vec<Vec<u8>>> {
    let mut zip = zip::ZipArchive::new(reader).ok()?;
    FOLDERS.iter().find_map(|folder| {
        (0..BREAKING_STAGES)
            .map(|i| read_frame(&mut zip, &format!("{folder}destroy_stage_{i}.png")))
            .collect::<Option<Vec<_>>>()
    })
}

/// The ten frames as PNG data URLs, from the most recently installed game version that has them.
/// No installed version is a normal state (the reveal draws its own frames), so it is an empty list, not an error.
pub fn breaking_stages() -> Vec<String> {
    use base64::Engine as _;
    client_jars(&game_root().join("versions"))
        .iter()
        .filter_map(|jar| std::fs::File::open(jar).ok())
        .find_map(|f| read_breaking_stages(std::io::BufReader::new(f)))
        .map(|frames| {
            frames
                .iter()
                .map(|png| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};

    type Entries = Vec<(String, Vec<u8>)>;

    fn png(extra: usize) -> Vec<u8> {
        let mut b = PNG_MAGIC.to_vec();
        b.extend(std::iter::repeat_n(7u8, extra));
        b
    }

    fn jar(entries: &[(String, Vec<u8>)]) -> Cursor<Vec<u8>> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in entries {
            w.start_file(name.as_str(), zip::write::SimpleFileOptions::default()).expect("zip entry");
            w.write_all(data).expect("zip data");
        }
        Cursor::new(w.finish().expect("zip finish").into_inner())
    }

    fn stages(folder: &str) -> Entries {
        (0..BREAKING_STAGES).map(|i| (format!("{folder}destroy_stage_{i}.png"), png(i))).collect()
    }

    #[test]
    fn frames_come_from_either_texture_folder_in_order() {
        for folder in FOLDERS {
            let frames = read_breaking_stages(jar(&stages(folder))).expect("all ten frames are present");
            assert_eq!(frames.len(), BREAKING_STAGES, "{folder}: one frame per stage");
            assert_eq!(frames[3], png(3), "{folder}: stage 3 must be destroy_stage_3, the reveal shows them by hit count");
        }
    }

    #[test]
    fn incomplete_or_unsafe_jars_give_nothing() {
        let mut missing = stages(FOLDERS[0]);
        missing.remove(9);
        let mut not_png = stages(FOLDERS[0]);
        not_png[0].1 = b"GIF89a".to_vec();
        let mut huge = stages(FOLDERS[0]);
        huge[2].1 = png(MAX_FRAME_BYTES as usize);
        let cases: [(&str, Entries); 3] = [
            ("a missing stage would make the cracks jump back", missing),
            ("a renamed non-PNG file must not reach the webview", not_png),
            ("an oversized entry must not be read into memory", huge),
        ];
        for (why, entries) in cases {
            assert!(read_breaking_stages(jar(&entries)).is_none(), "{why}");
        }
        assert!(read_breaking_stages(Cursor::new(b"not a zip".to_vec())).is_none(), "a broken jar is skipped, not an error");
    }
}
