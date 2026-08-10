// 3D Skin Layers: extrude outer-пикселей в воксели (порт SolidPixelWrapper / tr7zw)
import type { SkinObject } from "skin3d";
import {
  BoxGeometry,
  BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  type BufferGeometry,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const TEX = 64;
/** Как isPresent в моде: любой ненулевой alpha после sanitize */
const ALPHA_PRESENT = 1;

/**
 * Имена граней как в SolidPixelWrapper (Minecraft Direction),
 * не путать с «стороной текстуры»: Top→DOWN, Front→NORTH и т.д.
 */
type McDir = "down" | "up" | "north" | "south" | "west" | "east";

interface PartSpec {
  u: number;
  v: number;
  w: number;
  h: number;
  d: number;
  getOuter: (skin: SkinObject) => Mesh;
}

/** Outer UV 64×64 — как skin3d / SkinUtil мода */
function partSpecs(slim: boolean): PartSpec[] {
  const armW = slim ? 3 : 4;
  return [
    { u: 32, v: 0, w: 8, h: 8, d: 8, getOuter: (s) => s.head.outerLayer as Mesh },
    { u: 16, v: 32, w: 8, h: 12, d: 4, getOuter: (s) => s.body.outerLayer as Mesh },
    { u: 40, v: 32, w: armW, h: 12, d: 4, getOuter: (s) => s.rightArm.outerLayer as Mesh },
    { u: 48, v: 48, w: armW, h: 12, d: 4, getOuter: (s) => s.leftArm.outerLayer as Mesh },
    { u: 0, v: 32, w: 4, h: 12, d: 4, getOuter: (s) => s.rightLeg.outerLayer as Mesh },
    { u: 0, v: 48, w: 4, h: 12, d: 4, getOuter: (s) => s.leftLeg.outerLayer as Mesh },
  ];
}

/**
 * Менеджер 3D outer-слоя: прячет плоский outer и ставит merged-воксели.
 */
export class OuterVoxelLayers {
  private readonly _groups: Group[] = [];
  private readonly _geometries: BufferGeometry[] = [];
  /** Плоские outer, которые заменены вокселями — нельзя снова включать setOuterLayerVisible */
  private readonly _replacedOuters: Mesh[] = [];
  /** Общий материал с inner — не dispose (владеет skin3d) */
  private _material: MeshStandardMaterial | null = null;

  get hasLayers(): boolean {
    return this._groups.length > 0;
  }

  /**
   * Пересобрать 3D-слой из canvas скина.
   * Материал — тот же, что у основного слоя (блик/envMap/яркость).
   */
  rebuild(
    skin: SkinObject,
    canvas: HTMLCanvasElement,
    slim: boolean,
    _skinMap?: Texture | null,
    _envMap?: Texture | null,
  ): void {
    this.clear(skin);

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const { width, height } = canvas;
    if (width < TEX || height < TEX) return;

    const img = ctx.getImageData(0, 0, width, height);
    const scale = width / TEX;

    // Единый PBR с inner (голова/торс) — отражения и тон как у основы
    this._material = (skin.head.innerLayer as Mesh).material as MeshStandardMaterial;

    for (const spec of partSpecs(slim)) {
      if (!partHasSolidOverlay(img.data, width, height, scale, spec)) continue;
      const geos = buildPartVoxels(img.data, width, height, scale, spec);
      if (geos.length === 0) continue;

      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;

      this._geometries.push(merged);
      const mesh = new Mesh(merged, this._material);
      mesh.name = "outer3d";
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 3;

      const outer = spec.getOuter(skin);
      const parent = outer.parent;
      if (!parent) continue;

      const group = new Group();
      group.name = "outer3dGroup";
      group.position.copy(outer.position);
      applyShellScale(group, outer, spec.w, spec.h, spec.d);
      group.add(mesh);
      parent.add(group);
      this._groups.push(group);

      outer.visible = false;
      this._replacedOuters.push(outer);
    }
  }

  /**
   * Согласовать видимость flat outer / outer3d.
   * Важно: setOuterLayerVisible(true) из skin3d снова показывает заменённые flat —
   * отладка должна звать этот метод вместо него.
   */
  syncVisibility(showOuterLayer: boolean, preferVoxels: boolean): void {
    const useVoxels = preferVoxels && this._groups.length > 0;
    for (const g of this._groups) g.visible = showOuterLayer && useVoxels;
    for (const outer of this._replacedOuters) {
      outer.visible = showOuterLayer && !useVoxels;
    }
  }

  /** Продуктовый режим: воксели вкл., заменённый flat скрыт */
  restoreProductVisibility(): void {
    this.syncVisibility(true, true);
  }

  clear(skin?: SkinObject): void {
    for (const g of this._groups) {
      g.removeFromParent();
    }
    this._groups.length = 0;
    this._replacedOuters.length = 0;

    for (const g of this._geometries) g.dispose();
    this._geometries.length = 0;

    // Материал общий с skin3d — не dispose
    this._material = null;

    if (!skin) return;
    for (const spec of partSpecs(false)) {
      try {
        spec.getOuter(skin).visible = true;
      } catch {
        /* ignore */
      }
    }
    try {
      (skin.leftArm.outerLayer as Mesh).visible = true;
      (skin.rightArm.outerLayer as Mesh).visible = true;
    } catch {
      /* ignore */
    }
  }

  dispose(skin?: SkinObject): void {
    this.clear(skin);
  }
}

/** Масштаб оболочки как у stock outer */
function applyShellScale(group: Group, outer: Mesh, w: number, h: number, d: number): void {
  const geom = outer.geometry;
  if (!(geom instanceof BoxGeometry)) {
    group.scale.set(1, 1, 1);
    return;
  }
  const { width, height, depth } = geom.parameters;
  if (width === 1 && height === 1 && depth === 1) {
    group.scale.set(outer.scale.x / w, outer.scale.y / h, outer.scale.z / d);
  } else {
    group.scale.set(width / w, height / h, depth / d);
  }
}

const VOXEL_SOLID_RATIO = 0.08;
const VOXEL_MIN_SOLID_TEXELS = 2;
const FACE_ORDER: McDir[] = ["down", "up", "north", "south", "west", "east"];

/**
 * Тонкие детали второго слоя (кромка куртки, лямка, одиночные пиксели) не должны
 * превращаться в объём: у скинов с полупустым overlay из них вырастают
 * блочные полки и кубики в воздухе. Признак «настоящей» плотной области —
 * тексели, у которых заняты все четыре соседа: у линии толщиной 1–2 их нет.
 */
function partHasSolidOverlay(
  data: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  scale: number,
  spec: PartSpec,
): boolean {
  const { u, v, w, h, d } = spec;
  const dims = { w, h, d };
  let opaque = 0;
  let solid = 0;

  for (const face of FACE_ORDER) {
    const [fuMax, fvMax] = faceSize(dims, face);
    const mask = new Uint8Array(fuMax * fvMax);
    for (let fu = 0; fu < fuMax; fu++) {
      for (let fv = 0; fv < fvMax; fv++) {
        const [tu, tv] = onTextureUV(u, v, dims, face, fu, fv);
        if (!isPresent(data, imgW, imgH, scale, tu, tv)) continue;
        mask[fv * fuMax + fu] = 1;
        opaque++;
      }
    }
    const set = (fu: number, fv: number): boolean =>
      fu >= 0 && fv >= 0 && fu < fuMax && fv < fvMax && mask[fv * fuMax + fu] === 1;
    for (let fu = 0; fu < fuMax; fu++) {
      for (let fv = 0; fv < fvMax; fv++) {
        if (!set(fu, fv)) continue;
        if (set(fu - 1, fv) && set(fu + 1, fv) && set(fu, fv - 1) && set(fu, fv + 1)) solid++;
      }
    }
  }

  return solid >= VOXEL_MIN_SOLID_TEXELS && solid >= opaque * VOXEL_SOLID_RATIO;
}

const BOX_FACE_NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
  [0, 0, -1],
  [0, 0, 1],
];

/** Один воксель на каждый непрозрачный тексель грани (как addPixel в моде) */
function buildPartVoxels(
  data: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  scale: number,
  spec: PartSpec,
): BufferGeometry[] {
  const { u, v, w, h, d } = spec;
  const geos: BufferGeometry[] = [];
  const dims = { w, h, d };

  const cellIndex = (mx: number, my: number, mz: number): number => mx + w * (my + h * mz);
  const filled = new Uint8Array(w * h * d);
  const texelU = new Int16Array(w * h * d);
  const texelV = new Int16Array(w * h * d);

  for (const face of FACE_ORDER) {
    const [fuMax, fvMax] = faceSize(dims, face);
    for (let fu = 0; fu < fuMax; fu++) {
      for (let fv = 0; fv < fvMax; fv++) {
        const [tu, tv] = onTextureUV(u, v, dims, face, fu, fv);
        if (!isPresent(data, imgW, imgH, scale, tu, tv)) continue;

        const [mx, my, mz] = uvToModXYZ(dims, face, fu, fv);
        const cell = cellIndex(mx, my, mz);
        if (filled[cell]) continue;
        filled[cell] = 1;
        texelU[cell] = tu;
        texelV[cell] = tv;
      }
    }
  }

  const occupied = (mx: number, my: number, mz: number): boolean => {
    if (mx < 0 || my < 0 || mz < 0 || mx >= w || my >= h || mz >= d) return false;
    return filled[cellIndex(mx, my, mz)] === 1;
  };

  for (let mz = 0; mz < d; mz++) {
    for (let my = 0; my < h; my++) {
      for (let mx = 0; mx < w; mx++) {
        const cell = cellIndex(mx, my, mz);
        if (!filled[cell]) continue;

        const visible = BOX_FACE_NEIGHBOURS.map(
          ([dx, dy, dz]) => !occupied(mx + dx, my + dy, mz + dz),
        );
        if (!visible.some(Boolean)) continue;

        const geo = new BoxGeometry(1, 1, 1);
        const [x, y, z] = modToThreeCenter(mx, my, mz, w, h, d);
        geo.translate(x, y, z);
        paintBoxUvToTexel(geo, texelU[cell], texelV[cell]);
        keepBoxFaces(geo, visible);
        geos.push(geo);
      }
    }
  }

  return geos;
}

function keepBoxFaces(geo: BoxGeometry, visible: boolean[]): void {
  const index = geo.getIndex();
  if (!index) return;

  const kept: number[] = [];
  for (let face = 0; face < 6; face++) {
    if (!visible[face]) continue;
    for (let i = face * 6; i < face * 6 + 6; i++) kept.push(index.getX(i));
  }

  geo.setIndex(kept);
  geo.clearGroups();
}

function faceSize(dims: { w: number; h: number; d: number }, face: McDir): [number, number] {
  if (face === "down" || face === "up") return [dims.w, dims.d];
  if (face === "north" || face === "south") return [dims.w, dims.h];
  return [dims.d, dims.h]; // west / east
}

/** getOnTextureUV — точный порт SolidPixelWrapper */
function onTextureUV(
  texU: number,
  texV: number,
  dims: { w: number; h: number; d: number },
  face: McDir,
  fu: number,
  fv: number,
): [number, number] {
  const { w, d } = dims;
  switch (face) {
    case "down": // Top на атласе
      return [texU + d + fu, texV + fv];
    case "up": // Bottom на атласе
      return [texU + w + d + fu, texV + fv];
    case "north": // Front
      return [texU + d + fu, texV + d + fv];
    case "south": // Back
      return [texU + d + w + d + fu, texV + d + fv];
    case "west": // Left
      return [texU + fu, texV + d + fv];
    case "east": // Right
      return [texU + d + w + fu, texV + d + fv];
  }
}

/** UVtoXYZ — координаты мода (Y вниз по текстуре, NORTH при z=0) */
function uvToModXYZ(
  dims: { w: number; h: number; d: number },
  face: McDir,
  fu: number,
  fv: number,
): [number, number, number] {
  const { w, h, d } = dims;
  switch (face) {
    case "down":
      return [fu, 0, d - 1 - fv];
    case "up":
      return [fu, h - 1, d - 1 - fv];
    case "north":
      return [fu, fv, 0];
    case "south":
      return [w - 1 - fu, fv, d - 1];
    case "west":
      return [0, fv, d - 1 - fu];
    case "east":
      return [w - 1, fv, fu];
  }
}

/**
 * Mod → Three.js (центрированный бокс skin3d):
 * Y вверх, +Z = front (как setSkinUVs → pz).
 */
function modToThreeCenter(
  mx: number,
  my: number,
  mz: number,
  w: number,
  h: number,
  d: number,
): [number, number, number] {
  return [
    mx - w / 2 + 0.5,
    h - 1 - my - h / 2 + 0.5,
    d - 1 - mz - d / 2 + 0.5,
  ];
}

function isPresent(
  data: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  scale: number,
  tu: number,
  tv: number,
): boolean {
  const x = Math.min(imgW - 1, Math.floor(tu * scale));
  const y = Math.min(imgH - 1, Math.floor(tv * scale));
  if (x < 0 || y < 0 || tu < 0 || tv < 0) return false;
  return data[(y * imgW + x) * 4 + 3]! >= ALPHA_PRESENT;
}

const TEXEL_INSET = 0.25;

/** Все грани куба → один тексель атласа (NearestFilter) */
function paintBoxUvToTexel(geo: BufferGeometry, tu: number, tv: number): void {
  const uv = geo.attributes.uv as BufferAttribute;
  if (!uv) return;
  const u0 = (tu + TEXEL_INSET) / TEX;
  const u1 = (tu + 1 - TEXEL_INSET) / TEX;
  // V в three: 0 снизу; атлас скина — v сверху
  const v0 = 1 - (tv + 1 - TEXEL_INSET) / TEX;
  const v1 = 1 - (tv + TEXEL_INSET) / TEX;
  for (let i = 0; i < uv.count; i += 4) {
    uv.setXY(i, u0, v1);
    uv.setXY(i + 1, u1, v1);
    uv.setXY(i + 2, u0, v0);
    uv.setXY(i + 3, u1, v0);
  }
  uv.needsUpdate = true;
}
