import { useEffect, useState } from 'react'
import { listLoaderVersions } from '../ipc/commands'
import { hasTauri } from '../ipc/tauri'

/**
 * Какие загрузчики лаунчер реально поставит на версию Minecraft. Ядро умеет
 * все четыре (engine/game/install.rs: fabric, quilt — через meta, forge и
 * neoforge — инсталлером), но у каждого своя граница версий. Правило ниже —
 * известные границы проектов; в приложении оно уточняется живым списком
 * сборок загрузчика (тот же list_loader_versions, что у «Версии загрузчика»):
 * пустой список или «не найден» — значит, под эту версию сборки нет.
 * Неактивный загрузчик показывается с короткой причиной, а не прячется.
 */

export type LoaderId = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export const LOADER_IDS: LoaderId[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']

interface Ver {
  /** Числа релиза, к которому относится версия (1.21-pre1 → 1.21). */
  nums: number[] | null
  /** Недельный снапшот 24w14a: год и неделя. */
  week: [number, number] | null
  release: boolean
  old: boolean
}

function parse(id: string, kind: string): Ver {
  const w = /^(\d{2})w(\d{2})[a-z]$/.exec(id)
  if (w) return { nums: null, week: [Number(w[1]), Number(w[2])], release: false, old: false }
  const base = id.split(/[-_ ]/)[0] || id
  const nums = /^\d+(\.\d+)*$/.test(base) ? base.split('.').map(Number) : null
  return {
    nums,
    week: null,
    release: kind === 'release',
    old: kind === 'old_beta' || kind === 'old_alpha',
  }
}

/** a >= b по числам версии; 26.x (годовые релизы) новее любой 1.x. */
function atLeast(nums: number[], min: number[]): boolean {
  if ((nums[0] || 0) !== (min[0] || 0)) return (nums[0] || 0) > (min[0] || 0)
  for (let i = 1; i < Math.max(nums.length, min.length); i++) {
    const a = nums[i] || 0
    const b = min[i] || 0
    if (a !== b) return a > b
  }
  return true
}

/** null — можно ставить; строка — короткая причина, почему нельзя. */
export function loaderBlock(loader: LoaderId, id: string, kind: string): string | null {
  if (loader === 'vanilla' || !id) return null
  const v = parse(id, kind)
  if (v.old) return 'Не для бет'
  if (loader === 'fabric' || loader === 'quilt') {
    // Fabric и Quilt — с 1.14 и её снапшотов (18w43b).
    if (v.week) return v.week[0] > 18 || (v.week[0] === 18 && v.week[1] >= 43) ? null : 'С 1.14'
    if (!v.nums) return null
    return atLeast(v.nums, [1, 14]) ? null : 'С 1.14'
  }
  // Forge и NeoForge выходят только под релизы.
  if (!v.release) return 'Только релизы'
  if (loader === 'neoforge') return v.nums && atLeast(v.nums, [1, 20, 2]) ? null : 'С 1.20.2'
  return v.nums && atLeast(v.nums, [1, 1]) ? null : 'Нет под ' + id
}

const liveCache = new Map<string, Promise<boolean | null>>()
/** Есть ли сборка загрузчика под версию. null — не выяснили (нет сети): верим правилу. */
function liveHas(loader: LoaderId, id: string): Promise<boolean | null> {
  const key = loader + '|' + id
  const hit = liveCache.get(key)
  if (hit) return hit
  const asked = listLoaderVersions(loader, id).then(
    (l) => Array.isArray(l) && l.length > 0,
    (e) => (/не найден|not found/i.test(String(e)) ? false : null),
  )
  liveCache.set(key, asked)
  return asked
}

/** Причина недоступности по каждому загрузчику для выбранной версии. */
export function useLoaderBlocks(id: string, kind: string, active: boolean): Record<LoaderId, string | null> {
  const base = () =>
    Object.fromEntries(LOADER_IDS.map((l) => [l, loaderBlock(l, id, kind)])) as Record<LoaderId, string | null>
  const [out, setOut] = useState(base)
  useEffect(() => {
    const now = base()
    setOut(now)
    if (!active || !id || !hasTauri()) return
    let alive = true
    for (const l of LOADER_IDS) {
      if (l === 'vanilla' || now[l]) continue
      void liveHas(l, id).then((has) => {
        if (alive && has === false) setOut((o) => ({ ...o, [l]: 'Нет под ' + id }))
      })
    }
    return () => {
      alive = false
    }
  }, [id, kind, active])
  return out
}

/** Подпись версии в списке: снапшот, pre, rc, бета, альфа. */
export function versionTag(id: string, kind: string): string | null {
  if (kind === 'release') return null
  if (kind === 'old_beta') return 'бета'
  if (kind === 'old_alpha') return 'альфа'
  if (/-pre|pre-release| Pre-Release/i.test(id)) return 'pre'
  if (/-rc/i.test(id)) return 'rc'
  return 'снапшот'
}
