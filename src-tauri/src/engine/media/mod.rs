// Wires up the modules for sounds, music, pictures and wallpapers.
mod music;
mod pictures;
mod sounds;
mod wallpaper;
mod mcnews;

pub use music::*;
pub use pictures::*;
pub use sounds::*;
pub use wallpaper::*;
pub use mcnews::{minecraft_news, McNews};
