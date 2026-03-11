import { parsePbo, extractEntry } from '../server/parsers/pbo.ts';
import { parseWrp } from '../server/parsers/wrp.ts';

const pbo = parsePbo('/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_zargabad.pbo');
const wrpEntry = pbo.entries.find(e => e.filename.toLowerCase().endsWith('.wrp'))!;
const parsed = parseWrp(extractEntry(pbo, wrpEntry));

// Find some wall/fence objects to inspect their transforms
const wallModels = parsed.models
  .map((m, i) => ({ model: m, idx: i }))
  .filter(m => m.model.toLowerCase().includes('wall') || m.model.toLowerCase().includes('fence'));

console.log(`Wall/fence models: ${wallModels.length}`);
for (const wm of wallModels.slice(0, 5)) {
  console.log(`  [${wm.idx}] ${wm.model}`);
  const objs = parsed.objects.filter(o => o.modelIndex === wm.idx).slice(0, 3);
  for (const obj of objs) {
    const t = obj.transform;
    console.log(`    aside: [${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)}]`);
    console.log(`    up:    [${t[3].toFixed(3)}, ${t[4].toFixed(3)}, ${t[5].toFixed(3)}]`);
    console.log(`    dir:   [${t[6].toFixed(3)}, ${t[7].toFixed(3)}, ${t[8].toFixed(3)}]`);
    console.log(`    pos:   [${t[9].toFixed(3)}, ${t[10].toFixed(3)}, ${t[11].toFixed(3)}]`);
    const scaleA = Math.sqrt(t[0]*t[0]+t[1]*t[1]+t[2]*t[2]);
    const scaleU = Math.sqrt(t[3]*t[3]+t[4]*t[4]+t[5]*t[5]);
    const scaleD = Math.sqrt(t[6]*t[6]+t[7]*t[7]+t[8]*t[8]);
    console.log(`    scales: aside=${scaleA.toFixed(3)} up=${scaleU.toFixed(3)} dir=${scaleD.toFixed(3)}`);
  }
}
