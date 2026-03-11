import { parsePbo, extractEntry } from "../server/parsers/pbo.js";
import { decompressLzo } from "../server/parsers/lzo.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const lzo = require("lzo");

const pboPath = process.argv[2]!;
const pbo = parsePbo(pboPath);
const wrpEntry = pbo.entries.find((e) => e.filename.toLowerCase().endsWith(".wrp"))!;
const data = extractEntry(pbo, wrpEntry);

const ELEV_OFFSET = 2528716;
const mapSize = 2048 * 2048;

// Get compressed size from custom LZO
const custom = decompressLzo(data, ELEV_OFFSET, mapSize * 4);
console.log(`Custom LZO consumed ${custom.bytesRead} bytes`);

// Try native with exact size
const exactChunk = Buffer.from(data.subarray(ELEV_OFFSET, ELEV_OFFSET + custom.bytesRead));
console.log(`Passing exactly ${exactChunk.length} bytes to native lzo`);

try {
  const result = lzo.decompress(exactChunk, mapSize * 4);
  const floats = new Float32Array(result.buffer, result.byteOffset, mapSize);
  console.log(`First 10: ${Array.from(floats.subarray(0, 10)).map(v => v.toFixed(2)).join(", ")}`);

  let bad = 0;
  for (let i = 0; i < floats.length; i++) {
    if (isNaN(floats[i]) || !isFinite(floats[i]) || floats[i] < -500 || floats[i] > 5000) bad++;
  }
  console.log(`Bad values: ${bad}/${mapSize}`);
} catch (e: any) {
  console.log(`Native failed: ${e.message}`);

  // Try binary search for correct compressed size
  console.log("\nBinary searching for correct compressed size...");
  for (let delta = -100; delta <= 100; delta++) {
    const size = custom.bytesRead + delta;
    const chunk = Buffer.from(data.subarray(ELEV_OFFSET, ELEV_OFFSET + size));
    try {
      const result = lzo.decompress(chunk, mapSize * 4);
      const floats = new Float32Array(result.buffer, result.byteOffset, mapSize);
      let bad = 0;
      for (let i = 0; i < floats.length; i++) {
        if (isNaN(floats[i]) || !isFinite(floats[i]) || floats[i] < -500 || floats[i] > 5000) bad++;
      }
      console.log(`delta=${delta}, size=${size}: SUCCESS! Bad values: ${bad}/${mapSize}`);
      console.log(`First 10: ${Array.from(floats.subarray(0, 10)).map(v => v.toFixed(2)).join(", ")}`);
      break;
    } catch {
      // continue
    }
  }
}
