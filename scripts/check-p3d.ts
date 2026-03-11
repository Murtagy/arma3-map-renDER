import { parsePbo, extractEntry, findEntry } from '../server/parsers/pbo.ts';
import { BinaryReader } from '../server/parsers/binary-reader.ts';
import { parseWrp } from '../server/parsers/wrp.ts';

const pbo = parsePbo('/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_chernarus_s.pbo');
const wrpEntry = pbo.entries.find(e => e.filename.toLowerCase().endsWith('.wrp'));
if (!wrpEntry) process.exit(1);
const parsed = parseWrp(extractEntry(pbo, wrpEntry));

// Check if any model P3Ds are inside this PBO
const p3dEntries = pbo.entries.filter(e => e.filename.toLowerCase().endsWith('.p3d'));
console.log(`P3D files in PBO: ${p3dEntries.length}`);
for (const e of p3dEntries.slice(0, 5)) {
  console.log(`  ${e.filename} (${e.dataSize} bytes)`);
}

// Model paths from WRP reference external PBOs - check a few
console.log(`\nModel paths from WRP (first 10):`);
for (const m of parsed.models.slice(0, 10)) {
  console.log(`  ${m}`);
}

// Check if any WRP model paths match PBO entries
let found = 0;
for (const model of parsed.models.slice(0, 50)) {
  const entry = findEntry(pbo, model);
  if (entry) {
    found++;
    console.log(`  FOUND in PBO: ${model}`);
  }
}
console.log(`\nModels found in this PBO: ${found} / ${Math.min(50, parsed.models.length)} checked`);

// Try to read ODOL header from a P3D if we have any
if (p3dEntries.length > 0) {
  const p3d = extractEntry(pbo, p3dEntries[0]);
  const r = new BinaryReader(p3d);
  const sig = r.readString(4);
  console.log(`\nP3D signature: "${sig}"`);
  if (sig === 'ODOL') {
    const version = r.readUint32();
    console.log(`ODOL version: ${version}`);
  }
}
