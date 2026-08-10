// Геометрия и pose ног для product viewer — идемпотентный сброс при setSkin
import type { BodyPart, SkinObject } from "skin3d";
import { BoxGeometry, BufferAttribute, Group, Mesh } from "three";
import { SKIN_TEXTURE_SIZE } from "./skin-uv-inset";

/** Inner-слой ноги — как BoxGeometry(4, 12, 4) в skin3d */
export const STOCK_LEG_INNER_SIZE = [4, 12, 4] as const;

/**
 * Outer штаны.
 *
 * Stock skin3d: 4.5×12.5×4.5 (+0.25/сторону). При X=±1.9 край outer = ±4.15,
 * а body inner = ±4.0. Если jacket (body outer 8.5) пустой/cutout — виден выступ
 * 0.15 и «уступ» торца бедра на стыке (как на скринах).
 *
 * Продукт (отход от stock ради силуэта):
 *   X = 4.2  (+0.1/сторону) → край ±(1.9+2.1)=±4.0, flush с body inner;
 *   Y/Z = 12.5×4.5 — stock inflate, объём overlay без бокового выступа.
 * +0.1 по X достаточно, чтобы outer не был копланарен inner (z-fighting).
 */
export const STOCK_LEG_OUTER_SIZE = [4.2, 12.5, 4.5] as const;

/**
 * Pose ног.
 * X/Y — stock skin3d/launcher (±1.9, −12).
 * Z: stock = −0.1 даёт щель на стыке бедро–торс в three-quarter ракурсе;
 * продукт = 0 — ровный стык сверху.
 */
export const STOCK_RIGHT_LEG_POSE = { x: -1.9, y: -12, z: 0 } as const;
export const STOCK_LEFT_LEG_POSE = { x: 1.9, y: -12, z: 0 } as const;

/** Pivot ноги в skin3d: Group с position.y = −6 внутри BodyPart */
const LEG_PIVOT_Y = -6;

type LegUVSpec = {
  inner: { u: number; v: number };
  outer: { u: number; v: number };
};

const LEG_UV: Record<"rightLeg" | "leftLeg", LegUVSpec> = {
  rightLeg: { inner: { u: 0, v: 16 }, outer: { u: 0, v: 32 } },
  leftLeg: { inner: { u: 16, v: 48 }, outer: { u: 0, v: 48 } },
};

// ===== Stock UV (порт setSkinUVs из skin3d Model.js) =====

function setSkinUVs(
  box: BoxGeometry,
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
  textureSize: number = SKIN_TEXTURE_SIZE,
): void {
  const toFaceVertices = (x1: number, y1: number, x2: number, y2: number) => [
    [x1 / textureSize, 1.0 - y2 / textureSize],
    [x2 / textureSize, 1.0 - y2 / textureSize],
    [x2 / textureSize, 1.0 - y1 / textureSize],
    [x1 / textureSize, 1.0 - y1 / textureSize],
  ];

  const top = toFaceVertices(u + depth, v, u + width + depth, v + depth);
  const bottom = toFaceVertices(u + width + depth, v, u + width * 2 + depth, v + depth);
  const left = toFaceVertices(u, v + depth, u + depth, v + depth + height);
  const front = toFaceVertices(u + depth, v + depth, u + width + depth, v + depth + height);
  const right = toFaceVertices(u + width + depth, v + depth, u + width + depth * 2, v + height + depth);
  const back = toFaceVertices(u + width + depth * 2, v + depth, u + width * 2 + depth * 2, v + height + depth);

  const uvAttr = box.attributes.uv as BufferAttribute;
  if (!uvAttr) return;

  const uvRight = [right[3], right[2], right[0], right[1]];
  const uvLeft = [left[3], left[2], left[0], left[1]];
  const uvTop = [top[3], top[2], top[0], top[1]];
  const uvBottom = [bottom[0], bottom[1], bottom[3], bottom[2]];
  const uvFront = [front[3], front[2], front[0], front[1]];
  const uvBack = [back[3], back[2], back[0], back[1]];

  const newUVData: number[] = [];
  for (const uvArray of [uvRight, uvLeft, uvTop, uvBottom, uvFront, uvBack]) {
    for (const uv of uvArray) {
      newUVData.push(uv[0], uv[1]);
    }
  }

  uvAttr.set(new Float32Array(newUVData));
  uvAttr.needsUpdate = true;
}

function boxMatchesSize(
  geometry: BoxGeometry,
  width: number,
  height: number,
  depth: number,
): boolean {
  const params = geometry.parameters;
  return (
    Math.abs(params.width - width) < 1e-6 &&
    Math.abs(params.height - height) < 1e-6 &&
    Math.abs(params.depth - depth) < 1e-6
  );
}

function restoreLegLayerMesh(
  mesh: Mesh,
  size: readonly [number, number, number],
  u: number,
  v: number,
  textureSize: number,
): void {
  const [width, height, depth] = size;
  const needsRebuild =
    !(mesh.geometry instanceof BoxGeometry) ||
    !boxMatchesSize(mesh.geometry, width, height, depth);

  if (needsRebuild) {
    mesh.geometry.dispose();
    mesh.geometry = new BoxGeometry(width, height, depth);
  }

  // Ноги — без unit-box scale (в отличие от рук); scale ≠ 1 ломает пропорции
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  setSkinUVs(mesh.geometry as BoxGeometry, u, v, 4, 12, 4, textureSize);
}

/** Pivot + локальные transform ног — как в skin3d Model.js */
function restoreLegPivot(part: BodyPart): void {
  part.scale.set(1, 1, 1);

  const inner = part.innerLayer as Mesh;
  const pivot = inner.parent;
  // BodyPart → Pivot(Group, y=−6) → inner/outer meshes
  if (pivot instanceof Group && pivot !== part) {
    pivot.position.set(0, LEG_PIVOT_Y, 0);
    pivot.rotation.set(0, 0, 0);
    pivot.scale.set(1, 1, 1);
  }
}

function restoreLegPartMeshes(
  part: BodyPart,
  spec: LegUVSpec,
  textureSize: number,
): void {
  restoreLegPivot(part);
  restoreLegLayerMesh(
    part.innerLayer as Mesh,
    STOCK_LEG_INNER_SIZE,
    spec.inner.u,
    spec.inner.v,
    textureSize,
  );
  restoreLegLayerMesh(
    part.outerLayer as Mesh,
    STOCK_LEG_OUTER_SIZE,
    spec.outer.u,
    spec.outer.v,
    textureSize,
  );
}

/**
 * Восстанавливает геометрию/pivot/scale ног и stock pose.
 * Идемпотентно при каждом setSkin — защита от накопления inflate/scale.
 */
export function restoreStockLegMeshes(
  skin: SkinObject,
  textureSize: number = SKIN_TEXTURE_SIZE,
): void {
  restoreLegPartMeshes(skin.rightLeg, LEG_UV.rightLeg, textureSize);
  restoreLegPartMeshes(skin.leftLeg, LEG_UV.leftLeg, textureSize);
  applyStockLegPose(skin);
}

/** Pose ног продукта — вызывается каждый кадр после idle (ноги не анимируем) */
export function applyStockLegPose(skin: SkinObject): void {
  skin.rightLeg.position.set(
    STOCK_RIGHT_LEG_POSE.x,
    STOCK_RIGHT_LEG_POSE.y,
    STOCK_RIGHT_LEG_POSE.z,
  );
  skin.leftLeg.position.set(
    STOCK_LEFT_LEG_POSE.x,
    STOCK_LEFT_LEG_POSE.y,
    STOCK_LEFT_LEG_POSE.z,
  );
  skin.rightLeg.rotation.set(0, 0, 0);
  skin.leftLeg.rotation.set(0, 0, 0);
}
