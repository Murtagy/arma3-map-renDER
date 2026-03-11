import { parsePbo, extractEntry } from '../server/parsers/pbo.ts';
import { BinaryReader } from '../server/parsers/binary-reader.ts';
import { readdirSync } from 'fs';
import path from 'path';

// Try to find a PBO with P3D files - check structures
const modsDir = '/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons';
const files = readdirSync(modsDir).filter(f => f.endsWith('.pbo'));
console.log(`PBOs in dir: ${files.length}`);

// Look for a structures-related PBO
for (const f of files) {
  if (!f.includes('build') && !f.includes('struct') && !f.includes('house')) continue;
  const pbo = parsePbo(path.join(modsDir, f));
  const p3ds = pbo.entries.filter(e => e.filename.toLowerCase().endsWith('.p3d'));
  if (p3ds.length > 0) {
    console.log(`\n${f}: ${p3ds.length} P3D files`);
    for (const e of p3ds.slice(0, 3)) {
      console.log(`  ${e.filename}`);
      const data = extractEntry(pbo, e);
      const r = new BinaryReader(data);
      const sig = r.readString(4);
      console.log(`    sig: ${sig}, size: ${data.length}`);
      if (sig === 'ODOL') {
        const version = r.readUint32();
        console.log(`    version: ${version}`);
        // ODOL v40+: after version comes appId(4), then nLODs(4)
        // Then LOD resolution array, then for each LOD: header with bounding info
        // But easier: skip to model info which has bounding box
        // Try reading the model info section
        const hex = Array.from(data.subarray(8, 40)).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log(`    bytes 8-40: ${hex}`);
      }
    }
    break;
  }
}

// The P3Ds are likely in a3\structures_f_enoch - which is an Arma 3 base addon
// Let's check if user has Arma 3 installed or other mod PBOs
const a3Dir = '/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20';
try {
  const subdirs = readdirSync(a3Dir);
  console.log(`\nContents of mod dir: ${subdirs.join(', ')}`);
} catch {}
