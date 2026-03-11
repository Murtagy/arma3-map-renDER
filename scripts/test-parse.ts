import { parsePbo, extractEntry } from "../server/parsers/pbo.js";
import { parseWrp } from "../server/parsers/wrp.js";

const pboPath = process.argv[2]!;
console.log(`Loading PBO: ${pboPath}`);
const pbo = parsePbo(pboPath);
const wrpEntry = pbo.entries.find((e) => e.filename.toLowerCase().endsWith(".wrp"))!;
console.log(`Extracting WRP: ${wrpEntry.filename} (${(wrpEntry.dataSize / 1024 / 1024).toFixed(1)} MB)`);
const data = extractEntry(pbo, wrpEntry);

console.log("\nParsing WRP...\n");
const wrp = parseWrp(data);

console.log("\n=== Result ===");
console.log("Info:", JSON.stringify(wrp.info, null, 2));
console.log(`Elevation samples (first 20): ${Array.from(wrp.elevations.subarray(0, 20)).map((v) => v.toFixed(2)).join(", ")}`);
console.log(`Elevation samples (middle): ${Array.from(wrp.elevations.subarray(Math.floor(wrp.elevations.length / 2), Math.floor(wrp.elevations.length / 2) + 20)).map((v) => v.toFixed(2)).join(", ")}`);
console.log(`Rvmats: ${wrp.rvmats.length}`);
console.log(`Models: ${wrp.models.length}`);
console.log(`Objects: ${wrp.objects.length}`);
