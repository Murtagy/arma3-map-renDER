import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { BinaryReader } from "./binary-reader.js";
// lzo.ts no longer used - native addon handles all LZO decompression

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lzoAddon = require(
  path.resolve(__dirname, "../../native/build/Release/lzo_addon.node")
) as {
  decompress: (buf: Buffer, expectedSize: number) => { data: Buffer; bytesRead: number };
  skipDecompress: (buf: Buffer, expectedSize: number) => number;
};

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

export interface WrpObject {
  objectId: number;
  modelIndex: number;
  transform: number[]; // 4x3 transform matrix (12 floats)
}

export interface WrpData {
  info: WrpMapInfo;
  elevations: Float32Array;
  rvmats: string[];
  models: string[];
  objects: WrpObject[];
}

/**
 * Skip a GridBlock structure in the OPRW format.
 * GridBlocks are recursive tree structures used for spatial data.
 *
 * Format:
 *   isPresent: u8
 *   if isPresent == 0: u32 (always 0)
 *   else: ABPacket tree
 *
 * ABPacket: u16 flags, then for each of 16 bits:
 *   if bit set: recurse ABPacket
 *   else: read dataSize raw bytes (ABPair)
 */
function skipGridBlock(reader: BinaryReader, dataSize: number) {
  const isPresent = reader.readUint8();
  if (!isPresent) {
    const nullVal = reader.readUint32();
    if (nullVal !== 0) {
      console.warn(`GridBlock null value expected 0, got ${nullVal}`);
    }
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
      // ABPair: raw data
      reader.skip(dataSize);
    }
  }
}

/**
 * Read LZO-compressed data block from the stream.
 * Uses custom native addon that returns both decompressed data AND bytes consumed.
 */
function readLZOCompressed(
  reader: BinaryReader,
  expectedSize: number
): Buffer {
  const remaining = Buffer.from(reader.buffer.subarray(reader.position));
  const result = lzoAddon.decompress(remaining, expectedSize);
  reader.skip(result.bytesRead);
  return result.data;
}

/**
 * Skip an LZO-compressed block without keeping the output.
 * Decompresses to find the compressed size, then discards the data.
 * Avoids Node.js Buffer allocation for the output.
 */
function skipLZOCompressed(
  reader: BinaryReader,
  expectedSize: number
): void {
  const remaining = Buffer.from(reader.buffer.subarray(reader.position));
  const bytesRead = lzoAddon.skipDecompress(remaining, expectedSize);
  reader.skip(bytesRead);
}

/**
 * Parse an OPRW (Arma 2/3 binarized world) file.
 *
 * Format (from grad_aff C++ reference):
 *   1. Header: "OPRW", version, appId, layerSizeX/Y, mapSizeX/Y, cellSize
 *   2. GridBlock (geography) - u32 per cell
 *   3. GridBlock (cfgEnvSounds) - u32 per cell
 *   4. nPeaks + XYZ triplets
 *   5. GridBlock (rvmatLayerIndex) - u32 per cell
 *   6. LZO compressed: randomClutter (mapSize bytes)
 *   7. LZO compressed: unknown (mapSize bytes)
 *   8. LZO compressed: elevation (mapSize * 4 bytes = float32[])
 *   9. rvmats, models, classedModels, objects, roadNets, mapInfo
 */
export function parseWrp(data: Buffer): WrpData {
  const reader = new BinaryReader(data);

  // --- Header ---
  const sig = reader.readString(4);
  if (sig !== "OPRW") {
    throw new Error(`Unknown WRP signature: "${sig}" (expected "OPRW")`);
  }

  const version = reader.readUint32();
  console.log(`WRP version: ${version}`);

  const appId = reader.readUint32();
  const layerSizeX = reader.readUint32();
  const layerSizeY = reader.readUint32();
  const mapSizeX = reader.readUint32();
  const mapSizeY = reader.readUint32();
  const layerCellSize = reader.readFloat32();

  const mapSize = mapSizeX * mapSizeY;
  const layerSize = layerSizeX * layerSizeY;

  // layerCellSize is the size of each LAYER cell (not terrain cell)
  // Terrain cell size = layerCellSize * layerSizeX / mapSizeX
  const terrainCellSize = (layerCellSize * layerSizeX) / mapSizeX;
  const mapSizeMeters = layerCellSize * layerSizeX;

  console.log(
    `Layer: ${layerSizeX}x${layerSizeY} @ ${layerCellSize}m, Map: ${mapSizeX}x${mapSizeY} @ ${terrainCellSize}m`
  );
  console.log(`Map physical size: ${mapSizeMeters}m (${mapSizeMeters / 1000}km)`);

  // --- GridBlock: geography (u32 per cell, based on layerSize dimensions) ---
  console.log(`[${reader.position}] Reading geography GridBlock...`);
  skipGridBlock(reader, 4);

  // --- GridBlock: cfgEnvSounds ---
  console.log(`[${reader.position}] Reading cfgEnvSounds GridBlock...`);
  skipGridBlock(reader, 4);

  // --- Peaks ---
  const nPeaks = reader.readUint32();
  console.log(`[${reader.position}] Peaks: ${nPeaks}`);
  reader.skip(nPeaks * 12); // 3 floats per peak

  // --- GridBlock: rvmatLayerIndex ---
  console.log(`[${reader.position}] Reading rvmatLayerIndex GridBlock...`);
  skipGridBlock(reader, 4);

  // --- LZO compressed: randomClutter (mapSize bytes) --- skip, not needed
  skipLZOCompressed(reader, mapSize);

  // --- LZO compressed: unknown bytes (mapSize bytes) --- skip, not needed
  skipLZOCompressed(reader, mapSize);

  // --- LZO compressed: elevation (mapSize * 4 bytes) ---
  const elevationByteSize = mapSize * 4;
  console.log(
    `[${reader.position}] Decompressing elevation (${elevationByteSize} bytes = ${mapSize} floats)...`
  );
  const elevationBuf = readLZOCompressed(reader, elevationByteSize);

  // Convert to Float32Array
  const elevations = new Float32Array(
    elevationBuf.buffer,
    elevationBuf.byteOffset,
    mapSize
  );

  let elevMin = Infinity, elevMax = -Infinity;
  for (let i = 0; i < mapSize; i++) {
    const v = elevations[i];
    if (v < elevMin) elevMin = v;
    if (v > elevMax) elevMax = v;
  }
  console.log(`Elevation range: ${elevMin.toFixed(2)} to ${elevMax.toFixed(2)}m`);

  // --- Rvmats ---
  const nRvmats = reader.readUint32();
  console.log(`[${reader.position}] Rvmats: ${nRvmats}`);
  const rvmats: string[] = [];
  for (let i = 0; i < nRvmats; i++) {
    rvmats.push(reader.readAsciiz());
    const zero = reader.readUint8(); // null byte after each rvmat
  }

  // --- Models ---
  const nModels = reader.readUint32();
  console.log(`[${reader.position}] Models: ${nModels}`);
  const models: string[] = [];
  for (let i = 0; i < nModels; i++) {
    models.push(reader.readAsciiz());
  }

  // --- Classed models ---
  const nClassedModels = reader.readUint32();
  console.log(`[${reader.position}] Classed models: ${nClassedModels}`);
  for (let i = 0; i < nClassedModels; i++) {
    reader.readAsciiz(); // className
    reader.readAsciiz(); // modelPath
    reader.skip(12); // position XYZ
    reader.skip(4); // unknown u32
  }

  // --- Unknown GridBlock 3 ---
  console.log(`[${reader.position}] Skipping unknownGridBlock3...`);
  skipGridBlock(reader, 4);

  // --- Size of objects ---
  const sizeOfObjects = reader.readUint32();
  const OBJECT_SIZE = 56; // 4 + 4 + 48 (4x3 matrix) + 4 (static 0x02) = 60? Let me check
  // From grad_aff: objectId(4) + modelIndex(4) + transform 4x3(48) + static0x02(4) = 60 bytes
  const nObjects = Math.floor(sizeOfObjects / 60);
  console.log(
    `[${reader.position}] Objects: sizeOfObjects=${sizeOfObjects}, estimated count=${nObjects}`
  );

  // --- Unknown GridBlock 4 ---
  console.log(`[${reader.position}] Skipping unknownGridBlock4...`);
  skipGridBlock(reader, 4);

  // --- Size of map info ---
  const sizeOfMapInfo = reader.readUint32();
  console.log(`[${reader.position}] Map info size: ${sizeOfMapInfo}`);

  // --- LZO compressed bytes 2 (layerSize) ---
  console.log(`[${reader.position}] Decompressing compressedBytes2 (${layerSize} bytes)...`);
  readLZOCompressed(reader, layerSize);

  // --- LZO compressed bytes 3 (mapSize) ---
  console.log(`[${reader.position}] Decompressing compressedBytes3 (${mapSize} bytes)...`);
  readLZOCompressed(reader, mapSize);

  // --- Max object ID and road nets size ---
  const maxObjectId = reader.readUint32();
  const sizeOfRoadNets = reader.readUint32();
  console.log(`MaxObjectId: ${maxObjectId}, RoadNets size: ${sizeOfRoadNets}`);

  // Skip road nets (complex structure, not needed for initial terrain rendering)
  // We'll parse objects after road nets

  // For now, skip to objects by reading road nets
  console.log(`[${reader.position}] Skipping road nets (${layerSize} entries)...`);
  for (let i = 0; i < layerSize; i++) {
    const nRoadParts = reader.readUint32();
    for (let j = 0; j < nRoadParts; j++) {
      const nRoadPositions = reader.readUint16();
      reader.skip(nRoadPositions * 12); // XYZ per position
      reader.skip(nRoadPositions); // additional bytes
      reader.skip(4); // unknown 4 bytes
      reader.readAsciiz(); // p3dModel
      reader.skip(48); // transform matrix 4x3
    }
  }

  // --- Objects --- (fast path using DataView)
  console.log(`[${reader.position}] Reading ${nObjects} objects...`);
  const objects: WrpObject[] = new Array(nObjects);
  const objBuf = reader.buffer;
  const objDV = new DataView(objBuf.buffer, objBuf.byteOffset);
  let objPos = reader.position;
  let objCount = 0;
  for (let i = 0; i < nObjects; i++) {
    const objectId = objDV.getUint32(objPos, true);
    const modelIndex = objDV.getUint32(objPos + 4, true);
    const transform = new Array(12);
    for (let j = 0; j < 12; j++) {
      transform[j] = objDV.getFloat32(objPos + 8 + j * 4, true);
    }
    const static02 = objDV.getUint32(objPos + 56, true);
    if (static02 !== 0x02) {
      console.warn(`Object ${i}: expected static 0x02, got 0x${static02.toString(16)} at ${objPos + 56}`);
      break;
    }
    objects[i] = { objectId, modelIndex, transform };
    objPos += 60;
    objCount++;
  }
  objects.length = objCount;
  reader.seek(objPos);

  console.log(`Parsed ${objCount} objects`);
  if (models.length > 0) {
    console.log(`Model paths sample: ${models.slice(0, 5).join(", ")}`);
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
    objects,
  };
}
