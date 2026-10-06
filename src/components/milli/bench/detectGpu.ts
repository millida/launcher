import { gpuLite } from '../../../lib/gpuLite'

const GPU_KEY = 'm-gpu-name'
let gpuName: string | null = null

/**
 * Видеокарта по WebGL (WEBGL_debug_renderer_info): один крошечный контекст за
 * запуск, сразу отпускаем. После сбоя видеокарты (gpuLite) WebGL не трогаем.
 */
export function detectGpu(): string {
  if (gpuName !== null) return gpuName
  gpuName = ''
  try {
    const c = localStorage.getItem(GPU_KEY)
    if (c) return (gpuName = c)
  } catch {}
  if (typeof document === 'undefined' || gpuLite()) return gpuName
  try {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    const gl = cv.getContext('webgl') as WebGLRenderingContext | null
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      const r: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      gpuName = typeof r === 'string' ? r.slice(0, 120) : ''
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  } catch {}
  try {
    if (gpuName) localStorage.setItem(GPU_KEY, gpuName)
  } catch {}
  return gpuName
}
