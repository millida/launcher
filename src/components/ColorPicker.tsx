import { useEffect, useRef, useState } from 'react'

// Custom HSV picker instead of the native <input type=color> OS dialog.
function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0,
    g = 0,
    b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) }
}
function rgbToHsv(r: number, g: number, b: number) {
  r /= 255
  g /= 255
  b /= 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: mx ? d / mx : 0, v: mx }
}
const hx = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
function hsvHex(h: number, s: number, v: number) {
  const { r, g, b } = hsvToRgb(h, s, v)
  return '#' + hx(r) + hx(g) + hx(b)
}
function parseHex(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return rgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255)
}

export function ColorPicker({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (hex: string) => void
  onClose: () => void
}) {
  const init = parseHex(value) || { h: 130, s: 0.62, v: 0.78 }
  const [h, setH] = useState(init.h)
  const [s, setS] = useState(init.s)
  const [v, setV] = useState(init.v)
  const [hexText, setHexText] = useState(value)
  const svRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const first = useRef(true)

  const hex = hsvHex(h, s, v)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    onChange(hex)
    setHexText(hex)
  }, [h, s, v])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const onSv = (e: React.PointerEvent) => {
    const r = svRef.current!.getBoundingClientRect()
    setS(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
    setV(1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)))
  }
  const onHue = (e: React.PointerEvent) => {
    const r = hueRef.current!.getBoundingClientRect()
    setH(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 360)
  }

  const applyHexText = (t: string) => {
    setHexText(t)
    const p = parseHex(t)
    if (p) {
      setH(p.h)
      setS(p.s)
      setV(p.v)
    }
  }

  return (
    <div className="cpk" ref={rootRef} onClick={(e) => e.stopPropagation()}>
      <div
        className="cpk-sv"
        ref={svRef}
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hsvHex(h, 1, 1)})`,
        }}
        onPointerDown={(e) => {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          onSv(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons) onSv(e)
        }}
      >
        <span className="cpk-sv-thumb" style={{ left: s * 100 + '%', top: (1 - v) * 100 + '%', background: hex }}></span>
      </div>
      <div
        className="cpk-hue"
        ref={hueRef}
        onPointerDown={(e) => {
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          onHue(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons) onHue(e)
        }}
      >
        <span className="cpk-hue-thumb" style={{ left: (h / 360) * 100 + '%' }}></span>
      </div>
      <div className="cpk-foot">
        <span className="cpk-preview" style={{ background: hex }}></span>
        <div className="input sm" style={{ flex: 1 }}>
          <span style={{ color: 'var(--m-fg-faint)', fontWeight: 700 }}>#</span>
          <input
            value={hexText.replace(/^#/, '')}
            maxLength={6}
            onChange={(e) => applyHexText('#' + e.target.value.replace(/[^0-9a-fA-F]/g, ''))}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  )
}
