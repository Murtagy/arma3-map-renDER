import { parsePbo, extractEntry } from '../server/parsers/pbo.ts';
import { BinaryReader } from '../server/parsers/binary-reader.ts';
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lzoAddon = require(
  path.resolve(__dirname, "../native/build/Release/lzo_addon.node")
) as { decompress: (buf: Buffer, expectedSize: number) => { data: Buffer; bytesRead: number } };

const pboPath = '/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_chernarus_s.pbo';

let t0 = Date.now();
const pbo = parsePbo(pboPath);
console.log(`parsePbo: ${Date.now() - t0}ms`);

t0 = Date.now();
const wrpEntry = pbo.entries.find(e => e.filename.toLowerCase().endsWith('.wrp'))!;
const wrpData = extractEntry(pbo, wrpEntry);
console.log(`extractEntry: ${Date.now() - t0}ms, size: ${(wrpData.length/1024/1024).toFixed(1)}MB`);

const reader = new BinaryReader(wrpData);
const sig = reader.readString(4);
const version = reader.readUint32();
const appId = reader.readUint32();
const layerSizeX = reader.readUint32();
const layerSizeY = reader.readUint32();
const mapSizeX = reader.readUint32();
const mapSizeY = reader.readUint32();
const layerCellSize = reader.readFloat32();
const mapSize = mapSizeX * mapSizeY;
const layerSize = layerSizeX * layerSizeY;
console.log(`Map: ${mapSizeX}x${mapSizeY}, layerSize=${layerSize}`);

function skipGridBlock(r: BinaryReader, ds: number) {
  const p = r.readUint8();
  if (!p) { r.readUint32(); return; }
  skipABPacket(r, ds);
}
function skipABPacket(r: BinaryReader, ds: number) {
  const f = r.readUint16();
  for (let i = 0; i < 16; i++) {
    if (f & (1 << i)) skipABPacket(r, ds);
    else r.skip(ds);
  }
}
function readLZO(r: BinaryReader, expectedSize: number): Buffer {
  const remaining = Buffer.from(r.buffer.subarray(r.position));
  const result = lzoAddon.decompress(remaining, expectedSize);
  r.skip(result.bytesRead);
  return result.data;
}

t0 = Date.now();
skipGridBlock(reader, 4);
skipGridBlock(reader, 4);
const nPeaks = reader.readUint32();
reader.skip(nPeaks * 12);
skipGridBlock(reader, 4);
console.log(`GridBlocks + peaks: ${Date.now() - t0}ms`);

t0 = Date.now();
readLZO(reader, mapSize);
console.log(`LZO randomClutter (${mapSize}B): ${Date.now() - t0}ms`);

t0 = Date.now();
readLZO(reader, mapSize);
console.log(`LZO unknown (${mapSize}B): ${Date.now() - t0}ms`);

t0 = Date.now();
const elevBuf = readLZO(reader, mapSize * 4);
console.log(`LZO elevation (${mapSize*4}B): ${Date.now() - t0}ms`);

t0 = Date.now();
const elevations = new Float32Array(elevBuf.buffer, elevBuf.byteOffset, mapSize);
const elevMin = elevations.reduce((a,b) => Math.min(a,b), Infinity);
const elevMax = elevations.reduce((a,b) => Math.max(a,b), -Infinity);
console.log(`Elevation min/max: ${Date.now() - t0}ms`);

t0 = Date.now();
const nRvmats = reader.readUint32();
for (let i = 0; i < nRvmats; i++) { reader.readAsciiz(); reader.readUint8(); }
console.log(`Rvmats (${nRvmats}): ${Date.now() - t0}ms`);

t0 = Date.now();
const nModels = reader.readUint32();
for (let i = 0; i < nModels; i++) reader.readAsciiz();
console.log(`Models (${nModels}): ${Date.now() - t0}ms`);

t0 = Date.now();
const nClassedModels = reader.readUint32();
for (let i = 0; i < nClassedModels; i++) {
  reader.readAsciiz(); reader.readAsciiz(); reader.skip(16);
}
console.log(`ClassedModels (${nClassedModels}): ${Date.now() - t0}ms`);

t0 = Date.now();
skipGridBlock(reader, 4);
console.log(`unknownGridBlock3: ${Date.now() - t0}ms`);

const sizeOfObjects = reader.readUint32();
const nObjects = Math.floor(sizeOfObjects / 60);

t0 = Date.now();
skipGridBlock(reader, 4);
console.log(`unknownGridBlock4: ${Date.now() - t0}ms`);

const sizeOfMapInfo = reader.readUint32();

t0 = Date.now();
readLZO(reader, layerSize);
console.log(`LZO compressedBytes2 (${layerSize}B): ${Date.now() - t0}ms`);

t0 = Date.now();
readLZO(reader, mapSize);
console.log(`LZO compressedBytes3 (${mapSize}B): ${Date.now() - t0}ms`);

const maxObjectId = reader.readUint32();
const sizeOfRoadNets = reader.readUint32();

t0 = Date.now();
for (let i = 0; i < layerSize; i++) {
  const nRoadParts = reader.readUint32();
  for (let j = 0; j < nRoadParts; j++) {
    const nRoadPositions = reader.readUint16();
    reader.skip(nRoadPositions * 12 + nRoadPositions + 4);
    reader.readAsciiz();
    reader.skip(48);
  }
}
console.log(`RoadNets (${layerSize} entries): ${Date.now() - t0}ms`);

t0 = Date.now();
let objCount = 0;
for (let i = 0; i < nObjects; i++) {
  reader.readUint32(); reader.readUint32();
  reader.skip(48);
  const static02 = reader.readUint32();
  if (static02 !== 0x02) break;
  objCount++;
}
console.log(`Objects (${objCount}): ${Date.now() - t0}ms`);
