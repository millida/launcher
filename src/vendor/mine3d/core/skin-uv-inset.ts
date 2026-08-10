// UV-inset на существующих BoxGeometry skin3d — без пересборки outer-слоя
import type { SkinObject } from "skin3d";
import { BoxGeometry, BufferAttribute, Mesh, Vector2 } from "three";
import { restoreStockLegMeshes } from "./skin-leg-stock";

/** Размер атласа скина (texels) */
export const SKIN_TEXTURE_SIZE = 64;

/**
 * UV-inset в texels — против «левитирующих» линий в воздухе по краям граней.
 *
 * При MSAA фрагментный шейдер считается в центре пикселя даже у частично
 * покрытых пикселей на краю полигона. UV там экстраполируется чуть за границу
 * грани, и NearestFilter берёт СОСЕДНИЙ тексель атласа — часто непрозрачный и
 * тёмный. Он проходит alphaTest и рисуется с частичным покрытием, давая тонкую
 * линию темнее фона рядом с силуэтом (даже там, где overlay полностью прозрачен).
 *
 * Без MSAA достаточно ~0.2 texel против каймы на стыках граней куба.
 * Большие значения (≥0.75) сжимают текстуру и дают тёмные рамки на overlay.
 */
export const SKIN_UV_INSET_TEXELS = 0.22;

/** UV-inset outer-слоя; та же причина, что и для inner */
export const SKIN_OUTER_UV_INSET_TEXELS = 0.22;

export interface SkinUVInsetOptions {
  insetTexels?: number;
  /** UV-inset отдельно для outer-слоя; 0 отключает и возвращает stock UV skin3d */
  outerInsetTexels?: number;
  textureSize?: number;
}

// ===== Stock UV skin3d (порт setSkinUVs из Model.js) =====

/** Стандартная раскладка UV Minecraft-скина на BoxGeometry */
function setSkinUVs(
  box: BoxGeometry,
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
  textureSize: number = SKIN_TEXTURE_SIZE,
): void {
  const toFaceVertices = (x1: number, y1: number, x2: number, y2: number): Vector2[] => [
    new Vector2(x1 / textureSize, 1.0 - y2 / textureSize),
    new Vector2(x2 / textureSize, 1.0 - y2 / textureSize),
    new Vector2(x2 / textureSize, 1.0 - y1 / textureSize),
    new Vector2(x1 / textureSize, 1.0 - y1 / textureSize),
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
      newUVData.push(uv.x, uv.y);
    }
  }

  uvAttr.set(new Float32Array(newUVData));
  uvAttr.needsUpdate = true;
}

function restoreMeshStockUVs(
  mesh: Mesh,
  u: number,
  v: number,
  width: number,
  height: number,
  depth: number,
  textureSize: number,
): void {
  if (!(mesh.geometry instanceof BoxGeometry)) return;
  setSkinUVs(mesh.geometry, u, v, width, height, depth, textureSize);
}

/**
 * Восстанавливает stock UV всех частей тела skin3d перед повторным inset.
 * Без этого inset накапливается при каждом setSkin (head/body/legs не сбрасываются через modelType).
 */
export function restoreStockSkinUVs(
  skin: SkinObject,
  textureSize: number = SKIN_TEXTURE_SIZE,
): void {
  const slim = skin.modelType === "slim";
  const armWidth = slim ? 3 : 4;

  restoreMeshStockUVs(skin.head.innerLayer as Mesh, 0, 0, 8, 8, 8, textureSize);
  restoreMeshStockUVs(skin.head.outerLayer as Mesh, 32, 0, 8, 8, 8, textureSize);
  restoreMeshStockUVs(skin.body.innerLayer as Mesh, 16, 16, 8, 12, 4, textureSize);
  restoreMeshStockUVs(skin.body.outerLayer as Mesh, 16, 32, 8, 12, 4, textureSize);
  restoreMeshStockUVs(skin.rightArm.innerLayer as Mesh, 40, 16, armWidth, 12, 4, textureSize);
  restoreMeshStockUVs(skin.rightArm.outerLayer as Mesh, 40, 32, armWidth, 12, 4, textureSize);
  restoreMeshStockUVs(skin.leftArm.innerLayer as Mesh, 32, 48, armWidth, 12, 4, textureSize);
  restoreMeshStockUVs(skin.leftArm.outerLayer as Mesh, 48, 48, armWidth, 12, 4, textureSize);
  restoreMeshStockUVs(skin.rightLeg.innerLayer as Mesh, 0, 16, 4, 12, 4, textureSize);
  restoreMeshStockUVs(skin.rightLeg.outerLayer as Mesh, 0, 32, 4, 12, 4, textureSize);
  restoreMeshStockUVs(skin.leftLeg.innerLayer as Mesh, 16, 48, 4, 12, 4, textureSize);
  restoreMeshStockUVs(skin.leftLeg.outerLayer as Mesh, 0, 48, 4, 12, 4, textureSize);
}

/** Сдвиг координаты к центру грани, но не дальше 49% расстояния до центра */
function moveTowards(value: number, center: number, amount: number): number {
  const delta = center - value;
  const distance = Math.abs(delta);
  if (distance <= 1e-8) return value;

  return value + Math.sign(delta) * Math.min(amount, distance * 0.49);
}

/**
 * Сдвигает UV каждой грани BoxGeometry к её центру на insetTexels.
 * Модифицирует только атрибут uv — геометрию и материалы не трогает.
 */
export function insetBoxGeometryUVs(
  geometry: BoxGeometry,
  insetTexels: number = SKIN_UV_INSET_TEXELS,
  textureSize: number = SKIN_TEXTURE_SIZE,
): void {
  if (insetTexels <= 0) return;

  const uvAttr = geometry.attributes.uv;
  if (!uvAttr) return;

  const inset = insetTexels / textureSize;
  const count = uvAttr.count;

  // BoxGeometry: 6 граней × 4 вершины
  for (let face = 0; face < 6; face++) {
    const base = face * 4;
    if (base + 3 >= count) break;

    let centerU = 0;
    let centerV = 0;
    for (let i = 0; i < 4; i++) {
      centerU += uvAttr.getX(base + i);
      centerV += uvAttr.getY(base + i);
    }
    centerU /= 4;
    centerV /= 4;

    // Сдвиг по осям независимо: иначе на короткой стороне грани (например 4×12)
    // inset выходит пропорционально меньше заданного и не закрывает утечку
    for (let i = 0; i < 4; i++) {
      const idx = base + i;
      const u = uvAttr.getX(idx);
      const v = uvAttr.getY(idx);

      uvAttr.setXY(idx, moveTowards(u, centerU, inset), moveTowards(v, centerV, inset));
    }
  }

  uvAttr.needsUpdate = true;
}

/** UV-inset обоих слоёв; вызов идемпотентен — stock UV восстанавливаются перед сдвигом */
export function applySkinUVInsets(
  skin: SkinObject,
  options: SkinUVInsetOptions = {},
): void {
  const insetTexels = options.insetTexels ?? SKIN_UV_INSET_TEXELS;
  const outerInsetTexels = options.outerInsetTexels ?? SKIN_OUTER_UV_INSET_TEXELS;
  const textureSize = options.textureSize ?? SKIN_TEXTURE_SIZE;

  // Сброс stock геометрии/UV — иначе inset/inflate накапливается при каждом setSkin
  restoreStockLegMeshes(skin, textureSize);
  restoreStockSkinUVs(skin, textureSize);

  skin.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    if (!(obj.geometry instanceof BoxGeometry)) return;
    // skin3d BodyPart: innerLayer.name === "inner", outerLayer.name === "outer"
    if (obj.name === "inner") {
      insetBoxGeometryUVs(obj.geometry, insetTexels, textureSize);
    } else if (obj.name === "outer" && outerInsetTexels > 0) {
      insetBoxGeometryUVs(obj.geometry, outerInsetTexels, textureSize);
    }
  });
}
