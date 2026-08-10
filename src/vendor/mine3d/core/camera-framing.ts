// Кадрирование камеры: измерение экранных границ модели и подгонка камеры под кадр.
// Модуль чисто математический — рендер, материалы и геометрия не затрагиваются.
import { Box3, Mesh, Vector3 } from "three";
import type { BufferGeometry, Object3D, PerspectiveCamera } from "three";

/** Экранный bbox в нормализованных координатах устройства (NDC, −1…1) */
export interface NdcBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Результат замера кадрирования */
export interface FrameMeasure {
  /** Экранные границы модели в NDC */
  ndc: NdcBox;
  /** Доля ширины кадра, занятая моделью (0…1) */
  fillX: number;
  /** Доля высоты кадра, занятая моделью (0…1) */
  fillY: number;
  /** Смещение центра модели от центра кадра в долях полукадра (0 — точно по центру) */
  offsetX: number;
  offsetY: number;
  /** Мировой bounding box видимых мешей */
  world: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  /** Сколько вершин участвовало в замере */
  points: number;
}

export interface FrameFitOptions {
  /** Целевая доля высоты кадра под модель (по умолчанию 0.86) */
  fillY?: number;
  /** Ограничение доли ширины кадра — для узких канвасов (по умолчанию 0.9) */
  maxFillX?: number;
  /**
   * Смещение центра модели по вертикали в долях полукадра.
   * >0 — модель выше центра (полезно, если под вьювером есть подписи).
   */
  offsetY?: number;
  /** Центрировать модель по горизонтали панорамированием (по умолчанию true) */
  centerX?: boolean;
  /** Итераций подгонки: перспектива нелинейна, 4–6 достаточно (по умолчанию 6) */
  iterations?: number;
}

export interface FrameFitResult extends FrameMeasure {
  /** Итоговая дистанция камеры до точки look-at */
  distance: number;
  /** FOV камеры (не меняется — для отчётности) */
  fov: number;
  /** Итоговая точка look-at */
  target: { x: number; y: number; z: number };
  iterations: number;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

const POINT = new Vector3();
const RIGHT = new Vector3();
const UP = new Vector3();
const DIRECTION = new Vector3();
const GEOMETRY_BOX = new Box3();
const WORLD_BOX = new Box3();

/**
 * Мировые координаты вершин видимых мешей поддерева.
 *
 * Замер идёт по вершинам, а не по bounding box: проекция 8 углов AABB под
 * повёрнутой камерой сильно завышает экранный размер — «пустые» углы бокса
 * оказываются ближе к камере, чем реальная геометрия, и модель получается
 * мельче кадра на 15–20%. Вершины кубов дают точный силуэт.
 *
 * Скрытые узлы пропускаются: cape и elytra всегда есть в графе skin3d, но чаще
 * невидимы, а их геометрия заметно расширяет кадр.
 */
class PointCloud {
  /** Плоский буфер xyz, переиспользуется между вызовами — без аллокаций на кадр */
  private buffer = new Float64Array(3 * 1024);
  count = 0;

  private push(x: number, y: number, z: number): void {
    const need = (this.count + 1) * 3;
    if (need > this.buffer.length) {
      const grown = new Float64Array(Math.max(need, this.buffer.length * 2));
      grown.set(this.buffer);
      this.buffer = grown;
    }
    const i = this.count * 3;
    this.buffer[i] = x;
    this.buffer[i + 1] = y;
    this.buffer[i + 2] = z;
    this.count++;
  }

  collect(root: Object3D): void {
    this.count = 0;
    if (!root.visible) return;
    root.updateWorldMatrix(true, true);

    const visit = (obj: Object3D): void => {
      if (!obj.visible) return;
      const mesh = obj as Mesh;
      const geometry = mesh.isMesh ? (mesh.geometry as BufferGeometry | undefined) : undefined;
      const position = geometry?.getAttribute("position");
      if (position) {
        for (let i = 0; i < position.count; i++) {
          POINT.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
          this.push(POINT.x, POINT.y, POINT.z);
        }
      }
      for (const child of obj.children) visit(child);
    };

    visit(root);
  }

  /** Экранные границы облака точек в NDC */
  projectToNdc(camera: PerspectiveCamera): NdcBox {
    const ndc: NdcBox = {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    };
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      POINT.set(this.buffer[j], this.buffer[j + 1], this.buffer[j + 2]).project(camera);
      if (POINT.x < ndc.minX) ndc.minX = POINT.x;
      if (POINT.x > ndc.maxX) ndc.maxX = POINT.x;
      if (POINT.y < ndc.minY) ndc.minY = POINT.y;
      if (POINT.y > ndc.maxY) ndc.maxY = POINT.y;
    }
    return ndc;
  }

  /** Мировой bounding box облака точек */
  bounds(out: Box3): Box3 {
    out.makeEmpty();
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      POINT.set(this.buffer[j], this.buffer[j + 1], this.buffer[j + 2]);
      out.expandByPoint(POINT);
    }
    return out;
  }
}

const CLOUD = new PointCloud();

/**
 * Мировой bounding box только видимых мешей поддерева.
 *
 * Box3.setFromObject учитывает и скрытые объекты, поэтому для skin3d он
 * бесполезен: elytra и cape всегда присутствуют в графе, но чаще скрыты.
 */
export function computeVisibleBounds(root: Object3D, out = new Box3()): Box3 {
  out.makeEmpty();
  if (!root.visible) return out;
  root.updateWorldMatrix(true, true);

  const visit = (obj: Object3D): void => {
    if (!obj.visible) return;
    const mesh = obj as Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const geometry = mesh.geometry as BufferGeometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) {
        GEOMETRY_BOX.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
        out.union(GEOMETRY_BOX);
      }
    }
    for (const child of obj.children) visit(child);
  };

  visit(root);
  return out;
}

function toMeasure(camera: PerspectiveCamera): FrameMeasure {
  const ndc = CLOUD.projectToNdc(camera);
  const box = CLOUD.bounds(WORLD_BOX);
  return {
    ndc,
    fillX: (ndc.maxX - ndc.minX) / 2,
    fillY: (ndc.maxY - ndc.minY) / 2,
    offsetX: (ndc.minX + ndc.maxX) / 2,
    offsetY: (ndc.minY + ndc.maxY) / 2,
    world: {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
    },
    points: CLOUD.count,
  };
}

/** Замер кадрирования объекта без изменения камеры */
export function measureObjectFrame(root: Object3D, camera: PerspectiveCamera): FrameMeasure | null {
  CLOUD.collect(root);
  if (CLOUD.count === 0) return null;
  camera.updateMatrixWorld(true);
  return toMeasure(camera);
}

/**
 * Подгонка камеры под кадр: модель по центру и на заданную долю кадра.
 *
 * Направление обзора сохраняется — меняются только дистанция и точка look-at
 * (сдвиг в экранной плоскости). Итерации нужны из-за перспективы: экранный
 * размер модели зависит от дистанции нелинейно.
 */
export function fitObjectToFrame(
  root: Object3D,
  camera: PerspectiveCamera,
  target: Vector3,
  options: FrameFitOptions = {},
): FrameFitResult | null {
  CLOUD.collect(root);
  if (CLOUD.count === 0) return null;

  const fillY = clamp(options.fillY ?? 0.86, 0.05, 1);
  const maxFillX = clamp(options.maxFillX ?? 0.9, 0.05, 1);
  const offsetY = options.offsetY ?? 0;
  const centerX = options.centerX !== false;
  const iterations = Math.max(1, Math.round(options.iterations ?? 6));

  DIRECTION.subVectors(camera.position, target);
  let distance = DIRECTION.length();
  if (!(distance > 1e-4)) {
    DIRECTION.set(-0.58, 0.26, 0.78);
    distance = 100;
  }
  DIRECTION.normalize();

  const halfFovTan = Math.tan(((camera.fov / 180) * Math.PI) / 2);
  let measure: FrameMeasure;

  for (let i = 0; i < iterations; i++) {
    camera.position.copy(target).addScaledVector(DIRECTION, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);

    measure = toMeasure(camera);
    if (measure.fillY <= 0 || measure.fillX <= 0) break;

    // Экранный размер ≈ 1/distance, поэтому масштабируем дистанцию обратно
    const scale = Math.min(fillY / measure.fillY, maxFillX / measure.fillX);
    const nextDistance = distance / scale;

    // Рецентровка: сдвиг точки look-at в экранной плоскости на новой дистанции
    const halfHeight = halfFovTan * nextDistance;
    const halfWidth = halfHeight * camera.aspect;
    RIGHT.setFromMatrixColumn(camera.matrixWorld, 0);
    UP.setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(UP, (measure.offsetY - offsetY) * halfHeight);
    if (centerX) target.addScaledVector(RIGHT, measure.offsetX * halfWidth);

    distance = nextDistance;
  }

  camera.position.copy(target).addScaledVector(DIRECTION, distance);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);

  return {
    ...toMeasure(camera),
    distance,
    fov: camera.fov,
    target: { x: target.x, y: target.y, z: target.z },
    iterations,
  };
}
