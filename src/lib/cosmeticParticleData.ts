/** Seconds a still figure's effect is run ahead, so a reduced-motion or lite frame shows a formed aura instead of an empty one. */
export const PARTICLE_WARM_SECONDS = 1.2

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// A lite PC keeps the aura but not its per-frame simulation: up to thousands of CPU-built quads every frame is the cost it opted out of.
export const particlesStill = (lite: boolean): boolean => lite || reducedMotion()

export const hasParticles =(slot: string | undefined): boolean => slot === 'EFFECT'

export const particleKey = (model: string): string => model.replace(/^geometry\./, '')

type Book = Record<string, unknown>

let book: Promise<Book | null> | null = null

// The book is 166 KB: it must stay a lazy chunk, fetched only when an effect is actually worn.
function loadBook(): Promise<Book | null> {
  if (!book) {
    book = import('./cosmeticParticles.json').then(
      (m) => m.default as unknown as Book,
      () => {
        book = null
        return null
      },
    )
  }
  return book
}

export function pickParticles(source: Book | null, model: string | undefined): unknown {
  if (!source || !model) return null
  const key = particleKey(model)
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : null
}

export async function particlesOf(model: string | undefined): Promise<unknown> {
  if (!model) return null
  return pickParticles(await loadBook(), model)
}
