/**
 * Старый плеер лобби заменён радио (docs/MUSIC.md). Имя `MusicControls`
 * оставлено, чтобы Play.tsx не пришлось трогать; новый код берёт
 * `SoundControls` из components/radio (кнопки «Звуки» и «Музыка»).
 */
export { SoundControls as MusicControls } from './radio'
