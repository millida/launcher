/*
 * Перед запуском: пресет графики (свой у сборки или общий для новой сборки) и
 * проверка памяти. Занижённая вручную память — главная причина «лаунчер
 * лагает» на больших сборках: предлагаем поднять до автоподбора одной
 * кнопкой. Мало свободной памяти у самого ПК — подсказка закрыть программы.
 */
import { applyGfxPreset, gfxPresetState, ramCheck, seedVideoOptions, type RamCheck } from '../ipc/commands'
import { uiChoice } from '../state/confirm'
import { showToast } from '../state/ui'
import { t, tx } from '../i18n'
import { setBuildRamMb } from './ramPref'
import { GRAPHICS_PRESETS_PUBLIC } from './graphicsRelease'

const BIG_PACK_MODS = 20
const MIN_GAP_MB = 1024
const SKIP_MS = 7 * 86_400_000
/** ПК «на 4 ГБ»: ядро видит 3,5–4,2 ГБ. Системе остаётся половина, игре — меньше 2 ГБ при любом числе модов. */
const WEAK_TOTAL_MB = 4608
/** С такого числа модов даже «Низкие» не спасают, нужна «Картошка». */
const POTATO_MODS = 80

export type WeakPreset = 'potato' | 'low'

export type RamAdvice =
  | { kind: 'ok' }
  | { kind: 'raise'; toGb: number; haveGb: number }
  | { kind: 'busy' }
  | { kind: 'weak'; mods: number; needGb: number; haveGb: string; totalGb: number; preset: WeakPreset }

const oneDecimal = (mb: number) => (mb / 1024).toFixed(1).replace(/\.0$/, '')

export function ramAdvice(c: RamCheck): RamAdvice {
  // Сборка не по ПК: на машине с 4 ГБ куча урезается до ~1,9 ГБ (системе остаётся половина), и это
  // раньше случалось молча. Говорим до запуска и называем ступень, с которой сборка пойдёт.
  if (c.totalMb > 0 && c.totalMb <= WEAK_TOTAL_MB && c.mods >= BIG_PACK_MODS && c.needMb - c.heapMb >= MIN_GAP_MB)
    return {
      kind: 'weak',
      mods: c.mods,
      needGb: Math.round(c.needMb / 1024),
      haveGb: oneDecimal(c.heapMb),
      totalGb: Math.max(1, Math.round(c.totalMb / 1024)),
      preset: c.mods > POTATO_MODS ? 'potato' : 'low',
    }
  if (c.packOwned || c.totalMb <= 0) return { kind: 'ok' }
  const target = Math.min(c.needMb, c.fitMb)
  if (c.manual && c.mods >= BIG_PACK_MODS && target - c.heapMb >= MIN_GAP_MB)
    return { kind: 'raise', toGb: Math.floor(target / 1024), haveGb: Math.max(1, Math.round(c.heapMb / 1024)) }
  // The heap is only a ceiling, but a game that cannot get even half of it swaps from the first minute.
  if (c.availableMb > 0 && c.availableMb * 2 < c.heapMb) return { kind: 'busy' }
  return { kind: 'ok' }
}

const skipKey = (profile: string) => 'm-ram-short-skip-' + profile
const weakSkipKey = (profile: string) => 'm-weak-pc-skip-' + profile

function skipped(profile: string, key = skipKey): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(key(profile)) || 0) < SKIP_MS
  } catch (e) {
    console.warn('[prelaunch] skip mark is unreadable', e)
    return false
  }
}

function remember(profile: string, key: (profile: string) => string) {
  try {
    localStorage.setItem(key(profile), String(Date.now()))
  } catch (e) {
    console.warn('[prelaunch] skip mark was not saved', e)
  }
}

/** Тяжёлая сборка на ПК с 4 ГБ: одно окно с цифрами и кнопкой на нужную ступень графики; раз в неделю на сборку. */
async function warnWeakPc(profile: string, advice: Extract<RamAdvice, { kind: 'weak' }>) {
  if (skipped(profile, weakSkipKey)) return
  const { presetVideo, cachedHardware } = await import('./gfxPresets')
  const st = GRAPHICS_PRESETS_PUBLIC
    ? await gfxPresetState(profile).catch((e) => {
        console.warn('[prelaunch] graphics state is unavailable', e)
        return null
      })
    : null
  const name = advice.preset === 'potato' ? t('Картошка') : t('Низкие')
  // The step is already there, or the build takes no preset: the window only tells the numbers.
  const offer = !!st && st.applicable && st.preset !== advice.preset && st.preset !== 'potato' && !st.custom
  const answer = await uiChoice(
    t('В сборке {mods} модов, ей нужно {need} ГБ памяти, а на ПК с {total} ГБ игре достанется {have} ГБ. Будет тормозить и может вылететь.', {
      mods: advice.mods,
      need: advice.needGb,
      have: advice.haveGb,
      total: advice.totalGb,
    }),
    {
      title: t('Сборка тяжелее ПК'),
      confirmLabel: offer ? t('Включить «{name}»', { name }) : t('Играть так'),
      cancelLabel: offer ? t('Играть так') : t('Закрыть'),
      danger: false,
    },
  )
  if (answer === 'dismiss') return
  remember(profile, weakSkipKey)
  if (answer !== 'yes' || !offer) return
  const video = presetVideo(advice.preset, await cachedHardware())
  await applyGfxPreset(profile, advice.preset, video, 'own', false).catch((e) =>
    showToast(t('Пресет не применился: {error}', { error: tx(e) }), 'error'),
  )
}

/**
 * Пресет графики ставится здесь, перед запуском: выбор только запоминается, а
 * моды, текстуры и options.txt ядро ставит сейчас, сохранив копию для «Вернуть
 * как было». Свой выбор сборки — всегда; общий («Авто» по умолчанию) — только
 * новой сборке, которую игра ещё не запускала, и сборкам, которые он уже
 * настроил. Сыгранные сборки без выбора не трогаем: для них в «Настройки →
 * Графика» кнопка «Оптимизировать мои сборки» с подтверждением.
 */
async function seedVideo(profile: string) {
  if (!GRAPHICS_PRESETS_PUBLIC) return seedHardwareVideo(profile)
  const { globalChoice, isGfxChoice, presetVideo, resolveChoice, cachedHardware, forBattery, onBattery } = await import('./gfxPresets')
  const st = await gfxPresetState(profile).catch(() => null)
  if (!st || !st.applicable) return
  // Игрок поменял графику в игре: ступень «Своя», не перезаписываем, пока он сам не выберет уровень.
  if (st.custom) return
  const own = isGfxChoice(st.want) ? st.want : null
  const follows = st.fresh || st.source === 'global'
  const choice = own ?? (follows ? (globalChoice() ?? 'auto') : null)
  if (!choice || choice === 'none') return
  const hw = await cachedHardware()
  const picked = resolveChoice(choice, hw, st.shadersOk)
  if (!picked) return
  const battery = await onBattery()
  const { level, video } = battery ? forBattery(picked, hw) : { level: picked, video: presetVideo(picked, hw) }
  const auto = choice === 'auto'
  if (st.preset === level && st.battery === battery && st.auto === auto) return
  await applyGfxPreset(profile, level, video, own ? 'own' : 'global', battery, auto).catch((e) =>
    showToast(t('Пресет не применился: {error}', { error: tx(e) }), 'error'),
  )
}

async function seedHardwareVideo(profile: string) {
  const { hardwareVideo } = await import('./perfTier')
  await seedVideoOptions(profile, await hardwareVideo())
}

export async function prelaunchCare(profile: string): Promise<void> {
  const { ramMbFor } = await import('./launch')
  // The graphics options (a file in the build) and the memory check (numbers about the PC) do not
  // depend on each other, so they run together.
  const [, check] = await Promise.all([
    seedVideo(profile).catch((e) => console.error('[prelaunch] video', e)),
    ramCheck(profile, ramMbFor(profile)).catch((e) => {
      console.warn('[prelaunch] memory check is unavailable', e)
      return null
    }),
  ])
  if (!check) return
  const advice = ramAdvice(check)
  if (advice.kind === 'weak') {
    await warnWeakPc(profile, advice)
    return
  }
  if (advice.kind === 'busy') {
    showToast(t('Компьютеру мало свободной памяти — закрой браузер, чтобы игра не тормозила'), 'error')
    return
  }
  if (advice.kind !== 'raise' || skipped(profile)) return
  const answer = await uiChoice(t('Сборке нужно {need} ГБ памяти, а выделено {have} ГБ. С таким объёмом она будет тормозить и может вылететь.', { need: advice.toGb, have: advice.haveGb }), {
    title: t('Мало памяти'),
    confirmLabel: t('Дать {n} ГБ', { n: advice.toGb }),
    cancelLabel: t('Играть так'),
    danger: false,
  })
  if (answer === 'yes') {
    if (!(await setBuildRamMb(profile, advice.toGb * 1024))) showToast(t('Не удалось сохранить память для сборки'), 'error')
    return
  }
  if (answer !== 'no') return
  remember(profile, skipKey)
}
