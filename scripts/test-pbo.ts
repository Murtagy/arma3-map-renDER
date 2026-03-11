import { parsePbo, listEntries } from "../server/parsers/pbo.js";

const pboPath = process.argv[2];
if (!pboPath) {
  console.error("Usage: tsx scripts/test-pbo.ts <path-to-pbo>");
  process.exit(1);
}

console.log(`Parsing PBO: ${pboPath}`);
const pbo = parsePbo(pboPath);
console.log(`Prefix: "${pbo.prefix}"`);

const entries = listEntries(pbo);
console.log(`\nEntries (${entries.length}):`);

// Show first 50 entries, highlighting WRP files
for (const e of entries.slice(0, 50)) {
  const marker = e.toLowerCase().endsWith(".wrp") ? " <<<< WRP" : "";
  console.log(`  ${e}${marker}`);
}
if (entries.length > 50) {
  console.log(`  ... and ${entries.length - 50} more`);
}

// Show WRP files specifically
const wrpFiles = entries.filter((e) => e.toLowerCase().endsWith(".wrp"));
if (wrpFiles.length > 0) {
  console.log(`\nWRP files found:`);
  for (const w of wrpFiles) {
    const entry = pbo.entries.find((e) => e.filename === w)!;
    console.log(`  ${w} (${(entry.dataSize / 1024 / 1024).toFixed(1)} MB)`);
  }
}

// Show file type summary
const types = new Map<string, number>();
for (const e of entries) {
  const ext = e.includes(".") ? e.split(".").pop()!.toLowerCase() : "no-ext";
  types.set(ext, (types.get(ext) || 0) + 1);
}
console.log("\nFile types:");
for (const [ext, count] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  .${ext}: ${count}`);
}
