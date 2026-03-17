import { BinaryReader } from "./binary-reader";
import { decompressLzo } from "./lzo";
import { classifyModel } from "./model-classification";

export interface WrpMapInfo {
  version: number;
  layerSizeX: number;
  layerSizeY: number;
  mapSizeX: number;
  mapSizeY: number;
  cellSize: number;
  mapSizeMeters: number;
  elevationMin: number;
  elevationMax: number;
}

export interface WrpObjectsData {
  nObjects: number;
  nModels: number;
  classifications: Uint8Array;
  positions: Float32Array;
  scales: Float32Array;
  quaternions: Float32Array;
  modelIndices: Uint16Array;
}

export interface WrpData {
  info: WrpMapInfo;
  elevations: Float32Array;
  rvmats: string[];
  models: string[];
  objects: WrpObjectsData;
}

function skipGridBlock(reader: BinaryReader, dataSize: number) {
  const isPresent = reader.readUint8();
  if (!isPresent) {
    reader.readUint32();
    return;
  }
  skipABPacket(reader, dataSize);
}

function skipABPacket(reader: BinaryReader, dataSize: number) {
  const flagBits = reader.readUint16();
  for (let i = 0; i < 16; i++) {
    if (flagBits & (1 << i)) {
      skipABPacket(reader, dataSize);
    } else {
      reader.skip(dataSize);
    }
  }
}

function readLZOCompressed(reader: BinaryReader, expectedSize: number): Uint8Array {
  const result = decompressLzo(reader.buffer, reader.position, expectedSize);
  if (result.data.length !== expectedSize) {
    throw new Error(
      `LZO output size mismatch: got ${result.data.length}, expected ${expectedSize}`
    );
  }
  reader.skip(result.bytesRead);
  return result.data;
}

function skipLZOCompressed(reader: BinaryReader, expectedSize: number): void {
  const result = decompressLzo(reader.buffer, reader.position, expectedSize);
  reader.skip(result.bytesRead);
}

function matrixToQuaternion(m: number[]): [number, number, number, number, number] {
  const scale = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
  const s = scale > 0.0001 ? 1 / scale : 1;

  const m00 = m[0] * s;
  const m10 = m[1] * s;
  const m20 = m[2] * s;
  const m01 = m[3] * s;
  const m11 = m[4] * s;
  const m21 = m[5] * s;
  const m02 = m[6] * s;
  const m12 = m[7] * s;
  const m22 = m[8] * s;

  const trace = m00 + m11 + m22;
  let qx: number;
  let qy: number;
  let qz: number;
  let qw: number;

  if (trace > 0) {
    const r = Math.sqrt(1 + trace);
    const inv = 0.5 / r;
    qw = 0.5 * r;
    qx = (m21 - m12) * inv;
    qy = (m02 - m20) * inv;
    qz = (m10 - m01) * inv;
  } else if (m00 > m11 && m00 > m22) {
    const r = Math.sqrt(1 + m00 - m11 - m22);
    const inv = 0.5 / r;
    qx = 0.5 * r;
    qy = (m10 + m01) * inv;
    qz = (m02 + m20) * inv;
    qw = (m21 - m12) * inv;
  } else if (m11 > m22) {
    const r = Math.sqrt(1 - m00 + m11 - m22);
    const inv = 0.5 / r;
    qy = 0.5 * r;
    qx = (m10 + m01) * inv;
    qz = (m21 + m12) * inv;
    qw = (m02 - m20) * inv;
  } else {
    const r = Math.sqrt(1 - m00 - m11 + m22);
    const inv = 0.5 / r;
    qz = 0.5 * r;
    qx = (m02 + m20) * inv;
    qy = (m21 + m12) * inv;
    qw = (m10 - m01) * inv;
  }

  return [qx, qy, qz, qw, scale];
}

export function parseWrp(data: Uint8Array): WrpData {
  const reader = new BinaryReader(data);

  const sig = reader.readString(4);
  if (sig !== "OPRW") {
    throw new Error(`Unknown WRP signature: "${sig}"`);
  }

  const version = reader.readUint32();
  reader.readUint32();
  const layerSizeX = reader.readUint32();
  const layerSizeY = reader.readUint32();
  const mapSizeX = reader.readUint32();
  const mapSizeY = reader.readUint32();
  const layerCellSize = reader.readFloat32();

  const mapSize = mapSizeX * mapSizeY;
  const layerSize = layerSizeX * layerSizeY;
  const terrainCellSize = (layerCellSize * layerSizeX) / mapSizeX;
  const mapSizeMeters = layerCellSize * layerSizeX;

  skipGridBlock(reader, 4);
  skipGridBlock(reader, 4);

  const nPeaks = reader.readUint32();
  reader.skip(nPeaks * 12);

  skipGridBlock(reader, 4);

  skipLZOCompressed(reader, mapSize);
  skipLZOCompressed(reader, mapSize);

  const elevationByteSize = mapSize * 4;
  const elevationBuf = readLZOCompressed(reader, elevationByteSize);
  const elevations = new Float32Array(
    elevationBuf.buffer,
    elevationBuf.byteOffset,
    mapSize
  );

  let elevMin = Infinity;
  let elevMax = -Infinity;
  for (let i = 0; i < mapSize; i++) {
    const v = elevations[i];
    if (v < elevMin) elevMin = v;
    if (v > elevMax) elevMax = v;
  }

  const nRvmats = reader.readUint32();
  const rvmats: string[] = [];
  for (let i = 0; i < nRvmats; i++) {
    rvmats.push(reader.readAsciiz());
    reader.readUint8();
  }

  const nModels = reader.readUint32();
  const models: string[] = [];
  for (let i = 0; i < nModels; i++) {
    models.push(reader.readAsciiz());
  }

  const classifications = new Uint8Array(nModels);
  for (let i = 0; i < nModels; i++) {
    classifications[i] = classifyModel(models[i]);
  }

  const nClassedModels = reader.readUint32();
  for (let i = 0; i < nClassedModels; i++) {
    reader.readAsciiz();
    reader.readAsciiz();
    reader.skip(12);
    reader.skip(4);
  }

  skipGridBlock(reader, 4);

  const sizeOfObjects = reader.readUint32();
  const nObjectsEstimate = Math.floor(sizeOfObjects / 60);

  skipGridBlock(reader, 4);

  reader.readUint32();

  readLZOCompressed(reader, layerSize);
  readLZOCompressed(reader, mapSize);

  reader.readUint32();
  const sizeOfRoadNets = reader.readUint32();

  // Some maps use road-net variants that do not match the naive per-layer parser.
  // The format includes the byte size up front, so skip the whole block directly.
  if (reader.position + sizeOfRoadNets > reader.length) {
    throw new Error("Road-net block exceeds WRP size");
  }
  reader.skip(sizeOfRoadNets);

  const positions = new Float32Array(nObjectsEstimate * 3);
  const scales = new Float32Array(nObjectsEstimate);
  const quaternions = new Float32Array(nObjectsEstimate * 4);
  const modelIndices = new Uint16Array(nObjectsEstimate);

  const objDV = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let objPos = reader.position;
  let count = 0;

  for (let i = 0; i < nObjectsEstimate; i++) {
    if (objPos + 60 > data.byteLength) break;

    const modelIndex = objDV.getUint32(objPos + 4, true);
    const transform = new Array<number>(12);
    for (let j = 0; j < 12; j++) {
      transform[j] = objDV.getFloat32(objPos + 8 + j * 4, true);
    }
    const static02 = objDV.getUint32(objPos + 56, true);
    if (static02 !== 0x02) break;

    const [qx, qy, qz, qw, scale] = matrixToQuaternion(transform);
    const posOff = count * 3;
    const quatOff = count * 4;

    positions[posOff] = transform[9];
    positions[posOff + 1] = transform[10];
    positions[posOff + 2] = transform[11];
    scales[count] = scale;
    quaternions[quatOff] = qx;
    quaternions[quatOff + 1] = qy;
    quaternions[quatOff + 2] = qz;
    quaternions[quatOff + 3] = qw;
    modelIndices[count] = modelIndex > 65535 ? 65535 : modelIndex;

    objPos += 60;
    count++;
  }

  const info: WrpMapInfo = {
    version,
    layerSizeX,
    layerSizeY,
    mapSizeX,
    mapSizeY,
    cellSize: terrainCellSize,
    mapSizeMeters,
    elevationMin: elevMin,
    elevationMax: elevMax,
  };

  return {
    info,
    elevations,
    rvmats,
    models,
    objects: {
      nObjects: count,
      nModels,
      classifications,
      positions: positions.subarray(0, count * 3),
      scales: scales.subarray(0, count),
      quaternions: quaternions.subarray(0, count * 4),
      modelIndices: modelIndices.subarray(0, count),
    },
  };
}
