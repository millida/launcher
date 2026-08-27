use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// A separate always-on-top window, not a Minecraft mod: the launcher blocks
/// `-javaagent` on purpose (launch.rs), and one window works for every loader
/// and every game version instead of a client mod per pair.
pub const LABEL: &str = "overlay";

const PREF_ENABLED: &str = "overlay-enabled";
const PREF_HOTKEY: &str = "overlay-hotkey";
const PREF_TOASTS: &str = "overlay-toasts";
pub const DEFAULT_HOTKEY: &str = "Alt+M";

/// Cards the webview could not receive yet: a window that has just been created
/// has no listener, and an event emitted into that gap is lost for good - the
/// overlay would then stay on screen full-size with nothing to show.
static PENDING: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());
static INTERACTIVE: AtomicBool = AtomicBool::new(false);
static NOTIFY_SEQ: AtomicU64 = AtomicU64::new(0);

/// Card rectangles in CSS pixels relative to the window, reported by the
/// webview. A passive overlay is click-through as a whole, so the only way a
/// card can be clicked at all is to drop that flag exactly while the pointer is
/// over one of these.
static HIT: Mutex<Vec<[f64; 4]>> = Mutex::new(Vec::new());
static HOVER: AtomicBool = AtomicBool::new(false);
static HIT_SEQ: AtomicU64 = AtomicU64::new(0);

const HIT_POLL_MS: u64 = 25;

/// Longest a passive card may keep the window up: the frontend hides it earlier
/// on its own, this only catches a webview that never answered.
const PASSIVE_MAX_MS: u64 = 15_000;

/// A hovered card stops its own clock, so a pointer resting in the corner where
/// cards appear used to pin an always-on-top card on screen for good.
const HOLD_MAX_MS: u64 = 45_000;

pub fn set_hit_areas(rects: Vec<[f64; 4]>) {
    *HIT.lock().unwrap_or_else(|e| e.into_inner()) = rects;
}

/// Whether clicks fall through to whatever is under the overlay.
fn passthrough(interactive: bool, hover: bool) -> bool {
    !interactive && !hover
}

/// The only writer of the hover state. The core flag, the window flag and the
/// webview drifted apart while each was set on its own, and every drift ended
/// the same way: a card that looks hoverable, swallows no click and, with its
/// clock stopped by that same flag, never expires either.
fn set_hover(app: &AppHandle, hover: bool) {
    HOVER.store(hover, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.set_ignore_cursor_events(passthrough(INTERACTIVE.load(Ordering::SeqCst), hover));
    }
    let _ = app.emit_to(LABEL, "overlay-hover", hover);
}

fn hits(rects: &[[f64; 4]], x: f64, y: f64) -> bool {
    rects.iter().any(|r| x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3])
}

fn inside_card(x: f64, y: f64) -> bool {
    hits(&HIT.lock().unwrap_or_else(|e| e.into_inner()), x, y)
}

fn stop_hit_watch(app: &AppHandle) {
    HIT_SEQ.fetch_add(1, Ordering::SeqCst);
    set_hover(app, false);
    HIT.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

/// Passive cards must be clickable without stealing the clicks the game needs,
/// and a click-through window receives no pointer events to hit-test with - so
/// the core follows the cursor itself and lifts the flag only over a card.
fn arm_hit_watch(app: &AppHandle) {
    let seq = HIT_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // Nothing is carried over from the previous watcher: showing the window
        // for a new card re-arms click-through by itself, so the first tick has
        // to state the truth even when the answer did not change.
        let mut over: Option<bool> = None;
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(HIT_POLL_MS)).await;
            if HIT_SEQ.load(Ordering::SeqCst) != seq || INTERACTIVE.load(Ordering::SeqCst) {
                break;
            }
            let Some(win) = handle.get_webview_window(LABEL) else { break };
            if !win.is_visible().unwrap_or(false) {
                break;
            }
            let now = match (handle.cursor_position(), win.outer_position(), win.scale_factor()) {
                (Ok(cur), Ok(pos), Ok(scale)) if scale > 0.0 => {
                    inside_card((cur.x - pos.x as f64) / scale, (cur.y - pos.y as f64) / scale)
                }
                _ => false,
            };
            if over == Some(now) {
                continue;
            }
            over = Some(now);
            // The webview only learns about a pointer it was deaf to a moment
            // ago on the next mouse move, so the core states it outright.
            set_hover(&handle, now);
        }
        if over == Some(true) && HIT_SEQ.load(Ordering::SeqCst) == seq {
            set_hover(&handle, false);
        }
    });
}

pub fn enabled() -> bool {
    crate::engine::ui_pref(PREF_ENABLED).as_deref() == Some("1")
}

/// Desktop toasts are on unless the user turned them off: they are the only way
/// a friend event reaches someone whose launcher sits in the tray.
pub fn toasts_enabled() -> bool {
    crate::engine::ui_pref(PREF_TOASTS).as_deref() != Some("0")
}

pub fn hotkey() -> String {
    crate::engine::ui_pref(PREF_HOTKEY)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string())
}

/// The bool says whether the window had to be created: a webview that only just
/// started has no listener yet, so the first event has to wait for it.
fn build(app: &AppHandle) -> Result<(tauri::WebviewWindow, bool), String> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Ok((w, false));
    }
    let win = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html#overlay".into()))
        .title("Millida Overlay")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .resizable(false)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    if let Ok(Some(mon)) = win.primary_monitor() {
        let _ = win.set_position(mon.position().to_owned());
        let _ = win.set_size(mon.size().to_owned());
    }
    // Passive by default: the overlay must not eat clicks meant for the game.
    let _ = win.set_ignore_cursor_events(true);
    let handle = app.clone();
    win.on_window_event(move |e| {
        // Closing the overlay must never take the launcher down with it.
        if let WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            if let Some(w) = handle.get_webview_window(LABEL) {
                let _ = w.hide();
            }
        }
    });
    Ok((win, true))
}

/// `interactive` decides whether the window takes the pointer and the keyboard.
/// Notifications arrive passive; the hotkey is what makes it a chat.
pub fn show(app: &AppHandle, interactive: bool) -> Result<bool, String> {
    let (win, fresh) = build(app)?;
    INTERACTIVE.store(interactive, Ordering::SeqCst);
    if interactive {
        stop_hit_watch(app);
    }
    let hover = !interactive && HOVER.load(Ordering::SeqCst);
    let _ = win.set_ignore_cursor_events(passthrough(interactive, hover));
    win.show().map_err(|e| e.to_string())?;
    let _ = win.set_always_on_top(true);
    if interactive {
        let _ = win.set_focus();
    }
    let _ = app.emit_to(LABEL, "overlay-mode", interactive);
    // A webview kept across hide and show remembers the last hover it was told
    // about, and a stale `true` there freezes the clock of every card to come.
    if !interactive {
        let _ = app.emit_to(LABEL, "overlay-hover", hover);
    }
    Ok(fresh)
}

pub fn hide(app: &AppHandle) {
    INTERACTIVE.store(false, Ordering::SeqCst);
    stop_hit_watch(app);
    PENDING.lock().unwrap_or_else(|e| e.into_inner()).clear();
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.hide();
    }
}

/// The webview reports itself ready, and everything queued while it was booting
/// is delivered in order.
pub fn drain_pending(app: &AppHandle) {
    let queued: Vec<serde_json::Value> =
        std::mem::take(&mut *PENDING.lock().unwrap_or_else(|e| e.into_inner()));
    for payload in queued {
        let _ = app.emit_to(LABEL, "overlay-message", payload);
    }
}

/// A passive overlay outliving its cards is a full-screen always-on-top layer
/// the user cannot close, so the core takes it down even if the webview is dead.
fn arm_watchdog(app: &AppHandle) {
    let seq = NOTIFY_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(PASSIVE_MAX_MS)).await;
        // A card the user is reading (or about to click) must not be yanked out
        // from under the cursor by the watchdog - but a pointer that merely
        // rests there is not a reader, so the reprieve is finite.
        let mut held = 0u64;
        while HOVER.load(Ordering::SeqCst) && held < HOLD_MAX_MS {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            held += 500;
        }
        if NOTIFY_SEQ.load(Ordering::SeqCst) != seq || INTERACTIVE.load(Ordering::SeqCst) {
            return;
        }
        hide(&handle);
    });
}

pub async fn notify(app: &AppHandle, payload: serde_json::Value) -> Result<(), String> {
    let fresh = show(app, false)?;
    arm_watchdog(app);
    arm_hit_watch(app);
    if fresh {
        PENDING.lock().unwrap_or_else(|e| e.into_inner()).push(payload);
        return Ok(());
    }
    app.emit_to(LABEL, "overlay-message", payload).map_err(|e| e.to_string())
}

/// Rebinding drops the previous accelerator first: a changed hotkey that left
/// the old one registered would fire the overlay from two keys forever.
pub fn rebind_hotkey(app: &AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !enabled() {
        return;
    }
    let combo = hotkey();
    let handle = app.clone();
    if gs
        .on_shortcut(combo.as_str(), move |_, _, event| {
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                toggle(&handle);
            }
        })
        .is_err()
    {
        // A combination another program already owns must not silently disable
        // the feature: fall back to the default one.
        let _ = gs.on_shortcut(DEFAULT_HOTKEY, move |app, _, event| {
            if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                toggle(app);
            }
        });
    }
}

/// A card click either opens the conversation in the overlay itself - a running
/// game must not be thrown to the background just to answer - or brings the
/// launcher up when there is no game to protect.
pub fn open_card(app: &AppHandle, payload: serde_json::Value, to_launcher: bool) -> Result<(), String> {
    let is_call = payload.get("open").and_then(|v| v.as_str()) == Some("call");
    if to_launcher || is_call || crate::engine::running_games().is_empty() {
        hide(app);
        crate::tray::show_main(app);
        return app.emit_to("main", "overlay-open", payload).map_err(|e| e.to_string());
    }
    show(app, true)?;
    app.emit_to(LABEL, "overlay-open", payload).map_err(|e| e.to_string())
}

/// Hotkey semantics: summon and focus, or dismiss if it already has the user.
pub fn toggle(app: &AppHandle) {
    if !enabled() {
        return;
    }
    let interactive_now = app
        .get_webview_window(LABEL)
        .map(|w| w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false))
        .unwrap_or(false);
    if interactive_now {
        hide(app);
    } else {
        let _ = show(app, true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passthrough_follows_hover_in_passive_mode() {
        let cases = [
            ((false, false), true, "passive card, pointer elsewhere: the game keeps its clicks"),
            ((false, true), false, "pointer on a card: the close button must receive the click"),
            ((true, false), false, "the chat panel owns the pointer"),
            ((true, true), false, "interactive wins over a stale hover flag"),
        ];
        for ((interactive, hover), want, why) in cases {
            assert_eq!(
                passthrough(interactive, hover),
                want,
                "passthrough({interactive}, {hover}) must be {want}: {why}"
            );
        }
    }

    #[test]
    fn hit_test_covers_the_card_and_nothing_else() {
        let rects = [[100.0, 200.0, 330.0, 60.0]];
        let cases = [
            ((110.0, 210.0), true, "inside the card"),
            ((424.0, 205.0), true, "the close button sits at the right edge"),
            ((100.0, 200.0), true, "the top-left corner belongs to the card"),
            ((99.0, 210.0), false, "one pixel left of the card is the game"),
            ((110.0, 199.0), false, "one pixel above the card is the game"),
            ((431.0, 210.0), false, "past the right edge is the game"),
            ((110.0, 261.0), false, "below the card is the game"),
        ];
        for ((x, y), want, why) in cases {
            assert_eq!(hits(&rects, x, y), want, "hits({x}, {y}) must be {want}: {why}");
        }
    }

    /// A card whose clock is paused by hover is only bounded by this, and an
    /// unbounded reprieve is how an always-on-top card became furniture.
    #[test]
    fn hover_reprieve_is_finite_and_outlives_the_passive_window() {
        const {
            assert!(HOLD_MAX_MS > PASSIVE_MAX_MS, "a reader must get more time than the plain timeout");
            assert!(HOLD_MAX_MS <= 120_000, "a parked pointer must not keep a card for minutes");
        }
    }
}
