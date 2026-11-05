/*
 * Геометрия фигуры лобби без three.js: по ней ставит фигуру 3D-сцена (LobbyCharacter)
 * и на то же место кладёт заглушку стартовый код (LobbyFigure, lib/lobbyStill).
 */

/**
 * Где стоит фигура в лобби. Ноги — на 62% высоты сцены: ниже под ними кнопка
 * «Гардероб», и при ногах у самого низа ноги, кнопка и нижняя плашка слипались
 * (владелец 23.09.2026). Рост — не больше 0.73 кадра (на 13% меньше прежних
 * 0.84: «чуть меньше, чтобы стоял подальше»), но и не выше, чем оставляет место
 * под ник над головой: при поднятых ногах это решает высота окна.
 */
const LOBBY_FEET_AT = 0.77
// Крупнее (владелец 24.09.2026, 07:44: «персонаж маленький какой-то»).
const LOBBY_MAX_FILL_Y = 0.5
/** Над макушкой: ник (~25px) и зазор до края сцены. */
// Ника над головой больше нет (владелец 24.09.2026, 13:23) — место под рост.
const LOBBY_HEAD_ROOM_PX = 150

/** Кадр фигуры в сцене высотой h, стоящей на top от верха сцены высотой scene. */
export function lobbyFrame(h: number, top: number, scene: number): { fillY: number; offsetY: number } {
  const feetPx = Math.min(h - 4, Math.max(0, LOBBY_FEET_AT * scene - top))
  const feet = 1 - (2 * feetPx) / h
  const head = 1 - (2 * LOBBY_HEAD_ROOM_PX) / h
  const fillY = Math.max(0.3, Math.min(LOBBY_MAX_FILL_Y, (head - feet) / 2))
  return { fillY, offsetY: feet + fillY }
}

/** Где фигура в пикселях сцены: линия ног от верха и рост (только тело, без вещей). */
export function lobbyFigureBox(h: number, top: number, scene: number): { feet: number; tall: number } {
  const { fillY, offsetY } = lobbyFrame(h, top, scene)
  return { feet: ((1 - (offsetY - fillY)) / 2) * h, tall: fillY * h }
}
