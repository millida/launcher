// macOS 10.13-11 WebKit (Safari 13-14.1) has no aspect-ratio: covers and cards
// collapse to their content. The build copies every aspect-ratio into a carrier
// property inside `@supports not (aspect-ratio: 1 / 1)` (scripts/old-webkit-css.mjs);
// here those rules size the matching elements inline. Engines with aspect-ratio
// never see the carrier rules and this module does nothing there.

export const CARRIER = '--old-webkit-ar'

export interface AspectRule {
  selector: string
  media: string[]
  ratio: number | null
  axis: 'w' | 'h'
}

export function parseCarrier(text: string): Pick<AspectRule, 'ratio' | 'axis'> | null {
  const [ratioText, axisText] = text.trim().split(/\s+/)
  if (ratioText === 'none') return { ratio: null, axis: 'w' }
  const ratio = Number(ratioText)
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null
  return { ratio, axis: axisText === 'h' ? 'h' : 'w' }
}

/** The size to set inline, or null when the element has nothing to size from. */
export function aspectSize(rule: Pick<AspectRule, 'ratio' | 'axis'>, box: { width: number; height: number }) {
  if (rule.ratio === null) return null
  if (rule.axis === 'h') return box.height > 0 ? { prop: 'width' as const, px: box.height * rule.ratio } : null
  return box.width > 0 ? { prop: 'height' as const, px: box.width / rule.ratio } : null
}

function collect(list: CSSRuleList, media: string[], out: AspectRule[], inFallback: boolean) {
  for (const rule of Array.from(list)) {
    if (rule instanceof CSSMediaRule) collect(rule.cssRules, [...media, rule.media.mediaText], out, inFallback)
    else if (rule instanceof CSSSupportsRule) collect(rule.cssRules, media, out, inFallback || rule.conditionText.includes('aspect-ratio'))
    else if (inFallback && rule instanceof CSSStyleRule) {
      const parsed = parseCarrier(rule.style.getPropertyValue(CARRIER))
      if (parsed) out.push({ selector: rule.selectorText, media, ...parsed })
    }
  }
}

function readRules(): AspectRule[] {
  const out: AspectRule[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    collect(rules, [], out, false)
  }
  return out
}

const sized = new Map<HTMLElement, 'width' | 'height'>()

function apply(rules: AspectRule[], observer: ResizeObserver) {
  const active = rules.filter((r) => r.media.every((m) => window.matchMedia(m).matches))
  const winner = new Map<HTMLElement, AspectRule>()
  for (const rule of active) {
    let nodes: NodeListOf<HTMLElement>
    try {
      nodes = document.querySelectorAll<HTMLElement>(rule.selector)
    } catch {
      continue
    }
    nodes.forEach((el) => winner.set(el, rule))
  }
  for (const [el, prop] of sized) {
    const rule = winner.get(el)
    if (rule && rule.ratio !== null && el.isConnected) continue
    el.style.removeProperty(prop)
    observer.unobserve(el)
    sized.delete(el)
  }
  for (const [el, rule] of winner) {
    const rect = el.getBoundingClientRect()
    const size = aspectSize(rule, rect)
    if (!size) continue
    const value = size.px.toFixed(2) + 'px'
    if (el.style.getPropertyValue(size.prop) !== value) el.style.setProperty(size.prop, value)
    if (!sized.has(el)) observer.observe(el)
    sized.set(el, size.prop)
  }
}

export function installAspectRatioFallback(): void {
  if (typeof CSS === 'undefined' || CSS.supports('aspect-ratio', '1 / 1')) return
  if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return
  let rules = readRules()
  let sheets = document.styleSheets.length
  let frame = 0
  const observer = new ResizeObserver(() => schedule())
  function schedule() {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (document.styleSheets.length !== sheets) {
        sheets = document.styleSheets.length
        rules = readRules()
      }
      apply(rules, observer)
    })
  }
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  })
  document.addEventListener('load', (e) => {
    if (e.target instanceof HTMLLinkElement) {
      rules = readRules()
      schedule()
    }
  }, true)
  window.addEventListener('resize', schedule)
  schedule()
}
