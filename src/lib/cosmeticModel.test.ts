import { expect, test } from 'bun:test'
import { Object3D, Vector3 } from 'three'
import { poseJoint } from './cosmeticModel'

const radians = (degrees: number) => (degrees * Math.PI) / 180

/**
 * Вход → вердикт: покой кости - чистое рысканье, анимация крутит по всем трём
 * осям. Кончик обязан встать туда, куда его ставит произведение двух поворотов,
 * а не сумма их углов. Закреплено потому, что сложением углов нижнюю пару
 * «двойных» крыльев уносило на шестнадцать пикселей модели вверх - половину
 * роста игрока, - а верхняя пара крутится почти по оси своего покоя и потому
 * выглядела правильной: одна вещь в каталоге показывала ошибку, остальные её
 * прятали.
 */
test('поворот анимации ложится поверх покоя кости, а не складывается с ним углами', () => {
  const rest: [number, number, number] = [0, -50, 0]
  const turn: [number, number, number] = [-50, 33.5, -47]
  const tip = new Vector3(8, 0, 0)

  const joint = new Object3D()
  poseJoint(joint, rest, turn)
  const got = tip.clone().applyQuaternion(joint.quaternion)

  const composed = new Object3D()
  composed.rotation.set(radians(rest[0]), radians(rest[1]), radians(rest[2]), 'ZYX')
  const inner = new Object3D()
  inner.rotation.set(radians(turn[0]), radians(turn[1]), radians(turn[2]), 'ZYX')
  composed.add(inner)
  composed.updateMatrixWorld(true)
  const want = tip.clone().applyMatrix4(inner.matrixWorld)

  expect(got.distanceTo(want)).toBeLessThan(1e-6)

  const summed = new Object3D()
  summed.rotation.set(radians(rest[0] + turn[0]), radians(rest[1] + turn[1]), radians(rest[2] + turn[2]), 'ZYX')
  const wrong = tip.clone().applyQuaternion(summed.quaternion)
  expect(got.distanceTo(wrong)).toBeGreaterThan(0.5)
})

/** Вход → вердикт: без анимации кость стоит ровно в своём покое. */
test('без анимации кость остаётся в покое, заданном художником', () => {
  const joint = new Object3D()
  poseJoint(joint, [12, -30, 4], [0, 0, 0])
  const plain = new Object3D()
  plain.rotation.set(radians(12), radians(-30), radians(4), 'ZYX')
  expect(joint.quaternion.angleTo(plain.quaternion)).toBeLessThan(1e-6)
})
