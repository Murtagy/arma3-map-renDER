import * as THREE from "three";
import { worldToMapX } from "./map-coords";

/**
 * FPS-style fly camera controller.
 * WASD to move, QE for up/down, mouse to look, shift for speed boost.
 */
export interface TerrainInfo {
  elevations: Float32Array;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  mapSize: number;
}

const MIN_HEIGHT_ABOVE_GROUND = 2; // meters
const MAX_HEIGHT = 2000; // meters above sea level

export class FlyCamera {
  camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  private moveSpeed = 200; // meters per second
  private lookSpeed = 0.002;
  private speedMultiplier = 1;

  private keys = new Set<string>();
  private isLocked = false;

  private euler = new THREE.Euler(0, 0, 0, "YXZ");
  private direction = new THREE.Vector3();

  terrain: TerrainInfo | null = null;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;

    // Pointer lock for mouse look (skip when plan mode is active)
    domElement.addEventListener("click", () => {
      const pm = (window as any).__planMode;
      if (!this.isLocked && !(pm && pm.active)) {
        domElement.requestPointerLock();
      }
    });

    document.addEventListener("pointerlockchange", () => {
      this.isLocked = document.pointerLockElement === domElement;
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.isLocked) return;
      this.euler.setFromQuaternion(this.camera.quaternion);
      this.euler.y -= e.movementX * this.lookSpeed;
      this.euler.x -= e.movementY * this.lookSpeed;
      this.euler.x = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, this.euler.x)
      );
      this.camera.quaternion.setFromEuler(this.euler);
    });

    document.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.add(e.code);
    });

    document.addEventListener("keyup", (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      this.keys.delete(e.code);
    });

    // Scroll to adjust speed
    domElement.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.moveSpeed *= e.deltaY > 0 ? 0.85 : 1.18;
      this.moveSpeed = Math.max(10, Math.min(5000, this.moveSpeed));
    }, { passive: false });
  }

  update(deltaTime: number) {
    const speed =
      this.moveSpeed *
      deltaTime *
      (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 3 : 1);

    // Forward/back
    this.camera.getWorldDirection(this.direction);
    if (this.keys.has("KeyW")) this.camera.position.addScaledVector(this.direction, speed);
    if (this.keys.has("KeyS")) this.camera.position.addScaledVector(this.direction, -speed);

    // Left/right (strafe)
    const right = new THREE.Vector3();
    right.crossVectors(this.direction, this.camera.up).normalize();
    if (this.keys.has("KeyD")) this.camera.position.addScaledVector(right, speed);
    if (this.keys.has("KeyA")) this.camera.position.addScaledVector(right, -speed);

    // Up/down (Q/E only; Space is reserved for replay play/pause)
    if (this.keys.has("KeyQ"))
      this.camera.position.y += speed;
    if (this.keys.has("KeyE") || this.keys.has("KeyC"))
      this.camera.position.y -= speed;

    // Clamp height
    const groundY = this.getGroundHeight(this.camera.position.x, this.camera.position.z);
    this.camera.position.y = Math.max(groundY + MIN_HEIGHT_ABOVE_GROUND, Math.min(MAX_HEIGHT, this.camera.position.y));
  }

  private getGroundHeight(x: number, z: number): number {
    if (!this.terrain) return 0;
    const { elevations, gridWidth, gridHeight, cellSize, mapSize } = this.terrain;
    const mapX = worldToMapX(x, mapSize);
    const gx = mapX / cellSize;
    const gz = z / cellSize;
    const ix = Math.max(0, Math.min(gridWidth - 2, Math.floor(gx)));
    const iz = Math.max(0, Math.min(gridHeight - 2, Math.floor(gz)));
    const fx = gx - ix;
    const fz = gz - iz;
    // Bilinear interpolation
    const e00 = elevations[iz * gridWidth + ix];
    const e10 = elevations[iz * gridWidth + ix + 1];
    const e01 = elevations[(iz + 1) * gridWidth + ix];
    const e11 = elevations[(iz + 1) * gridWidth + ix + 1];
    return e00 * (1 - fx) * (1 - fz) + e10 * fx * (1 - fz) + e01 * (1 - fx) * fz + e11 * fx * fz;
  }

  /** Get current position info for HUD */
  getInfo(): string {
    const p = this.camera.position;
    return `Pos: ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)} | Speed: ${this.moveSpeed.toFixed(0)} m/s`;
  }
}
