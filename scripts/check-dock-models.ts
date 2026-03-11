import { parsePbo, extractEntry } from '../server/parsers/pbo.ts';
import { parseWrp } from '../server/parsers/wrp.ts';

const pbo = parsePbo('/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_chernarus_s.pbo');
const wrpEntry = pbo.entries.find(e => e.filename.toLowerCase().endsWith('.wrp'));
if (!wrpEntry) { console.log('No WRP'); process.exit(1); }
const parsed = parseWrp(extractEntry(pbo, wrpEntry));

// Find objects near the dock area (camera at 13720, 190, 6369)
const cx = 13720, cz = 6369, radius = 500;
const nearby = parsed.objects.filter(o => {
  const x = o.transform[9], z = o.transform[11];
  return Math.abs(x - cx) < radius && Math.abs(z - cz) < radius;
});

console.log(`Objects within ${radius}m of (${cx}, ${cz}): ${nearby.length}`);

// Group by model
const modelGroups = new Map<string, number>();
for (const obj of nearby) {
  const model = parsed.models[obj.modelIndex] || 'unknown';
  modelGroups.set(model, (modelGroups.get(model) || 0) + 1);
}

const sorted = [...modelGroups.entries()].sort((a, b) => b[1] - a[1]);
for (const [model, count] of sorted) {
  console.log(`  ${count}\t${model}`);
}
