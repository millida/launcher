/**
 * The slice of Molang an animation keyframe uses: numbers, arithmetic,
 * comparisons, the ternary, `math.*` and the clip clock. Bedrock files write
 * a looping sway as `"(36.0+math.sin(query.anim_time*360.0*6.0)*0.3)"`; read as
 * a plain number it became zero, and "Anime love" stood the torso upright off
 * its legs while the numeric shifts of the same keyframe still applied.
 *
 * Names nothing here knows (`variable.*`, entity queries) read as zero, as the
 * game reads an unset variable.
 */

export interface MolangClock {
  /** Seconds since the clip began; a loop starts again from zero. */
  animTime: number
  /** Seconds since the figure began animating at all. */
  lifeTime: number
}

export type Molang = (clock: MolangClock) => number

const DEG = Math.PI / 180

const MATH: Record<string, (...args: number[]) => number> = {
  abs: Math.abs,
  sin: (degrees) => Math.sin((degrees ?? 0) * DEG),
  cos: (degrees) => Math.cos((degrees ?? 0) * DEG),
  asin: (value) => Math.asin(value ?? 0) / DEG,
  acos: (value) => Math.acos(value ?? 0) / DEG,
  atan: (value) => Math.atan(value ?? 0) / DEG,
  atan2: (y, x) => Math.atan2(y ?? 0, x ?? 0) / DEG,
  clamp: (value, low, high) => Math.min(Math.max(value ?? 0, low ?? 0), high ?? 0),
  lerp: (from, to, k) => (from ?? 0) + ((to ?? 0) - (from ?? 0)) * (k ?? 0),
  min: (a, b) => Math.min(a ?? 0, b ?? 0),
  max: (a, b) => Math.max(a ?? 0, b ?? 0),
  pow: (base, power) => Math.pow(base ?? 0, power ?? 0),
  sqrt: (value) => Math.sqrt(value ?? 0),
  exp: (value) => Math.exp(value ?? 0),
  ln: (value) => Math.log(value ?? 0),
  floor: (value) => Math.floor(value ?? 0),
  ceil: (value) => Math.ceil(value ?? 0),
  round: (value) => Math.round(value ?? 0),
  trunc: (value) => Math.trunc(value ?? 0),
  mod: (value, by) => (value ?? 0) % (by ?? 1),
  // A preview has no seed to share with the game: a random offset would shake
  // the figure every frame, so the middle of the range stands in for it.
  random: (low, high) => ((low ?? 0) + (high ?? 1)) / 2,
  random_integer: (low, high) => Math.round(((low ?? 0) + (high ?? 1)) / 2),
  die_roll: (count, low, high) => ((count ?? 0) * ((low ?? 0) + (high ?? 1))) / 2,
  die_roll_integer: (count, low, high) => Math.round(((count ?? 0) * ((low ?? 0) + (high ?? 1))) / 2),
}

const CONSTANTS: Record<string, number> = { 'math.pi': Math.PI, true: 1, false: 0 }

const QUERIES: Record<string, (clock: MolangClock) => number> = {
  'query.anim_time': (clock) => clock.animTime,
  'query.life_time': (clock) => clock.lifeTime,
}

const ALIASES: Record<string, string> = { q: 'query', v: 'variable', t: 'temp', c: 'context' }

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'op'; value: string }

const OPERATORS = ['&&', '||', '==', '!=', '<=', '>=', '??', '+', '-', '*', '/', '(', ')', ',', '?', ':', '<', '>', '!']

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]!
    if (/\s/.test(ch)) {
      i++
      continue
    }
    const number = /^(\d+\.?\d*|\.\d+)f?/i.exec(source.slice(i))
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[1]) })
      i += number[0].length
      continue
    }
    const name = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*/i.exec(source.slice(i))
    if (name) {
      const parts = name[0].toLowerCase().split('.')
      parts[0] = ALIASES[parts[0]!] ?? parts[0]!
      tokens.push({ kind: 'name', value: parts.join('.') })
      i += name[0].length
      continue
    }
    const op = OPERATORS.find((candidate) => source.startsWith(candidate, i))
    if (!op) return null
    tokens.push({ kind: 'op', value: op })
    i += op.length
  }
  return tokens
}

class Parser {
  private at = 0

  constructor(private readonly tokens: Token[]) {}

  parse(): Molang | null {
    const expression = this.ternary()
    return this.at === this.tokens.length ? expression : null
  }

  private peek(value: string): boolean {
    const token = this.tokens[this.at]
    return token?.kind === 'op' && token.value === value
  }

  private take(value: string): boolean {
    if (!this.peek(value)) return false
    this.at++
    return true
  }

  private expect(value: string): void {
    if (!this.take(value)) throw new SyntaxError('expected ' + value)
  }

  private ternary(): Molang {
    const condition = this.coalesce()
    if (!this.take('?')) return condition
    const yes = this.ternary()
    if (!this.take(':')) return (clock) => (condition(clock) ? yes(clock) : 0)
    const no = this.ternary()
    return (clock) => (condition(clock) ? yes(clock) : no(clock))
  }

  private coalesce(): Molang {
    let left = this.or()
    while (this.take('??')) left = this.or()
    return left
  }

  private or(): Molang {
    let left = this.and()
    while (this.take('||')) {
      const a = left
      const b = this.and()
      left = (clock) => (a(clock) || b(clock) ? 1 : 0)
    }
    return left
  }

  private and(): Molang {
    let left = this.compare()
    while (this.take('&&')) {
      const a = left
      const b = this.compare()
      left = (clock) => (a(clock) && b(clock) ? 1 : 0)
    }
    return left
  }

  private compare(): Molang {
    let left = this.sum()
    for (;;) {
      const op = ['==', '!=', '<=', '>=', '<', '>'].find((candidate) => this.peek(candidate))
      if (!op) return left
      this.at++
      const a = left
      const b = this.sum()
      const test: Record<string, (x: number, y: number) => boolean> = {
        '==': (x, y) => x === y,
        '!=': (x, y) => x !== y,
        '<=': (x, y) => x <= y,
        '>=': (x, y) => x >= y,
        '<': (x, y) => x < y,
        '>': (x, y) => x > y,
      }
      const check = test[op]!
      left = (clock) => (check(a(clock), b(clock)) ? 1 : 0)
    }
  }

  private sum(): Molang {
    let left = this.product()
    for (;;) {
      if (this.take('+')) {
        const a = left
        const b = this.product()
        left = (clock) => a(clock) + b(clock)
      } else if (this.take('-')) {
        const a = left
        const b = this.product()
        left = (clock) => a(clock) - b(clock)
      } else return left
    }
  }

  private product(): Molang {
    let left = this.unary()
    for (;;) {
      if (this.take('*')) {
        const a = left
        const b = this.unary()
        left = (clock) => a(clock) * b(clock)
      } else if (this.take('/')) {
        const a = left
        const b = this.unary()
        left = (clock) => {
          const by = b(clock)
          return by === 0 ? 0 : a(clock) / by
        }
      } else return left
    }
  }

  private unary(): Molang {
    if (this.take('-')) {
      const inner = this.unary()
      return (clock) => -inner(clock)
    }
    if (this.take('+')) return this.unary()
    if (this.take('!')) {
      const inner = this.unary()
      return (clock) => (inner(clock) ? 0 : 1)
    }
    return this.primary()
  }

  private primary(): Molang {
    const token = this.tokens[this.at++]
    if (!token) throw new SyntaxError('unexpected end')
    if (token.kind === 'number') {
      const value = token.value
      return () => value
    }
    if (token.kind === 'op') {
      if (token.value !== '(') throw new SyntaxError('unexpected ' + token.value)
      const inner = this.ternary()
      this.expect(')')
      return inner
    }
    const name = token.value
    const args: Molang[] = []
    if (this.take('(')) {
      if (!this.take(')')) {
        do args.push(this.ternary())
        while (this.take(','))
        this.expect(')')
      }
    }
    const fn = name.startsWith('math.') ? MATH[name.slice(5)] : undefined
    if (fn) return (clock) => fn(...args.map((arg) => arg(clock)))
    const query = QUERIES[name]
    if (query) return query
    const constant = CONSTANTS[name] ?? 0
    return () => constant
  }
}

/**
 * The expression as a function of the clip clock, or null for text that is not
 * an expression this reader understands - the caller keeps its fallback then.
 */
export function compileMolang(source: string): Molang | null {
  const body = source
    .trim()
    .replace(/^return\s+/i, '')
    .replace(/;\s*$/, '')
  if (!body || body.includes(';') || /(^|[^=!<>])=($|[^=])/.test(body)) return null
  const tokens = tokenize(body)
  if (!tokens) return null
  try {
    return new Parser(tokens).parse()
  } catch {
    return null
  }
}
