import { parsePbo, extractEntry } from "../server/parsers/pbo.js";
import { BinaryReader } from "../server/parsers/binary-reader.js";

const pboPath = process.argv[2]!;
const pbo = parsePbo(pboPath);
const wrpEntry = pbo.entries.find((e) => e.filename.toLowerCase().endsWith(".wrp"))!;
const data = extractEntry(pbo, wrpEntry);
const reader = new BinaryReader(data);
const fileSize = data.length;

console.log(`WRP size: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

// For both possible terrain sizes, compute where the elevation block would end
// and check if that fits in the file
for (const gridSize of [257, 2049]) {
  const byteSize = gridSize * gridSize * 4;
  console.log(
    `\nGrid ${gridSize}x${gridSize}: ${byteSize} bytes (${(byteSize / 1024 / 1024).toFixed(1)} MB)`
  );
  console.log(`  Max start offset: ${fileSize - byteSize}`);
}

// Scan entire file: for each 4-byte-aligned offset, check if a contiguous block
// of float32 values all fall in [-100, 3000] and have meaningful variation
console.log("\n=== Full file scan (relaxed: range > 10m, values in [-100, 3000]) ===");

const blockSizes = [257 * 257, 2049 * 2049];
const found: { offset: number; blockSize: number; min: number; max: number }[] = [];

// Quick scan: check 100 evenly-spaced samples across the expected block
for (const bs of blockSizes) {
  const byteLen = bs * 4;
  const maxOffset = fileSize - byteLen;
  if (maxOffset < 0) {
    console.log(`Block size ${bs} too large for file`);
    continue;
  }

  const label = bs === 257 * 257 ? "256x256" : "2048x2048";
  console.log(`\nScanning for ${label} (${bs} floats)...`);

  // Scan at larger step for the big block
  const scanStep = bs > 100000 ? 256 : 4;

  for (let offset = 32; offset <= maxOffset; offset += scanStep) {
    // Sample 100 points across the block
    let valid = true;
    let min = Infinity, max = -Infinity;
    let nonZeroCount = 0;
    const nSamples = 100;

    for (let s = 0; s < nSamples; s++) {
      const sampleOff = offset + Math.floor((s / nSamples) * byteLen);
      // Ensure aligned
      const aligned = sampleOff - (sampleOff % 4);
      reader.seek(aligned);
      const v = reader.readFloat32();
      if (!isFinite(v) || v < -100 || v > 3000) { valid = false; break; }
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (Math.abs(v) > 1) nonZeroCount++;
    }

    if (!valid) continue;
    if (max - min < 10) continue; // need real variation
    if (nonZeroCount < nSamples * 0.1) continue; // need non-trivial values

    console.log(`\n  CANDIDATE at offset ${offset} (0x${offset.toString(16)}):`);
    console.log(`  Range: ${min.toFixed(2)} to ${max.toFixed(2)}, non-zero: ${nonZeroCount}/${nSamples}`);

    reader.seek(offset);
    const first: number[] = [];
    for (let i = 0; i < 15; i++) first.push(reader.readFloat32());
    console.log(`  First 15: ${first.map((v) => v.toFixed(2)).join(", ")}`);

    const midOff = offset + Math.floor(byteLen / 2);
    reader.seek(midOff);
    const mid: number[] = [];
    for (let i = 0; i < 15; i++) mid.push(reader.readFloat32());
    console.log(`  Mid 15:   ${mid.map((v) => v.toFixed(2)).join(", ")}`);

    const endOff = offset + byteLen - 60;
    reader.seek(endOff);
    const end: number[] = [];
    for (let i = 0; i < 15; i++) end.push(reader.readFloat32());
    console.log(`  End 15:   ${end.map((v) => v.toFixed(2)).join(", ")}`);

    found.push({ offset, blockSize: bs, min, max });

    // Skip past this block for next search
    offset += byteLen - scanStep;
  }
}

if (found.length === 0) {
  console.log("\nNo elevation blocks found with standard float32 scan.");
  console.log("The data may be compressed. Let's check for LZO/LZSS signatures...");

  // Look for known compression signatures
  for (let i = 0; i < Math.min(fileSize - 4, 100000); i++) {
    reader.seek(i);
    const sig = reader.readString(4);
    if (sig === "LZO\0" || sig === "LZSS" || sig === "LZ4 " || sig === "ZLIB") {
      console.log(`  Compression signature "${sig}" found at offset ${i}`);
    }
  }

  // Also check if data might be uint16 heights (packed)
  console.log("\n=== Trying uint16 heights ===");
  for (let offset = 32; offset < Math.min(fileSize, 500000); offset += 2) {
    reader.seek(offset);
    let valid = true;
    let min = 65535, max = 0;
    let nz = 0;
    for (let i = 0; i < 100; i++) {
      if (reader.remaining < 2) { valid = false; break; }
      const v = reader.readUint16();
      if (v > 10000) { valid = false; break; } // unlikely elevation
      min = Math.min(min, v);
      max = Math.max(max, v);
      if (v > 0) nz++;
    }
    if (!valid) continue;
    if (max - min < 50) continue;
    if (nz < 30) continue;

    console.log(`  uint16 candidate at ${offset}: range ${min}-${max}, nz=${nz}`);
    reader.seek(offset);
    const vals: number[] = [];
    for (let i = 0; i < 20; i++) vals.push(reader.readUint16());
    console.log(`  First 20: ${vals.join(", ")}`);
    break; // show first hit only
  }
}
