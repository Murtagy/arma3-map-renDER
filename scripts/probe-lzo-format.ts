import { parsePbo, extractEntry } from '../server/parsers/pbo.ts';
import { BinaryReader } from '../server/parsers/binary-reader.ts';
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lzoAddon = require(
  path.resolve(__dirname, "../native/build/Release/lzo_addon.node")
) as { decompress: (buf: Buffer, expectedSize: number) => { data: Buffer; bytesRead: number } };

const pboPath = '/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_chernarus_s.pbo';
const pbo = parsePbo(pboPath);
const wrpEntry = pbo.entries.find(e => e.filename.toLowerCase().endsWith('.wrp'))!;
const wrpData = extractEntry(pbo, wrpEntry);
const reader = new BinaryReader(wrpData);

// Skip header
reader.skip(4 + 4 + 4 + 4 + 4 + 4 + 4 + 4); // sig, version, appId, layerSizeX/Y, mapSizeX/Y, cellSize

const mapSizeX = 4096, mapSizeY = 4096;
const mapSize = mapSizeX * mapSizeY;

function skipGridBlock(r: BinaryReader, ds: number) {
  const p = r.readUint8();
  if (!p) { r.readUint32(); return; }
  skipABPacket(r, ds);
}
function skipABPacket(r: BinaryReader, ds: number) {
  const f = r.readUint16();
  for (let i = 0; i < 16; i++) {
    if (f & (1 << i)) skipABPacket(r, ds);
    else r.skip(ds);
  }
}

skipGridBlock(reader, 4);
skipGridBlock(reader, 4);
const nPeaks = reader.readUint32();
reader.skip(nPeaks * 12);
skipGridBlock(reader, 4);

// Now we're at the LZO sections. Look at the raw bytes to see if there's a length prefix
const posBeforeLZO = reader.position;
console.log(`Position before first LZO block: ${posBeforeLZO}`);
console.log(`Next 32 bytes hex:`);
const peek = reader.peek(32);
console.log(Array.from(peek).map(b => b.toString(16).padStart(2, '0')).join(' '));

// Try reading as potential u32 length prefixes
const dv = new DataView(peek.buffer, peek.byteOffset);
console.log(`As u32 LE: ${dv.getUint32(0, true)}, ${dv.getUint32(4, true)}, ${dv.getUint32(8, true)}, ${dv.getUint32(12, true)}`);

// Now decompress and see how many bytes were consumed
const remaining = Buffer.from(reader.buffer.subarray(reader.position));
const result = lzoAddon.decompress(remaining, mapSize);
console.log(`\nBlock 1 (randomClutter): bytesRead=${result.bytesRead}, output=${result.data.length}`);
console.log(`Bytes before: ${Array.from(remaining.subarray(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);

reader.skip(result.bytesRead);
console.log(`\nPosition before block 2: ${reader.position}`);
const peek2 = reader.peek(16);
console.log(`Next 16 bytes: ${Array.from(peek2).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
const dv2 = new DataView(peek2.buffer, peek2.byteOffset);
console.log(`As u32 LE: ${dv2.getUint32(0, true)}, ${dv2.getUint32(4, true)}`);

const remaining2 = Buffer.from(reader.buffer.subarray(reader.position));
const result2 = lzoAddon.decompress(remaining2, mapSize);
console.log(`Block 2 (unknown): bytesRead=${result2.bytesRead}, output=${result2.data.length}`);

reader.skip(result2.bytesRead);
console.log(`\nPosition before block 3 (elevation): ${reader.position}`);
const peek3 = reader.peek(16);
console.log(`Next 16 bytes: ${Array.from(peek3).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
const dv3 = new DataView(peek3.buffer, peek3.byteOffset);
console.log(`As u32 LE: ${dv3.getUint32(0, true)}, ${dv3.getUint32(4, true)}`);

const remaining3 = Buffer.from(reader.buffer.subarray(reader.position));
const result3 = lzoAddon.decompress(remaining3, mapSize * 4);
console.log(`Block 3 (elevation): bytesRead=${result3.bytesRead}, output=${result3.data.length}`);
