import { parsePbo, extractEntry } from "../server/parsers/pbo.js";
import { BinaryReader } from "../server/parsers/binary-reader.js";

const pboPath = process.argv[2];
if (!pboPath) {
  console.error("Usage: tsx scripts/test-wrp.ts <path-to-pbo>");
  process.exit(1);
}

const pbo = parsePbo(pboPath);
const wrpEntry = pbo.entries.find((e) =>
  e.filename.toLowerCase().endsWith(".wrp")
);
if (!wrpEntry) {
  console.error("No WRP found in PBO");
  process.exit(1);
}

console.log(`Extracting WRP: ${wrpEntry.filename} (${wrpEntry.dataSize} bytes)`);
const data = extractEntry(pbo, wrpEntry);

const reader = new BinaryReader(data);

// Read and dump the header
console.log("\n=== WRP Header ===");
console.log(`Signature: "${reader.readString(4)}"`);
console.log(`Version: ${reader.readUint32()}`);

// Dump next 100 bytes as various interpretations
console.log("\n=== Next bytes (trying different interpretations) ===");
const pos = reader.position;

// As uint32s
reader.seek(pos);
console.log("\nAs uint32:");
for (let i = 0; i < 20; i++) {
  const p = reader.position;
  const v = reader.readUint32();
  console.log(`  [${p}] ${v} (0x${v.toString(16)})`);
}

// As float32s from same position
reader.seek(pos);
console.log("\nAs float32:");
for (let i = 0; i < 20; i++) {
  const p = reader.position;
  const v = reader.readFloat32();
  console.log(`  [${p}] ${v}`);
}

// Hex dump
reader.seek(pos);
console.log("\nHex dump:");
console.log(reader.hexDump(160));

// Try to find "likely elevation data" - scan for blocks of plausible float32s
console.log("\n=== Scanning for elevation data ===");
for (let offset = 0; offset < Math.min(data.length - 100, 500000); offset += 4) {
  reader.seek(offset);
  const samples: number[] = [];
  let plausible = true;
  for (let i = 0; i < 25; i++) {
    const v = reader.readFloat32();
    if (!isFinite(v) || v < -500 || v > 5000) {
      plausible = false;
      break;
    }
    samples.push(v);
  }
  if (plausible) {
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    const range = max - min;
    // Look for data with some variation (not all zeros or constants)
    if (range > 0.1 && range < 3000 && min > -100) {
      console.log(`\nPotential elevation block at offset ${offset}:`);
      console.log(`  Range: ${min.toFixed(2)} to ${max.toFixed(2)}`);
      console.log(`  First 10: ${samples.slice(0, 10).map((v) => v.toFixed(2)).join(", ")}`);
      // Only show first few hits
      if (offset > 100000) break;
    }
  }
}
