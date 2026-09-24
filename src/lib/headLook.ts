import { Vector3 } from 'three'
import type { PoseHookContext } from '../vendor/mine3d'

/**
 * Взгляд за мышкой (владелец 24.09.2026): в покое голова персонажа плавно
 * поворачивается к курсору — где бы он ни был на экране. Корпус не трогаем:
 * он поворачивался за мышью, пока человек тянулся к кнопкам, — «персонаж
 * скачет» (23.09.2026). Во время эмоции, клипа и вращения фигуры голова
 * своя; после — плавно возвращается к курсору.
 *
 * Работает через поправку позы движка (setPoseHook): она идёт после анимации
 * и до отрисовки, поэтому покой не перетирает поворот головы.
 */

/** Вбок: ±0.7 рад от направления на камеру, всего — не больше ±1.0 */
const YAW_AIM = 0.7
const YAW_MAX = 1.0
/** Вверх-вниз: ±0.45 рад */
const PITCH_MAX = 0.45
/** Пикселей на радиан: курсор в полэкрана от головы — уже почти предел */
const PX_PER_RAD_X = 500
const PX_PER_RAD_Y = 600
/** Как быстро голова догоняет курсор и как быстро включается/гаснет взгляд */
const AIM_RATE = 9
const WEIGHT_RATE = 5

let pointer: { x: number; y: number } | null = null
let listening = false
function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener(
    'pointermove',
    (e) => {
      pointer = { x: e.clientX, y: e.clientY }
    },
    { passive: true },
  )
}

const clamp = (v: number, a: number) => Math.max(-a, Math.min(a, v))

/** Куда повернуть голову (рад) при курсоре в (mx,my) и голове в (hx,hy) на экране. */
export function aimAt(mx: number, my: number, hx: number, hy: number): { yaw: number; pitch: number } {
  return {
    yaw: clamp((mx - hx) / PX_PER_RAD_X, YAW_AIM),
    pitch: clamp((my - hy) / PX_PER_RAD_Y, PITCH_MAX),
  }
}

/**
 * Поправка позы для движка: `engine.setPoseHook(headLook(() => занят))`.
 * `busy` — сейчас голову не трогаем (эмоция, человек крутит фигуру).
 */
export function headLook(busy: () => boolean = () => false): (ctx: PoseHookContext) => void {
  listen()
  const v = new Vector3()
  let yaw = 0
  let pitch = 0
  let weight = 0
  return ({ head, camera, canvas, dt, facing, idle }) => {
    const k = (rate: number) => 1 - Math.exp(-rate * Math.max(0, Math.min(dt, 0.1)))
    // Фигура отвернулась от камеры — к экрану ей не повернуться, взгляд гасим.
    const front = Math.max(0, Math.min(1, (1.6 - Math.abs(facing)) / 0.6))
    const want = idle && !busy() ? front : 0
    weight += (want - weight) * k(WEIGHT_RATE)
    if (weight < 0.002 && want === 0) {
      weight = 0
      // Стартуем потом из позы анимации, а не из старого взгляда.
      yaw = head.rotation.y
      pitch = head.rotation.x
      return
    }
    let ty = facing
    let tp = 0
    if (pointer) {
      head.getWorldPosition(v)
      v.project(camera)
      const r = canvas.getBoundingClientRect()
      if (r.width && r.height) {
        const a = aimAt(pointer.x, pointer.y, r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height)
        ty += a.yaw
        tp = a.pitch
      }
    }
    ty = clamp(ty, YAW_MAX)
    yaw += (ty - yaw) * k(AIM_RATE)
    pitch += (tp - pitch) * k(AIM_RATE)
    // Смешиваем с позой анимации: при weight=1 голова целиком наша.
    head.rotation.y += (yaw - head.rotation.y) * weight
    head.rotation.x += (pitch - head.rotation.x) * weight
    head.rotation.z += (yaw * 0.05 - head.rotation.z) * weight
  }
}
