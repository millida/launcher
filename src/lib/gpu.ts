const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|generic renderer/i
const VENDOR_ONLY = /^(nvidia|amd|ati|intel|apple|microsoft|google|mesa|qualcomm|arm)\.?$/i

function stripNoise(name: string): string {
  return name
    .replace(/\((?:0x)?[0-9a-f]{4,}\)/gi, ' ')
    .replace(/\s*\([^()]*(?:llvm|drm|mesa|radeonsi|bits|kernel)[^()]*\)/gi, ' ')
    .replace(/direct3d\s*\d+/gi, ' ')
    .replace(/\bvs_\d+_\d+\b|\bps_\d+_\d+\b/gi, ' ')
    .replace(/opengl engine/gi, ' ')
    .replace(/\bd3d\d+\b|\bopengl\b|\bvulkan\b|\bmetal\b/gi, ' ')
    .replace(/\/(pcie|sse2)\b/gi, ' ')
    .replace(/\((r|tm)\)/gi, ' ')
    .replace(/[,;]+\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/// WebGL reports the adapter through ANGLE on Windows, so the useful model sits
/// in the middle of "ANGLE (vendor, model, backend)".
function unwrapAngle(raw: string): string {
  const m = raw.match(/^angle\s*\((.*)\)\s*$/i)
  if (!m) return raw
  const parts = m[1].split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length >= 2) return parts[1]
  return parts[0] ?? raw
}

export function normalizeGpu(raw: string): string | undefined {
  if (!raw) return undefined
  if (SOFTWARE.test(raw)) return 'Программный рендер'
  const name = stripNoise(unwrapAngle(raw.trim()))
  if (!name || name.length < 3 || VENDOR_ONLY.test(name)) return undefined
  return name.slice(0, 96)
}

export function detectGpu(): string | undefined {
  try {
    if (typeof document === 'undefined') return undefined
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return undefined
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const raw = info
      ? (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as unknown)
      : (gl.getParameter(gl.RENDERER) as unknown)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return typeof raw === 'string' ? normalizeGpu(raw) : undefined
  } catch {
    return undefined
  }
}
