import { describe, expect, test } from 'bun:test'
import { hasRendererJar, lagPlan, readVideo, shadersEnabled, type LagFacts } from './lagPlan'

const facts: LagFacts = {
  heapMb: 4096,
  fitMb: 4096,
  boostOffered: false,
  hasRenderer: true,
  shadersOn: false,
  renderDistance: 8,
  graphicsLow: false,
}

describe('lagPlan: главная кнопка лечит самую вероятную причину', () => {
  const cases: [string, boolean, Partial<LagFacts>, string, string][] = [
    ['память вручную занижена, а сборщик мусора не успевает', true, { heapMb: 2048, fitMb: 6144 }, 'memory', 'memory'],
    ['памяти мало, но больше ПК не даст', true, { heapMb: 4096, fitMb: 4096 }, 'memory_pc', 'lite'],
    ['нет Sodium и режим ускорения доступен', false, { boostOffered: true, hasRenderer: false }, 'no_boost', 'no_boost'],
    ['Sodium уже стоит — второй не предлагаем', false, { boostOffered: true, hasRenderer: true }, 'heavy', 'lite'],
    ['шейдеры включены', false, { shadersOn: true }, 'shaders', 'shaders'],
    ['дальность 24', false, { renderDistance: 24 }, 'distance', 'distance'],
    ['всё уже на минимуме — кнопки нет, только Милли', false, { graphicsLow: true }, 'heavy', ''],
  ]
  for (const [why, memory, f, cause, first] of cases) {
    test(why, () => {
      const plan = lagPlan({ memory }, { ...facts, ...f })
      expect(plan.cause).toBe(cause as never)
      expect(plan.fixes[0]?.id ?? '').toBe(first as never)
    })
  }

  test('память поднимается до автоподбора ПК, целыми гигабайтами', () => {
    const plan = lagPlan({ memory: true }, { ...facts, heapMb: 2048, fitMb: 6600 })
    expect(plan.fixes[0]?.steps).toEqual([{ op: 'ram', mb: 6144 }])
  })
})

describe('факты сборки', () => {
  test('рендерер узнаётся по имени jar', () => {
    expect(hasRendererJar(['create-6.0.jar', 'sodium-fabric-0.6.jar'])).toBe(true)
    expect(hasRendererJar(['OptiFine_1.20.1_HD_U_I6.jar'])).toBe(true)
    expect(hasRendererJar(['lithium-0.11.jar', 'create.jar'])).toBe(false)
  })

  test('options.txt: дальность и минимальная графика', () => {
    expect(readVideo('renderDistance:16\ngraphicsMode:1\nparticles:0\n')).toEqual({ renderDistance: 16, graphicsLow: false })
    expect(readVideo('renderDistance:6\r\ngraphicsMode:0\r\nparticles:2\r\n')).toEqual({ renderDistance: 6, graphicsLow: true })
    expect(readVideo(null)).toEqual({ renderDistance: null, graphicsLow: false })
  })

  test('шейдеры включены только при enableShaders=true', () => {
    expect(shadersEnabled('shaderPack=x.zip\nenableShaders=true\n')).toBe(true)
    expect(shadersEnabled('enableShaders=false')).toBe(false)
    expect(shadersEnabled(null)).toBe(false)
  })
})
