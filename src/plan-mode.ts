import * as THREE from "three";
import type { TerrainInfo } from "./fly-camera";

export type MarkColor = "R" | "G" | "B";
export type LineType = "ground" | "straight";

export interface Mark {
  id: number;
  text: string;
  color: MarkColor;
  worldPos: THREE.Vector3;
  group: THREE.Group;
}

export interface DrawnLine {
  id: number;
  color: MarkColor;
  lineType: LineType;
  start: THREE.Vector3;
  end: THREE.Vector3;
  object: THREE.Line;
}

const MARK_HEIGHT = 200;
const LINE_HEIGHT = 15; // meters above ground
const LINE_SAMPLE_SPACING = 20; // meters between terrain samples along line

const COLOR_MAP: Record<MarkColor, { pole: number; marker: number; border: string; minimap: string; line: number }> = {
  R: { pole: 0xff4444, marker: 0xff2222, border: "rgba(255, 80, 80, 0.9)", minimap: "#ff4444", line: 0xff4444 },
  G: { pole: 0x44ff44, marker: 0x22ff22, border: "rgba(80, 255, 80, 0.9)", minimap: "#44ff44", line: 0x44ff44 },
  B: { pole: 0x4488ff, marker: 0x2266ff, border: "rgba(80, 140, 255, 0.9)", minimap: "#4488ff", line: 0x4488ff },
};

let nextId = 1;

function createTextSprite(text: string, color: MarkColor): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;

  const fontSize = 48;
  ctx.font = `bold ${fontSize}px monospace`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;

  const padding = 20;
  canvas.width = textWidth + padding * 2;
  canvas.height = fontSize + padding * 2;

  // Background
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  const r = 8;
  const w = canvas.width;
  const h = canvas.height;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Border
  ctx.strokeStyle = COLOR_MAP[color].border;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Text
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(material);

  const aspect = canvas.width / canvas.height;
  const scale = 60;
  sprite.scale.set(scale * aspect, scale, 1);

  return sprite;
}

function createPendingGroup(worldPos: THREE.Vector3, color: MarkColor): THREE.Group {
  const group = new THREE.Group();
  const colors = COLOR_MAP[color];

  const poleGeom = new THREE.CylinderGeometry(2, 2, MARK_HEIGHT, 6);
  const poleMat = new THREE.MeshBasicMaterial({ color: colors.pole, transparent: true, opacity: 0.4 });
  const pole = new THREE.Mesh(poleGeom, poleMat);
  pole.position.set(worldPos.x, worldPos.y + MARK_HEIGHT / 2, worldPos.z);
  group.add(pole);

  const markerGeom = new THREE.OctahedronGeometry(15, 0);
  const markerMat = new THREE.MeshBasicMaterial({ color: colors.marker, transparent: true, opacity: 0.6 });
  const marker = new THREE.Mesh(markerGeom, markerMat);
  marker.position.set(worldPos.x, worldPos.y + MARK_HEIGHT, worldPos.z);
  group.add(marker);

  return group;
}

function createMarkGroup(worldPos: THREE.Vector3, text: string, color: MarkColor): THREE.Group {
  const group = new THREE.Group();
  const colors = COLOR_MAP[color];

  const poleGeom = new THREE.CylinderGeometry(2, 2, MARK_HEIGHT, 6);
  const poleMat = new THREE.MeshBasicMaterial({ color: colors.pole, transparent: true, opacity: 0.6 });
  const pole = new THREE.Mesh(poleGeom, poleMat);
  pole.position.set(worldPos.x, worldPos.y + MARK_HEIGHT / 2, worldPos.z);
  group.add(pole);

  const markerGeom = new THREE.OctahedronGeometry(15, 0);
  const markerMat = new THREE.MeshBasicMaterial({ color: colors.marker });
  const marker = new THREE.Mesh(markerGeom, markerMat);
  marker.position.set(worldPos.x, worldPos.y + MARK_HEIGHT, worldPos.z);
  group.add(marker);

  const sprite = createTextSprite(text, color);
  sprite.position.set(worldPos.x, worldPos.y + MARK_HEIGHT + 80, worldPos.z);
  group.add(sprite);

  return group;
}

function disposeGroup(group: THREE.Group) {
  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
    if (child instanceof THREE.Sprite) {
      (child.material as THREE.SpriteMaterial).map?.dispose();
      child.material.dispose();
    }
  });
}

function disposeLine(line: THREE.Line) {
  line.geometry.dispose();
  (line.material as THREE.Material).dispose();
}

/** Sample ground height via bilinear interpolation */
function getGroundHeight(terrain: TerrainInfo, x: number, z: number): number {
  const { elevations, gridWidth, gridHeight, cellSize } = terrain;
  const gx = x / cellSize;
  const gz = z / cellSize;
  const ix = Math.max(0, Math.min(gridWidth - 2, Math.floor(gx)));
  const iz = Math.max(0, Math.min(gridHeight - 2, Math.floor(gz)));
  const fx = gx - ix;
  const fz = gz - iz;
  const e00 = elevations[iz * gridWidth + ix];
  const e10 = elevations[iz * gridWidth + ix + 1];
  const e01 = elevations[(iz + 1) * gridWidth + ix];
  const e11 = elevations[(iz + 1) * gridWidth + ix + 1];
  return e00 * (1 - fx) * (1 - fz) + e10 * fx * (1 - fz) + e01 * (1 - fx) * fz + e11 * fx * fz;
}

/** Build a ground-following line: stays LINE_HEIGHT above terrain at every sample */
function createGroundLineGeometry(terrain: TerrainInfo | null, start: THREE.Vector3, end: THREE.Vector3): THREE.BufferGeometry {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const numSamples = Math.max(2, Math.ceil(dist / LINE_SAMPLE_SPACING) + 1);

  const points: THREE.Vector3[] = [];
  for (let i = 0; i < numSamples; i++) {
    const t = i / (numSamples - 1);
    const x = start.x + dx * t;
    const z = start.z + dz * t;
    const groundY = terrain ? getGroundHeight(terrain, x, z) : 0;
    points.push(new THREE.Vector3(x, groundY + LINE_HEIGHT, z));
  }

  return new THREE.BufferGeometry().setFromPoints(points);
}

/** Build a straight line: direct ray from start to end, each elevated LINE_HEIGHT above their ground */
function createStraightLineGeometry(terrain: TerrainInfo | null, start: THREE.Vector3, end: THREE.Vector3): THREE.BufferGeometry {
  const startY = (terrain ? getGroundHeight(terrain, start.x, start.z) : 0) + LINE_HEIGHT;
  const endY = (terrain ? getGroundHeight(terrain, end.x, end.z) : 0) + LINE_HEIGHT;
  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(start.x, startY, start.z),
    new THREE.Vector3(end.x, endY, end.z),
  ]);
}

function createLineGeometry(terrain: TerrainInfo | null, start: THREE.Vector3, end: THREE.Vector3, lineType: LineType): THREE.BufferGeometry {
  return lineType === "straight"
    ? createStraightLineGeometry(terrain, start, end)
    : createGroundLineGeometry(terrain, start, end);
}

function createLine3D(terrain: TerrainInfo | null, start: THREE.Vector3, end: THREE.Vector3, color: MarkColor, lineType: LineType): THREE.Line {
  const geometry = createLineGeometry(terrain, start, end, lineType);
  const material = new THREE.LineBasicMaterial({
    color: COLOR_MAP[color].line,
    linewidth: 2,
    depthTest: false,
  });
  return new THREE.Line(geometry, material);
}

export class PlanMode {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private terrainGroup: THREE.Group | null = null;
  private terrainInfo: TerrainInfo | null = null;
  private raycaster = new THREE.Raycaster();

  marks: Mark[] = [];
  lines: DrawnLine[] = [];
  active = false;
  private movingMarkId: number | null = null;

  // Pending mark
  private pendingPos: THREE.Vector3 | null = null;
  private pendingGroup: THREE.Group | null = null;

  // Line drawing state
  private drawingLine = false;
  private lineStart: THREE.Vector3 | null = null;
  private previewLine: THREE.Line | null = null;

  // Callbacks
  onMarksChanged: (() => void) | null = null;
  onPendingChanged: ((pending: boolean) => void) | null = null;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    this.renderer.domElement.addEventListener("dblclick", (e) => this.onDblClick(e));
    this.renderer.domElement.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.renderer.domElement.addEventListener("mousemove", (e) => this.onMouseMove(e));
    this.renderer.domElement.addEventListener("mouseup", (e) => this.onMouseUp(e));
    this.renderer.domElement.addEventListener("click", (e) => this.onClick(e));
  }

  setTerrain(terrain: THREE.Group) {
    this.terrainGroup = terrain;
  }

  setTerrainInfo(info: TerrainInfo) {
    this.terrainInfo = info;
  }

  private raycastTerrain(e: MouseEvent): THREE.Vector3 | null {
    if (!this.terrainGroup) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(mouse, this.camera);

    const meshes: THREE.Mesh[] = [];
    this.terrainGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    const intersects = this.raycaster.intersectObjects(meshes, false);
    if (intersects.length === 0) return null;
    return intersects[0].point.clone();
  }

  private getSelectedColor(): MarkColor {
    const colorSelect = document.getElementById("mark-color") as HTMLSelectElement;
    return (colorSelect?.value || "G") as MarkColor;
  }

  private getSelectedLineType(): LineType {
    const lineTypeSelect = document.getElementById("line-type") as HTMLSelectElement;
    return (lineTypeSelect?.value || "ground") as LineType;
  }

  // --- Line drawing (single click + drag) ---

  private onMouseDown(e: MouseEvent) {
    if (!this.active || document.pointerLockElement) return;
    if (e.button !== 0) return;
    if (this.movingMarkId !== null || this.pendingPos !== null) return;

    const hitPoint = this.raycastTerrain(e);
    if (!hitPoint) return;

    this.drawingLine = true;
    this.lineStart = hitPoint;
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.drawingLine || !this.lineStart) return;

    const hitPoint = this.raycastTerrain(e);
    if (!hitPoint) return;

    // Remove old preview
    if (this.previewLine) {
      this.scene.remove(this.previewLine);
      disposeLine(this.previewLine);
    }

    this.previewLine = createLine3D(this.terrainInfo, this.lineStart, hitPoint, this.getSelectedColor(), this.getSelectedLineType());
    this.scene.add(this.previewLine);
  }

  private onMouseUp(e: MouseEvent) {
    if (!this.drawingLine || !this.lineStart) return;
    this.drawingLine = false;

    const hitPoint = this.raycastTerrain(e);

    // Remove preview
    if (this.previewLine) {
      this.scene.remove(this.previewLine);
      disposeLine(this.previewLine);
      this.previewLine = null;
    }

    if (!hitPoint) { this.lineStart = null; return; }

    // Only create line if dragged a meaningful distance (>10m)
    const dx = hitPoint.x - this.lineStart.x;
    const dz = hitPoint.z - this.lineStart.z;
    if (Math.sqrt(dx * dx + dz * dz) < 10) {
      this.lineStart = null;
      return;
    }

    const color = this.getSelectedColor();
    const lineType = this.getSelectedLineType();
    const line3d = createLine3D(this.terrainInfo, this.lineStart, hitPoint, color, lineType);
    this.scene.add(line3d);

    const drawnLine: DrawnLine = {
      id: nextId++,
      color,
      lineType,
      start: this.lineStart.clone(),
      end: hitPoint.clone(),
      object: line3d,
    };
    this.lines.push(drawnLine);
    this.lineStart = null;
    this.onMarksChanged?.();
  }

  /** Single click: used for moving marks (only if not dragging a line) */
  private onClick(e: MouseEvent) {
    if (!this.active || document.pointerLockElement) return;
    if (this.movingMarkId === null) return;

    const hitPoint = this.raycastTerrain(e);
    if (!hitPoint) return;

    this.moveMarkTo(this.movingMarkId, hitPoint);
    this.movingMarkId = null;
    this.onMarksChanged?.();
  }

  /** Double-click: pin a pending mark location */
  private onDblClick(e: MouseEvent) {
    if (!this.active || document.pointerLockElement) return;
    if (this.movingMarkId !== null) return;

    const hitPoint = this.raycastTerrain(e);
    if (!hitPoint) return;

    this.cancelPending();

    const color = this.getSelectedColor();
    this.pendingPos = hitPoint;
    this.pendingGroup = createPendingGroup(hitPoint, color);
    this.scene.add(this.pendingGroup);

    this.onPendingChanged?.(true);
  }

  confirmPending(text: string) {
    if (!this.pendingPos || !text.trim()) return;

    const color = this.getSelectedColor();

    if (this.pendingGroup) {
      this.scene.remove(this.pendingGroup);
      disposeGroup(this.pendingGroup);
      this.pendingGroup = null;
    }

    this.addMark(this.pendingPos, text.trim(), color);
    this.pendingPos = null;
    this.onPendingChanged?.(false);
    this.onMarksChanged?.();
  }

  cancelPending() {
    if (this.pendingGroup) {
      this.scene.remove(this.pendingGroup);
      disposeGroup(this.pendingGroup);
      this.pendingGroup = null;
    }
    this.pendingPos = null;
    this.onPendingChanged?.(false);
  }

  hasPending(): boolean {
    return this.pendingPos !== null;
  }

  addMark(worldPos: THREE.Vector3, text: string, color: MarkColor = "G"): Mark {
    const group = createMarkGroup(worldPos, text, color);
    this.scene.add(group);

    const mark: Mark = { id: nextId++, text, color, worldPos: worldPos.clone(), group };
    this.marks.push(mark);
    return mark;
  }

  removeMark(id: number) {
    const idx = this.marks.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const mark = this.marks[idx];
    this.scene.remove(mark.group);
    disposeGroup(mark.group);
    this.marks.splice(idx, 1);
    if (this.movingMarkId === id) this.movingMarkId = null;
    this.onMarksChanged?.();
  }

  removeLine(id: number) {
    const idx = this.lines.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const line = this.lines[idx];
    this.scene.remove(line.object);
    disposeLine(line.object);
    this.lines.splice(idx, 1);
    this.onMarksChanged?.();
  }

  startMove(id: number) {
    this.cancelPending();
    this.movingMarkId = id;
  }

  cancelMove() {
    this.movingMarkId = null;
  }

  isMoving(): boolean {
    return this.movingMarkId !== null;
  }

  getMovingId(): number | null {
    return this.movingMarkId;
  }

  private moveMarkTo(id: number, newPos: THREE.Vector3) {
    const mark = this.marks.find((m) => m.id === id);
    if (!mark) return;

    this.scene.remove(mark.group);
    disposeGroup(mark.group);

    mark.worldPos.copy(newPos);
    mark.group = createMarkGroup(newPos, mark.text, mark.color);
    this.scene.add(mark.group);
  }

  toggle() {
    this.active = !this.active;
    if (!this.active) {
      this.movingMarkId = null;
      this.cancelPending();
      // Cancel any in-progress line draw
      if (this.previewLine) {
        this.scene.remove(this.previewLine);
        disposeLine(this.previewLine);
        this.previewLine = null;
      }
      this.drawingLine = false;
      this.lineStart = null;
    }
  }
}
