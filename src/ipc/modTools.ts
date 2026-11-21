// Команды ядра для окон, что грузятся лениво (мастер поиска виновника, выключение модов с
// зависимыми, «Место на диске»): вне commands.ts, чтобы не попадать в стартовый набор JS.
import { invoke, type BisectView, type DiskUsage, type ModDependents } from './commands'

/** Перед выключением: какие из `names` нужны включённым модам (по их fabric.mod.json / mods.toml). */
export const modDependents = (profile: string, names: string[]) => invoke<ModDependents[]>('mod_dependents', { profile, names })
/** «Выключить только этот»: починка при запуске не вернёт копию этих модов, пока игрок их не включит. */
export const keepModsOff = (profile: string, names: string[]) => invoke<void>('keep_mods_off', { profile, names })
export const bisectStatus = (profile: string) => invoke<BisectView | null>('bisect_status', { profile })
export const bisectStart = (profile: string) => invoke<BisectView>('bisect_start', { profile })
/** `step` — шаг, на который отвечаем (view.step): повторный ответ на тот же запуск ядро не засчитает следующему. */
export const bisectAnswer = (profile: string, crashed: boolean, step: number) => invoke<BisectView>('bisect_answer', { profile, crashed, step })
export const bisectVerify = (profile: string) => invoke<BisectView>('bisect_verify', { profile })
/** Возвращает все моды, включённые на старте поиска; `disable` — выключить виновника после этого. */
export const bisectFinish = (profile: string, disable: string | null) => invoke<void>('bisect_finish', { profile, disable })
/** Обходит всю папку игры в фоне ядра: может идти секунды. */
export const diskUsage = () => invoke<DiskUsage>('disk_usage')
/** Логи и отчёты о вылетах старше двух недель: одной сборки или всех (`null`). Возвращает освобождённые байты. */
export const cleanOldLogs = (profile: string | null) => invoke<number>('clean_old_logs', { profile })
