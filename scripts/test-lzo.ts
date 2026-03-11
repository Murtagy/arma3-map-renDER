/**
 * Test: compare my LZO implementation vs the native lzo package
 * on the actual Zargabad elevation data.
 */
import { parsePbo, extractEntry } from "../server/parsers/pbo.js";
import { BinaryReader } from "../server/parsers/binary-reader.js";
import { decompressLzo } from "../server/parsers/lzo.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const lzo = require("lzo");

const pboPath = process.argv[2]!;
const pbo = parsePbo(pboPath);
const wrpEntry = pbo.entries.find((e) => e.filename.toLowerCase().endsWith(".wrp"))!;
const data = extractEntry(pbo, wrpEntry);

// Parse header and skip to the elevation data
const reader = new BinaryReader(data);
reader.skip(4 + 4); // sig + version
reader.skip(4); // appId
const layerSizeX = reader.readUint32();
const layerSizeY = reader.readUint32();
const mapSizeX = reader.readUint32();
const mapSizeY = reader.readUint32();
const cellSize = reader.readFloat32();
const mapSize = mapSizeX * mapSizeY;

console.log(`Map: ${mapSizeX}x${mapSizeY}, Cell: ${cellSize}m, mapSize: ${mapSize}`);

// We need to skip to the elevation data.
// From the test-parse output, we know the elevation decompression starts at offset 2528716.
// Let me verify by checking the exact offset.

// For now, hard-code the known offset where elevation LZO data starts
const ELEV_OFFSET = 2528716;
console.log(`\nTesting LZO decompression at offset ${ELEV_OFFSET}`);
console.log(`Expected decompressed size: ${mapSize * 4} bytes`);

// Test my implementation
console.log("\n--- Custom LZO ---");
try {
  const result = decompressLzo(data, ELEV_OFFSET, mapSize * 4);
  console.log(`Bytes read from input: ${result.bytesRead}`);
  const floats = new Float32Array(result.data.buffer, result.data.byteOffset, mapSize);
  console.log(`First 10: ${Array.from(floats.subarray(0, 10)).map(v => v.toFixed(2)).join(", ")}`);

  // Check for NaN/Infinity
  let nanCount = 0, infCount = 0, okCount = 0;
  for (let i = 0; i < floats.length; i++) {
    if (isNaN(floats[i])) nanCount++;
    else if (!isFinite(floats[i])) infCount++;
    else okCount++;
  }
  console.log(`Valid: ${okCount}, NaN: ${nanCount}, Inf: ${infCount}`);

  // Find first bad value
  for (let i = 0; i < floats.length; i++) {
    if (isNaN(floats[i]) || !isFinite(floats[i]) || floats[i] < -500 || floats[i] > 5000) {
      console.log(`First bad value at index ${i}: ${floats[i]}`);
      console.log(`Values around it: ${Array.from(floats.subarray(Math.max(0, i-5), i+5)).map(v => v.toFixed(2)).join(", ")}`);
      break;
    }
  }
} catch (e: any) {
  console.log(`Error: ${e.message}`);
}

// Test native lzo package
console.log("\n--- Native LZO ---");
try {
  // Pass a large chunk starting from the elevation offset
  const compressedChunk = data.subarray(ELEV_OFFSET, ELEV_OFFSET + mapSize * 4); // at most this large
  const result = lzo.decompress(compressedChunk, mapSize * 4);
  console.log(`Result type: ${result.constructor.name}, length: ${result.length}`);

  if (result.length >= mapSize * 4) {
    const floats = new Float32Array(result.buffer, result.byteOffset, mapSize);
    console.log(`First 10: ${Array.from(floats.subarray(0, 10)).map(v => v.toFixed(2)).join(", ")}`);

    let nanCount = 0, okCount = 0;
    for (let i = 0; i < floats.length; i++) {
      if (isNaN(floats[i]) || !isFinite(floats[i])) nanCount++;
      else okCount++;
    }
    console.log(`Valid: ${okCount}, NaN/Inf: ${nanCount}`);
  }
} catch (e: any) {
  console.log(`Error: ${e.message}`);
}
