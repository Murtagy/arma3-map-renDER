import { parsePbo, extractEntry } from '../server/parsers/pbo.ts';
import { parseWrp } from '../server/parsers/wrp.ts';

const pbo = parsePbo('/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_chernarus_s.pbo');
const wrpEntry = pbo.entries.find(e => e.filename.toLowerCase().endsWith('.wrp'));
if (!wrpEntry) process.exit(1);
const parsed = parseWrp(extractEntry(pbo, wrpEntry));

const counts = new Map<number, number>();
for (const o of parsed.objects) counts.set(o.modelIndex, (counts.get(o.modelIndex) || 0) + 1);

// Show all models classified as "building" with counts
const buildings = parsed.models
  .map((m, i) => ({ model: m, idx: i, count: counts.get(i) || 0 }))
  .filter(m => {
    const p = m.model.toLowerCase();
    return p.includes('house') || p.includes('build') || p.includes('barrack') ||
      p.includes('tower') || p.includes('church') || p.includes('mosque') ||
      p.includes('shop') || p.includes('factory') || p.includes('industr') ||
      p.includes('shed') || p.includes('barn') || p.includes('garage') ||
      p.includes('hospital') || p.includes('school') || p.includes('hotel') ||
      p.includes('hangar') || p.includes('bunker') || p.includes('hut') ||
      p.includes('store') || p.includes('office') || p.includes('station');
  })
  .sort((a, b) => b.count - a.count);

for (const b of buildings.slice(0, 60)) {
  console.log(`${b.count}\t${b.model}`);
}
