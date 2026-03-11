import { parsePbo, extractEntry } from '../server/parsers/pbo.ts';
import { parseWrp } from '../server/parsers/wrp.ts';

const pbo = parsePbo('/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_chernarus_s.pbo');
const wrpEntry = pbo.entries.find(e => e.filename.toLowerCase().endsWith('.wrp'));
if (!wrpEntry) process.exit(1);
const parsed = parseWrp(extractEntry(pbo, wrpEntry));

// Check if different axes have different scales (non-uniform scaling = size info?)
const houses = parsed.models
  .map((m, i) => ({ model: m, idx: i }))
  .filter(m => m.model.toLowerCase().includes('house_1w') || m.model.toLowerCase().includes('house_2'));

for (const h of houses.slice(0, 8)) {
  const objs = parsed.objects.filter(o => o.modelIndex === h.idx).slice(0, 2);
  for (const obj of objs) {
    const t = obj.transform;
    const sx = Math.sqrt(t[0]*t[0] + t[1]*t[1] + t[2]*t[2]);
    const sy = Math.sqrt(t[3]*t[3] + t[4]*t[4] + t[5]*t[5]);
    const sz = Math.sqrt(t[6]*t[6] + t[7]*t[7] + t[8]*t[8]);
    console.log(`${h.model.split('/').pop()}  scale: ${sx.toFixed(3)}, ${sy.toFixed(3)}, ${sz.toFixed(3)}`);
  }
}

// Check sheds
const sheds = parsed.models
  .map((m, i) => ({ model: m, idx: i }))
  .filter(m => m.model.toLowerCase().includes('shed'));
for (const s of sheds.slice(0, 4)) {
  const objs = parsed.objects.filter(o => o.modelIndex === s.idx).slice(0, 1);
  for (const obj of objs) {
    const t = obj.transform;
    const sx = Math.sqrt(t[0]*t[0] + t[1]*t[1] + t[2]*t[2]);
    const sy = Math.sqrt(t[3]*t[3] + t[4]*t[4] + t[5]*t[5]);
    const sz = Math.sqrt(t[6]*t[6] + t[7]*t[7] + t[8]*t[8]);
    console.log(`${s.model.split('/').pop()}  scale: ${sx.toFixed(3)}, ${sy.toFixed(3)}, ${sz.toFixed(3)}`);
  }
}
