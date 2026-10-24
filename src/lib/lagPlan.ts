/*
 * Почему лагало и что с этим сделать — по фактам сборки и ПК. Каждое
 * исправление — шаги Милли (milliActions): те же, что Милли выполняет в чате,
 * с откатом и записью в дневник сборки. Первое исправление — самое вероятное,
 * оно и становится главной кнопкой.
 */
import type { MilliStep } from './milliActions'
import type { LagVerdict } from './lagWindow'
import { t } from '../i18n'

export type LagCause = 'memory' | 'memory_pc' | 'no_boost' | 'shaders' | 'distance' | 'heavy'

export interface LagFix {
  id: LagCause | 'lite'
  label: string
  steps: MilliStep[]
}

export interface LagFacts {
  /** Куча этого запуска, сколько дал бы автоподбор на этом ПК и выбрана ли память вручную. */
  heapMb: number
  fitMb: number
  /** Режим «Буст FPS» можно включить: не выключен, применим, у загрузчика есть моды ускорения. */
  boostOffered: boolean
  /** В сборке уже есть рендерер-ускоритель (Sodium и порты) или OptiFine. */
  hasRenderer: boolean
  shadersOn: boolean
  renderDistance: number | null
  /** Графика уже на минимуме: упрощать нечего. */
  graphicsLow: boolean
}

export interface LagPlan {
  cause: LagCause
  fixes: LagFix[]
}

const RENDERER_JAR = /sodium|embeddium|rubidium|nothirium|vintagium|celeritas|optifine|optifabric/i
const FAR = 10
const NEAR = '8'
const MIN_RAISE_MB = 1024

export const hasRendererJar = (names: readonly string[]) => names.some((n) => RENDERER_JAR.test(n))

/** options.txt → дальность прорисовки и «графика уже минимальная». */
export function readVideo(text: string | null | undefined): { renderDistance: number | null; graphicsLow: boolean } {
  const opts = new Map<string, string>()
  for (const line of (text ?? '').split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at > 0) opts.set(line.slice(0, at), line.slice(at + 1).trim())
  }
  const rd = Number(opts.get('renderDistance'))
  const fastGraphics = opts.get('graphicsMode') === '0' || opts.get('fancyGraphics') === 'false'
  return {
    renderDistance: Number.isFinite(rd) && rd > 0 ? rd : null,
    graphicsLow: fastGraphics && opts.get('particles') === '2',
  }
}

/** enableShaders=true в config/iris.properties или oculus.properties. */
export const shadersEnabled = (props: string | null | undefined) => /^\s*enableShaders\s*=\s*true\s*$/m.test(props ?? '')

const LITE: [string, string][] = [
  ['graphicsMode', '0'],
  ['particles', '2'],
  ['renderClouds', 'false'],
  ['entityShadows', 'false'],
  ['ao', 'false'],
]

export function lagPlan(v: Pick<LagVerdict, 'memory'>, f: LagFacts): LagPlan {
  const fixes: LagFix[] = []
  const gb = Math.floor(f.fitMb / 1024)
  const canRaise = f.fitMb - f.heapMb >= MIN_RAISE_MB
  if (v.memory && canRaise) fixes.push({ id: 'memory', label: t('Дать {n} ГБ памяти', { n: gb }), steps: [{ op: 'ram', mb: gb * 1024 }] })
  if (f.boostOffered && !f.hasRenderer) fixes.push({ id: 'no_boost', label: t('Включить ускорение'), steps: [{ op: 'fpsboost', on: true }] })
  if (f.shadersOn) fixes.push({ id: 'shaders', label: t('Выключить шейдеры'), steps: [{ op: 'shader', file: null }] })
  if (f.renderDistance !== null && f.renderDistance > FAR)
    fixes.push({
      id: 'distance',
      label: t('Уменьшить дальность'),
      steps: [
        { op: 'opt', key: 'renderDistance', to: NEAR },
        { op: 'opt', key: 'simulationDistance', to: '6' },
      ],
    })
  if (!f.graphicsLow) fixes.push({ id: 'lite', label: t('Упростить графику'), steps: LITE.map(([key, to]) => ({ op: 'opt', key, to }) as MilliStep) })
  const first = fixes[0]?.id
  const cause: LagCause = v.memory && !canRaise ? 'memory_pc' : !first || first === 'lite' ? 'heavy' : first
  return { cause, fixes }
}

/** Что случилось и почему — для ребёнка: одна строка заголовка и одна строка причины. */
export function lagText(cause: LagCause): { title: string; why: string } {
  switch (cause) {
    case 'memory':
      return { title: t('Игре не хватает памяти'), why: t('Модов много, а памяти игре дали мало. Лаунчер тут ни при чём — дадим больше.') }
    case 'memory_pc':
      return { title: t('Компьютеру не хватает памяти'), why: t('Закрой браузер и другие программы, пока играешь.') }
    case 'no_boost':
      return { title: t('Нет модов ускорения'), why: t('Sodium и другие моды ускорения сильно поднимают FPS. Поставим их сами.') }
    case 'shaders':
      return { title: t('Шейдеры слишком тяжёлые'), why: t('Красивый свет сильно нагружает видеокарту. Без шейдеров игра пойдёт быстрее.') }
    case 'distance':
      return { title: t('Игра рисует слишком далеко'), why: t('Чем дальше видно, тем тяжелее компьютеру. Уменьшим дальность.') }
    case 'heavy':
      return { title: t('Сборка тяжёлая для этого ПК'), why: t('Упростим графику — игра пойдёт плавнее.') }
  }
}
