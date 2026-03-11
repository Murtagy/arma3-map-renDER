import { parsePbo, extractEntry } from "../server/parsers/pbo.js";
import { BinaryReader } from "../server/parsers/binary-reader.js";

const pboPath = process.argv[2]!;
const pbo = parsePbo(pboPath);
const wrpEntry = pbo.entries.find((e) => e.filename.toLowerCase().endsWith(".wrp"))!;
const data = extractEntry(pbo, wrpEntry);
const reader = new BinaryReader(data);

// Header: "OPRW" + version 25
reader.skip(4 + 4); // skip sig + version

// Read header fields
console.log("=== Header interpretation ===");
const fields: { offset: number; u32: number; f32: number }[] = [];
for (let i = 0; i < 10; i++) {
  const offset = reader.position;
  const bytes = reader.readBytes(4);
  reader.seek(offset);
  const u32 = reader.readUint32();
  reader.seek(offset);
  const f32 = reader.readFloat32();
  fields.push({ offset, u32, f32 });
  console.log(
    `  [${offset}] u32=${u32} f32=${f32.toFixed(4)} hex=${bytes.toString("hex")}`
  );
  reader.seek(offset + 4);
}

// Interpretation:
// [8]  appId = 0
// [12] layerSizeX = 256 (texture layer grid)
// [16] layerSizeY = 256
// [20] mapSizeX = 2048 (BUT could also be texture grid)
// [24] mapSizeY = 2048
// [28] cellSize = 32.0
//
// Question: is terrain 256x256 (cell=32m, map=8192m) or 2048x2048 (cell=32m, map=65536m)?
// Zargabad is ~8km, so 256x256 @ 32m = 8192m makes sense!

// But let me also check: maybe the fields are reordered for v25
// Let's try: terrain = 256x256, layers = 2048x2048

// After header, scan for actual elevation data (100-500m range for Zargabad)
console.log("\n=== Deep scan for Zargabad elevation data (100-500m) ===");

const fileSize = data.length;
const step = 4; // scan every 4 bytes (float32 aligned)
const sampleSize = 50;

// Try both interpretations
for (const terrainSize of [256, 2048]) {
  const expectedCount = (terrainSize + 1) * (terrainSize + 1);
  const expectedBytes = expectedCount * 4;
  console.log(
    `\nLooking for ${terrainSize}x${terrainSize} grid (${expectedCount} floats, ${(expectedBytes / 1024 / 1024).toFixed(1)} MB)...`
  );

  for (let offset = 32; offset < Math.min(fileSize - sampleSize * 4, 2000000); offset += step) {
    reader.seek(offset);

    // Quick check first 50 values
    let valid = true;
    let min = Infinity, max = -Infinity;
    let zeroCount = 0;
    for (let i = 0; i < sampleSize; i++) {
      const v = reader.readFloat32();
      if (!isFinite(v) || v < -100 || v > 3000) { valid = false; break; }
      if (v > 50) { // Zargabad has significant elevation
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      if (Math.abs(v) < 0.01) zeroCount++;
    }

    // We want values that look like real terrain (not mostly zeros)
    if (!valid) continue;
    if (max < 50) continue; // Need values > 50m for Zargabad
    if (zeroCount > sampleSize * 0.8) continue; // Too many zeros

    // Deeper check: sample more values spread across the expected block
    if (offset + expectedBytes > fileSize) continue;

    let deepValid = true;
    let deepMin = Infinity, deepMax = -Infinity;
    const samples: number[] = [];
    for (let s = 0; s < 200; s++) {
      const sampleOffset = offset + Math.floor((s / 200) * expectedBytes);
      reader.seek(sampleOffset);
      const v = reader.readFloat32();
      if (!isFinite(v) || v < -100 || v > 3000) { deepValid = false; break; }
      deepMin = Math.min(deepMin, v);
      deepMax = Math.max(deepMax, v);
      samples.push(v);
    }

    if (!deepValid) continue;
    if (deepMax - deepMin < 30) continue; // Need real variation

    console.log(`\n  CANDIDATE at offset ${offset} (0x${offset.toString(16)}):`);
    console.log(`  Range: ${deepMin.toFixed(2)} to ${deepMax.toFixed(2)}`);
    reader.seek(offset);
    const first10: number[] = [];
    for (let i = 0; i < 10; i++) first10.push(reader.readFloat32());
    console.log(`  First 10: ${first10.map((v) => v.toFixed(2)).join(", ")}`);

    // Check ~middle of expected block
    const midOffset = offset + Math.floor(expectedBytes / 2);
    reader.seek(midOffset);
    const mid10: number[] = [];
    for (let i = 0; i < 10; i++) mid10.push(reader.readFloat32());
    console.log(`  Mid 10:   ${mid10.map((v) => v.toFixed(2)).join(", ")}`);
  }
}
