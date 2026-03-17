import * as THREE from "three";
import { terrainSampleIndexX, textureUFromGridX } from "./map-coords";

export interface TerrainData {
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  mapSize: number;
  elevationMin: number;
  elevationMax: number;
  elevations: Float32Array;
}

/**
 * Create a terrain mesh from elevation data.
 * For large terrains (2048x2048), we downsample to keep vertex count manageable.
 * Uses chunked geometry to stay within WebGL index buffer limits.
 */
export function createTerrain(data: TerrainData): THREE.Group {
  const group = new THREE.Group();
  const { gridWidth, gridHeight, cellSize, elevations, elevationMin, elevationMax } = data;

  // Downsample factor: keep total vertices under ~1M for good performance
  const maxVertices = 1024;
  const step = Math.max(1, Math.ceil(Math.max(gridWidth, gridHeight) / maxVertices));
  const sampledW = Math.ceil(gridWidth / step);
  const sampledH = Math.ceil(gridHeight / step);
  const effectiveCellSize = cellSize * step;

  console.log(
    `Terrain: ${gridWidth}x${gridHeight} -> ${sampledW}x${sampledH} (step=${step}, cell=${effectiveCellSize}m)`
  );

  // Chunk size in sampled vertices
  const chunkSize = 128;
  const chunksX = Math.ceil(sampledW / chunkSize);
  const chunksZ = Math.ceil(sampledH / chunkSize);

  const elevRange = elevationMax - elevationMin;

  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      const startX = cx * chunkSize;
      const startZ = cz * chunkSize;
      const endX = Math.min(startX + chunkSize + 1, sampledW);
      const endZ = Math.min(startZ + chunkSize + 1, sampledH);
      const w = endX - startX;
      const h = endZ - startZ;

      if (w < 2 || h < 2) continue;

      const vertices = new Float32Array(w * h * 3);
      const colors = new Float32Array(w * h * 3);
      const uvs = new Float32Array(w * h * 2);
      const indices: number[] = [];

      for (let z = 0; z < h; z++) {
        for (let x = 0; x < w; x++) {
          const gx = (startX + x) * step;
          const gz = (startZ + z) * step;
          const clampX = Math.min(gx, gridWidth - 1);
          const clampZ = Math.min(gz, gridHeight - 1);
          const sampleX = terrainSampleIndexX(clampX, gridWidth);
          const idx = clampZ * gridWidth + sampleX;
          const elevation = elevations[idx] || 0;

          const vi = (z * w + x) * 3;
          vertices[vi] = gx * cellSize;
          vertices[vi + 1] = elevation;
          vertices[vi + 2] = gz * cellSize;

          // UV coordinates (0..1 across entire map)
          const ui = (z * w + x) * 2;
          uvs[ui] = textureUFromGridX(clampX, gridWidth);
          uvs[ui + 1] = clampZ / (gridHeight - 1);

          // Hypsometric color scheme
          const t = elevRange > 0 ? (elevation - elevationMin) / elevRange : 0;
          const color = hypsometricColor(elevation, t);
          colors[vi] = color[0];
          colors[vi + 1] = color[1];
          colors[vi + 2] = color[2];
        }
      }

      for (let z = 0; z < h - 1; z++) {
        for (let x = 0; x < w - 1; x++) {
          const a = z * w + x;
          const b = z * w + (x + 1);
          const c = (z + 1) * w + x;
          const d = (z + 1) * w + (x + 1);
          indices.push(a, c, b);
          indices.push(b, c, d);
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        side: THREE.FrontSide,
        flatShading: false,
      });
      (material as any).__terrainMaterial = true;

      group.add(new THREE.Mesh(geometry, material));
    }
  }

  return group;
}

function hypsometricColor(elevation: number, t: number): [number, number, number] {
  if (elevation < 0) return [0.1, 0.2, 0.4]; // water/below sea level
  if (elevation < 5) return [0.6, 0.55, 0.4]; // beach
  if (t < 0.15) return lerpColor([0.35, 0.5, 0.2], [0.55, 0.6, 0.3], t / 0.15);
  if (t < 0.4) return lerpColor([0.55, 0.6, 0.3], [0.6, 0.5, 0.3], (t - 0.15) / 0.25);
  if (t < 0.7) return lerpColor([0.6, 0.5, 0.3], [0.5, 0.4, 0.3], (t - 0.4) / 0.3);
  if (t < 0.9) return lerpColor([0.5, 0.4, 0.3], [0.7, 0.7, 0.7], (t - 0.7) / 0.2);
  return lerpColor([0.7, 0.7, 0.7], [1, 1, 1], (t - 0.9) / 0.1);
}

function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Apply a satellite texture to an existing terrain group.
 * Replaces the vertex-colored material with a textured one.
 */
export function applySatelliteTexture(terrain: THREE.Group, texture: THREE.Texture) {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;

  terrain.traverse((child) => {
    if (child instanceof THREE.Mesh && (child.material as any).__terrainMaterial) {
      const oldMat = child.material as THREE.MeshPhongMaterial;
      child.material = new THREE.MeshPhongMaterial({
        map: texture,
        side: THREE.FrontSide,
        flatShading: false,
      });
      oldMat.dispose();
    }
  });
}

export function createWater(mapSize: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(mapSize, mapSize);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(mapSize / 2, 0, mapSize / 2);

  const material = new THREE.MeshPhongMaterial({
    color: 0x1a5276,
    transparent: true,
    opacity: 0.6,
  });

  return new THREE.Mesh(geometry, material);
}
