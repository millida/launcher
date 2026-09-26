import { describe, expect, it } from 'bun:test'
import { PlayerObject } from 'skin3d'
import { Euler, Group, Quaternion, Vector3 } from 'three'
import { readAnimations } from '../../../lib/cosmeticAnimation'
import { CosmeticEmote } from '../../../lib/cosmeticEmote'
import { emoteSequence, type EmoteSequence } from '../../../lib/emoteSequence'
import { blendPoses, capturePose, CAPE_REST_X, capeSwing, resetLimbPose } from './skin-animations'

const turned = (x: number, y: number, z: number) => ({
  quaternion: new Quaternion().setFromEuler(new Euler(x, y, z, 'XYZ')),
})

const leaned = (lean: number) => ({
  quaternion: new Quaternion()
    .setFromEuler(new Euler(lean, 0, 0))
    .multiply(new Quaternion().setFromEuler(new Euler(CAPE_REST_X, Math.PI, 0))),
})

const standingEmote = () => {
  const clip = { name: 'animation.test.stand', length: 1, loop: true, bones: {} }
  const sequence: EmoteSequence = { intro: null, main: clip, clipAt: () => clip, timeAt: (t) => t }
  return new CosmeticEmote(sequence)
}

const loadEngine = async () => {
  const scope = globalThis as { document?: { createElement?: unknown } }
  // scene-loop paints a glow sprite into a canvas at import; nothing here renders.
  // Другой тест мог оставить свой заглушечный document без createElement
  // (cosmeticTimeline/cosmeticIsolation) - дополняем его, а не только когда пусто.
  const had = scope.document
  const needsStub = !had || typeof had.createElement !== 'function'
  if (needsStub) scope.document = { ...(had ?? {}), createElement: () => ({ getContext: () => null }) }
  try {
    return (await import('./scene-loop')).SkinViewEngine
  } finally {
    if (needsStub) scope.document = had
  }
}

describe('качание плаща-вещи вслед за плащом фигуры', () => {
  const CASES: [string, { quaternion: Quaternion }, number, string][] = [
    ['покой', turned(CAPE_REST_X, Math.PI, 0), 0, 'в покое вещь висит там, где её нарисовали'],
    ['дыхание покоя', turned(Math.PI * 0.1, Math.PI, 0), Math.PI * 0.1 - CAPE_REST_X, 'обычное качание не изменилось'],
    ['полёт', turned(Math.PI * 0.72, Math.PI, 0), Math.PI * 0.72 - CAPE_REST_X, 'большой взмах не путается с переворотом'],
    [
      'покой, записанный кватернионом',
      turned(CAPE_REST_X - Math.PI, 0, Math.PI),
      0,
      'эмоция пишет плащ кватернионом, three называет тот же покой (x - π, 0, π); по одному x вещь вставала над головой',
    ],
    ['наклон торса', leaned(0.3), 0.3, 'в эмоции плащ наклоняется с торсом, и вещь - на тот же угол'],
  ]

  for (const [name, cape, wanted, why] of CASES) {
    it(`${name}: ${why}`, () => {
      expect(capeSwing(cape), `${name}: вещь отклонилась не на тот угол, что ткань рядом`).toBeCloseTo(wanted, 5)
    })
  }

  it('кадр эмоции, которая не трогает торс, оставляет ткань в покое', () => {
    const player = new PlayerObject()
    resetLimbPose(player)
    standingEmote().update(player, 1 / 60)
    expect(
      capeSwing(player.cape),
      'эмоция стоит на месте, а плащ-вещь повернулась: её перевернёт над головой, как в жалобе 25.09.2026',
    ).toBeCloseTo(0, 5)
  })

  it('движок качает подвес по направлению ткани, а не по x углов Эйлера', async () => {
    const SkinViewEngine = await loadEngine()
    const player = new PlayerObject()
    player.cape.quaternion.setFromEuler(new Euler(CAPE_REST_X, Math.PI, 0))
    const pivot = new Group()
    const sway = (SkinViewEngine.prototype as unknown as { _swayCosmetics(this: unknown): void })._swayCosmetics
    sway.call({ playerObject: player, _swaying: [pivot] })
    expect(
      pivot.rotation.x,
      'подвес плаща-вещи повёрнут при плаще в покое: движок снова читает x углов и переворачивает вещь',
    ).toBeCloseTo(0, 5)
  })
})

/**
 * Legs hang under body_ext, the way 98 of the hundred emotes rig them, so a
 * squat of body_orbit carries the torso and the legs together. The hip has to
 * hold both across the crossfade into the emote and when the emote reads its
 * rest after a move that shifted the limbs - the two ways the lower body was
 * seen to tear away from the torso and hang as a block below it.
 */
const SQUAT_RIG = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.rig', texture_width: 64, texture_height: 64 },
      bones: [
        { name: 'root', pivot: [0, 0, 0] },
        { name: 'body_orbit', parent: 'root', pivot: [0, 18, 0] },
        { name: 'body_ext', parent: 'body_orbit', pivot: [0, 12, 0] },
        { name: 'body', parent: 'body_ext', pivot: [0, 12, 0] },
        { name: 'head', parent: 'body', pivot: [0, 24, 0] },
        { name: 'arm_left', parent: 'body', pivot: [5, 22, 0] },
        { name: 'arm_right', parent: 'body', pivot: [-5, 22, 0] },
        { name: 'legs', parent: 'body_ext', pivot: [0, 12, 0] },
        { name: 'leg_left', parent: 'legs', pivot: [1.9, 12, 0] },
        { name: 'leg_right', parent: 'legs', pivot: [-1.9, 12, 0] },
      ],
    },
  ],
}

const SQUAT = readAnimations({
  'animation.rig.squat': {
    loop: true,
    animation_length: 2,
    bones: {
      body_orbit: {
        rotation: { '0': [0, 0, 0], '1': [22, 0, 0], '2': [0, 0, 0] },
        position: { '0': [0, 0, 0], '1': [0, -6, 0], '2': [0, 0, 0] },
      },
      leg_left: { rotation: { '0': [0, 0, 0], '1': [-30, 0, 0], '2': [0, 0, 0] } },
      leg_right: { rotation: { '0': [0, 0, 0], '1': [-30, 0, 0], '2': [0, 0, 0] } },
    },
  },
})['animation.rig.squat']!

function hipGap(player: any): number {
  player.updateMatrixWorld(true)
  let worst = 0
  for (const [leg, side] of [['leftLeg', 1.9], ['rightLeg', -1.9]] as const) {
    const hip = player.skin.body.localToWorld(new Vector3(side, -6, 0))
    const joint = player.skin[leg].getWorldPosition(new Vector3())
    worst = Math.max(worst, hip.distanceTo(joint))
  }
  return worst
}

describe('the crossfade into an emote keeps the legs on the hips', () => {
  /** Progress of the 0.38s crossfade -> hip gap must stay whole -> why it is pinned. */
  const STEPS: [number, string][] = [
    [0, 'the first frame of the crossfade holds the rest figure together'],
    [0.15, 'a fifth in, the torso has not raced ahead of the legs into the squat'],
    [0.3, 'a third in, the lower body still hangs on the hips'],
    [0.5, 'halfway, place and turn ramp in together, not place first'],
  ]

  for (const [k, why] of STEPS) {
    it(why, () => {
      const player = new PlayerObject()
      resetLimbPose(player)
      const emote = new CosmeticEmote(emoteSequence({}, SQUAT)!, SQUAT_RIG)
      const from = capturePose(player)
      resetLimbPose(player)
      emote.progress = 1
      emote.update(player, 0)
      const target = capturePose(player)
      blendPoses(player, from, target, k)
      expect(
        hipGap(player),
        `at ${k} of the crossfade the leg hangs ${hipGap(player).toFixed(2)} px off the hip: the torso snapped into the squat while the legs lagged`,
      ).toBeLessThan(0.2)
    })
  }
})

describe('an emote reads its rest from a clean pose, not a shifted one', () => {
  it('a torso the previous move left shifted does not carry the legs off the hips', () => {
    const player = new PlayerObject()
    // As a skin3d walk/run leaves it: the torso and legs pushed off their rest.
    player.skin.body.position.set(0, -2, 4)
    player.skin.leftLeg.position.set(1.9, -12, 2)
    player.skin.rightLeg.position.set(-1.9, -12, 2)
    const emote = new CosmeticEmote(emoteSequence({}, SQUAT)!, SQUAT_RIG)
    resetLimbPose(player)
    emote.progress = 1
    emote.update(player, 0)
    expect(
      hipGap(player),
      `the emote read its rest from the shifted torso and left the legs ${hipGap(player).toFixed(2)} px off the hip`,
    ).toBeLessThan(0.15)
  })
})
