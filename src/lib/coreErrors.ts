import { t } from '../i18n'

/// The core answers in Russian and the webview recognises these replies by their exact text,
/// so they live here once; what the player sees goes through t().
export const CORE_INSTALL_CANCELLED = 'Установка отменена'
export const CORE_LAUNCH_CANCELLED = 'Запуск отменён'
export const CORE_PICK_CANCELLED = 'Отменено'
export const CORE_CANCEL_STEM = 'отмен'
export const CORE_NO_CONNECTION = 'нет связи'

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? '')).replace(/^Error:\s*/, '')

export const isPickCancelled = (e: unknown): boolean => String(e).includes(CORE_PICK_CANCELLED)

export const mentionsCancel = (e: unknown): boolean => String(e).includes(CORE_CANCEL_STEM)

/// A known core reply is shown translated; anything else passes through as the core wrote it.
export const coreErrorText = (e: unknown): string => t(errorMessage(e))
