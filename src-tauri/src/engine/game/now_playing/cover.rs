use super::protocol::{cover_key, Cover, MAX_COVER};
use std::sync::Arc;

pub const MAX_SOURCE_BYTES: usize = 8 * 1024 * 1024;

/// Album art as the game takes it: a centred square, at most 64 px, ARGB bytes.
pub fn from_image(bytes: &[u8]) -> Option<Cover> {
    if bytes.is_empty() || bytes.len() > MAX_SOURCE_BYTES {
        return None;
    }
    let image = image::load_from_memory(bytes).ok()?.to_rgba8();
    let (width, height) = image.dimensions();
    let side = width.min(height);
    if side == 0 {
        return None;
    }
    let square = image::imageops::crop_imm(&image, (width - side) / 2, (height - side) / 2, side, side).to_image();
    let size = side.min(MAX_COVER);
    let small = if size == side {
        square
    } else {
        image::imageops::resize(&square, size, size, image::imageops::FilterType::Triangle)
    };
    let mut argb = Vec::with_capacity((size * size * 4) as usize);
    for pixel in small.pixels() {
        let [r, g, b, a] = pixel.0;
        argb.extend_from_slice(&[a, r, g, b]);
    }
    Some(Cover { key: cover_key(bytes), size, argb })
}

/// The last cover decoded: a pause or a seek re-reads the session, not the picture.
#[derive(Default)]
pub struct CoverCache {
    last: Option<Arc<Cover>>,
}

impl CoverCache {
    pub fn get(&mut self, bytes: Option<&[u8]>) -> Option<Arc<Cover>> {
        let bytes = bytes?;
        let key = cover_key(bytes);
        if let Some(last) = self.last.as_ref().filter(|c| c.key == key) {
            return Some(last.clone());
        }
        let cover = Arc::new(from_image(bytes)?);
        self.last = Some(cover.clone());
        Some(cover)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let image = image::RgbaImage::from_fn(width, height, |x, _| {
            if x < width / 2 { image::Rgba([255, 0, 0, 255]) } else { image::Rgba([0, 0, 255, 128]) }
        });
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image).write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    #[test]
    fn wide_art_is_cropped_and_shrunk() {
        let cover = from_image(&png(300, 200)).expect("a png decodes");
        assert_eq!(cover.size, 64, "the mod drops anything over 64 px");
        assert_eq!(cover.argb.len(), 64 * 64 * 4, "the mod drops a picture whose length is not size*size*4");
        assert_eq!(&cover.argb[..4], &[255, 255, 0, 0], "pixels go out as A R G B, not RGBA");
    }

    #[test]
    fn small_art_keeps_its_size() {
        let cover = from_image(&png(10, 16)).unwrap();
        assert_eq!(cover.size, 10, "small art is not blown up");
        let last = &cover.argb[cover.argb.len() - 4..];
        assert_eq!(last, &[128, 0, 0, 255], "alpha is passed through, not premultiplied");
    }

    #[test]
    fn junk_is_no_cover() {
        assert!(from_image(b"not an image").is_none(), "a broken thumbnail must not break the state");
        assert!(from_image(&[]).is_none());
    }

    #[test]
    fn cache_keeps_the_same_cover() {
        let mut cache = CoverCache::default();
        let bytes = png(8, 8);
        let first = cache.get(Some(&bytes)).unwrap();
        let again = cache.get(Some(&bytes)).unwrap();
        assert!(Arc::ptr_eq(&first, &again), "the same art must not be decoded again");
        assert!(cache.get(None).is_none());
    }
}
