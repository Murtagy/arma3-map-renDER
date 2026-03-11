import { parsePbo, extractEntry } from '../server/parsers/pbo.ts';
import { parseWrp } from '../server/parsers/wrp.ts';

const pbo = parsePbo('/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_zargabad.pbo');
const wrpEntry = pbo.entries.find(e => e.filename.toLowerCase().endsWith('.wrp'));
if (!wrpEntry) { console.log('No WRP'); process.exit(1); }
const wrpData = extractEntry(pbo, wrpEntry);
const parsed = parseWrp(wrpData);

const modelCounts = new Map<string, number>();
for (const obj of parsed.objects) {
  const model = parsed.models[obj.modelIndex] || 'unknown';
  modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
}

function classify(p: string) {
  p = p.toLowerCase();
  if (p.includes('tree') || p.includes('bush') || p.includes('forest') || p.includes('palm')) return 0;
  if (p.includes('house') || p.includes('build') || p.includes('barrack') || p.includes('tower') ||
      p.includes('factory') || p.includes('church') || p.includes('mosque') || p.includes('school') ||
      p.includes('shop') || p.includes('hospital') || p.includes('castle') || p.includes('hangar') ||
      p.includes('barn') || p.includes('shed') || p.includes('garage') || p.includes('hut') ||
      p.includes('bunker') || p.includes('mil_') || p.includes('ind_')) return 1;
  if (p.includes('rock') || p.includes('stone') || p.includes('boulder') || p.includes('cliff')) return 2;
  if (p.includes('wall') || p.includes('fence') || p.includes('gate') || p.includes('bridge')) return 3;
  if (p.includes('sign') || p.includes('lamp') || p.includes('light') || p.includes('pole') ||
      p.includes('powerline') || p.includes('wire') || p.includes('antenna')) return 4;
  return 5;
}

const sorted = [...modelCounts.entries()].sort((a, b) => b[1] - a[1]);

console.log('=== Models classified as "other" (not caught by any category) ===');
const otherModels = sorted.filter(([m]) => classify(m) === 5);
for (const [model, count] of otherModels) {
  console.log(`  ${count}\t${model}`);
}
console.log(`\nTotal "other" models: ${otherModels.length}, objects: ${otherModels.reduce((s, [,c]) => s + c, 0)}`);
