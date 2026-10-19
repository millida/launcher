/*
 * Текст карточки Милли из самих шагов. Подписи строк в ответе сервера — слова
 * модели: они могут сказать «Графика», пока шаг ставит мод. Поэтому у строки с
 * шагами подпись собирается здесь, из полей шага (имена, id, файлы), и сервер
 * на неё повлиять не может.
 */
import type { MilliStep } from './milliActions'
import { t } from '../i18n'

export interface StepText {
  label: string
  to?: string
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function describeStep(s: MilliStep): StepText {
  switch (s.op) {
    case 'opt':
      return { label: str(s.key), to: str(s.to) }
    case 'cfg':
      return { label: str(s.file) + ' · ' + str(s.path), to: str(s.to) }
    case 'ram':
      return { label: t('Память'), to: s.mb > 0 ? Math.round(s.mb / 1024) + ' GB' : 'auto' }
    case 'fpsboost':
      return { label: t('Режим FPS'), to: s.on ? t('вкл') : t('выкл') }
    case 'shader':
      return { label: t('Шейдеры'), to: s.file ? str(s.file) : t('выкл') }
    case 'add':
    case 'dep_add':
      return { label: str(s.title) + ' (' + str(s.projectId) + ')', to: t('добавлен') }
    case 'snapshot':
      return { label: s.scope === 'world' ? t('Бэкап мира') + ' ' + str(s.world) : t('Снимок сборки') }
    case 'restore':
      return { label: t('Сборка') + ' · ' + str(s.id) }
    case 'world_restore':
      return { label: t('Мир из бэкапа') + ' · ' + str(s.file) }
    case 'import':
      return { label: t('Импорт') + ' · ' + str(s.source), to: str(s.ref) }
    case 'file_put':
      return { label: str(s.path) }
    case 'scan':
      return { label: 'scan ' + str(s.mode) }
    case 'mod_update':
      return { label: str(s.file), to: str(s.toNum || s.to) }
    case 'mod_off':
      return { label: str(s.file), to: t('выкл') }
    case 'mod_on':
      return { label: str(s.file), to: t('вкл') }
    case 'port':
      return { label: str(s.name) + ' · ' + str(s.loader) + ' ' + str(s.mc), to: s.add.map((a) => str(a.projectId)).join(', ') }
    case 'crashfix':
      return { label: str(s.kind), to: str(s.arg) }
  }
}

/** Подпись и значение строки из всех её шагов. */
export function describeSteps(steps: MilliStep[]): StepText {
  const parts = steps.map(describeStep)
  const to = parts.map((p) => p.to).filter((x): x is string => !!x)
  return { label: clip(parts.map((p) => p.label).join(', '), 60), ...(to.length ? { to: clip(to.join(', '), 40) } : {}) }
}
