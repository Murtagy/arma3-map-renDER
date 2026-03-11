import * as THREE from "three";

// Category indices from server classification
const CATEGORY_VEGETATION = 0;
const CATEGORY_BUILDING = 1;       // fallback medium building
const CATEGORY_ROCK = 2;
const CATEGORY_STRUCTURE = 3;
const CATEGORY_INFRASTRUCTURE = 4;
const CATEGORY_OTHER = 5;
const CATEGORY_PLATFORM = 6;
const CATEGORY_BUILDING_LARGE = 7;  // 2+ story houses, apartments
const CATEGORY_BUILDING_SMALL = 8;  // sheds, huts, small structures
const CATEGORY_BUILDING_INDUSTRIAL = 9; // factories, hangars, warehouses
const CATEGORY_BUILDING_TINY = 10;  // haybales, woodpiles, benches, props

interface CategoryConfig {
  color: number;
  geometry: THREE.BufferGeometry;
  yOffset: number; // offset so objects sit on ground
  baseHeight: number;
}

function getCategoryConfigs(): Map<number, CategoryConfig> {
  const configs = new Map<number, CategoryConfig>();

  // Vegetation: green cones (trees)
  const treeCone = new THREE.ConeGeometry(2, 10, 6);
  treeCone.translate(0, 5, 0);
  configs.set(CATEGORY_VEGETATION, {
    color: 0x2d5a1e,
    geometry: treeCone,
    yOffset: 0,
    baseHeight: 10,
  });

  // Buildings (medium/default): 1-story houses
  const buildingBox = new THREE.BoxGeometry(8, 4, 6);
  buildingBox.translate(0, 2, 0);
  configs.set(CATEGORY_BUILDING, {
    color: 0xb8a080,
    geometry: buildingBox,
    yOffset: 0,
    baseHeight: 4,
  });

  // Large buildings: 2+ story apartments, hotels, hospitals
  const largeBldg = new THREE.BoxGeometry(12, 10, 10);
  largeBldg.translate(0, 5, 0);
  configs.set(CATEGORY_BUILDING_LARGE, {
    color: 0xa09070,
    geometry: largeBldg,
    yOffset: 0,
    baseHeight: 10,
  });

  // Small buildings: sheds, huts, garages
  const smallBldg = new THREE.BoxGeometry(4, 3, 3);
  smallBldg.translate(0, 1.5, 0);
  configs.set(CATEGORY_BUILDING_SMALL, {
    color: 0xc0a888,
    geometry: smallBldg,
    yOffset: 0,
    baseHeight: 3,
  });

  // Industrial: wide low buildings
  const indBldg = new THREE.BoxGeometry(15, 6, 10);
  indBldg.translate(0, 3, 0);
  configs.set(CATEGORY_BUILDING_INDUSTRIAL, {
    color: 0x8a8a7a,
    geometry: indBldg,
    yOffset: 0,
    baseHeight: 6,
  });

  // Tiny props: haybales, woodpiles, benches, misc
  const tinyBox = new THREE.BoxGeometry(1.5, 1, 1.5);
  tinyBox.translate(0, 0.5, 0);
  configs.set(CATEGORY_BUILDING_TINY, {
    color: 0x9a8a6a,
    geometry: tinyBox,
    yOffset: 0,
    baseHeight: 1,
  });

  // Rocks: dark gray irregular spheres
  const rockSphere = new THREE.IcosahedronGeometry(2, 0);
  rockSphere.translate(0, 1, 0);
  configs.set(CATEGORY_ROCK, {
    color: 0x666666,
    geometry: rockSphere,
    yOffset: 0,
    baseHeight: 2,
  });

  // Structures (walls, fences): thin tall boxes — length along local X
  const structBox = new THREE.BoxGeometry(5, 2.5, 0.3);
  structBox.translate(0, 1.25, 0);
  configs.set(CATEGORY_STRUCTURE, {
    color: 0x999988,
    geometry: structBox,
    yOffset: 0,
    baseHeight: 2.5,
  });

  // Infrastructure: thin cylinders (poles)
  const poleCyl = new THREE.CylinderGeometry(0.2, 0.2, 8, 4);
  poleCyl.translate(0, 4, 0);
  configs.set(CATEGORY_INFRASTRUCTURE, {
    color: 0x555555,
    geometry: poleCyl,
    yOffset: 0,
    baseHeight: 8,
  });

  // Platforms (piers, docks, runways): flat wide boxes
  const platformBox = new THREE.BoxGeometry(10, 0.5, 10);
  platformBox.translate(0, 0.25, 0);
  configs.set(CATEGORY_PLATFORM, {
    color: 0x808080,
    geometry: platformBox,
    yOffset: 0,
    baseHeight: 0.5,
  });

  // Other: small gray cubes
  const otherBox = new THREE.BoxGeometry(2, 2, 2);
  otherBox.translate(0, 1, 0);
  configs.set(CATEGORY_OTHER, {
    color: 0x888888,
    geometry: otherBox,
    yOffset: 0,
    baseHeight: 2,
  });

  return configs;
}

export interface ObjectsData {
  nObjects: number;
  nModels: number;
  classifications: Uint8Array;
  positions: Float32Array;    // nObjects * 3
  scales: Float32Array;       // nObjects
  quaternions: Float32Array;  // nObjects * 4 (x, y, z, w)
  modelIndices: Uint16Array;  // nObjects
}

export function parseObjectsBinary(buffer: ArrayBuffer): ObjectsData {
  const view = new DataView(buffer);
  let offset = 0;

  const nObjects = view.getUint32(offset, true); offset += 4;
  const nModels = view.getUint32(offset, true); offset += 4;

  const classifications = new Uint8Array(buffer, offset, nModels);
  offset += nModels;

  const positions = new Float32Array(nObjects * 3);
  const scales = new Float32Array(nObjects);
  const quaternions = new Float32Array(nObjects * 4);
  const modelIndices = new Uint16Array(nObjects);

  for (let i = 0; i < nObjects; i++) {
    positions[i * 3] = view.getFloat32(offset, true); offset += 4;     // x
    positions[i * 3 + 1] = view.getFloat32(offset, true); offset += 4; // y
    positions[i * 3 + 2] = view.getFloat32(offset, true); offset += 4; // z
    scales[i] = view.getFloat32(offset, true); offset += 4;
    quaternions[i * 4] = view.getFloat32(offset, true); offset += 4;     // qx
    quaternions[i * 4 + 1] = view.getFloat32(offset, true); offset += 4; // qy
    quaternions[i * 4 + 2] = view.getFloat32(offset, true); offset += 4; // qz
    quaternions[i * 4 + 3] = view.getFloat32(offset, true); offset += 4; // qw
    modelIndices[i] = view.getUint16(offset, true); offset += 2;
  }

  return { nObjects, nModels, classifications, positions, scales, quaternions, modelIndices };
}

export function createObjects(data: ObjectsData): THREE.Group {
  const group = new THREE.Group();
  const configs = getCategoryConfigs();

  // Group objects by category, storing index into original data
  const categorized = new Map<number, number[]>();
  for (let cat = 0; cat <= 10; cat++) {
    categorized.set(cat, []);
  }

  for (let i = 0; i < data.nObjects; i++) {
    const modelIdx = data.modelIndices[i];
    const cat = modelIdx < data.nModels ? data.classifications[modelIdx] : CATEGORY_OTHER;
    categorized.get(cat)!.push(i);
  }

  const dummy = new THREE.Object3D();
  const quat = new THREE.Quaternion();

  for (const [cat, indices] of categorized) {
    if (indices.length === 0) continue;

    const config = configs.get(cat)!;
    const material = new THREE.MeshPhongMaterial({
      color: config.color,
      flatShading: true,
    });

    const mesh = new THREE.InstancedMesh(config.geometry, material, indices.length);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    for (let j = 0; j < indices.length; j++) {
      const i = indices[j];
      const x = data.positions[i * 3];
      const y = data.positions[i * 3 + 1];
      const z = data.positions[i * 3 + 2];
      const scale = Math.max(0.5, Math.min(data.scales[i], 5));

      quat.set(
        data.quaternions[i * 4],
        data.quaternions[i * 4 + 1],
        data.quaternions[i * 4 + 2],
        data.quaternions[i * 4 + 3],
      );

      dummy.position.set(x, y, z);
      dummy.quaternion.copy(quat);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(j, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);

    const catNames = ["vegetation", "building", "rock", "structure", "infrastructure", "other", "platform",
      "building-large", "building-small", "building-industrial", "building-tiny"];
    console.log(`Objects: ${indices.length} ${catNames[cat] || "unknown"}`);
  }

  return group;
}
