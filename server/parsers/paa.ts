import { BinaryReader } from "./binary-reader.js";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lzoAddon = require(
  path.resolve(__dirname, "../../native/build/Release/lzo_addon.node")
) as { decompress: (buf: Buffer, expectedSize: number) => { data: Buffer; bytesRead: number } };

// PAA type tags
const PAA_DXT1 = 0xff01;
const PAA_DXT5 = 0xff05;

interface PaaMipmap {
  width: number;
  height: number;
  lzoCompressed: boolean;
  data: Buffer;
}

export interface PaaImage {
  type: number;
  width: number;
  height: number;
  rgba: Buffer; // RGBA pixel data
}

/**
 * Parse a PAA file and decode the largest mipmap to RGBA.
 */
export function parsePaa(data: Buffer): PaaImage {
  const reader = new BinaryReader(data);

  // Type tag
  const type = reader.readUint16();

  // Read TAGGs
  while (reader.position < data.length) {
    const peek = data[reader.position];
    // TAGGs start with "GGAT" (0x47 0x47 0x41 0x54)
    // End when we see a byte that's not 'G' (0x47)
    if (peek !== 0x47) break;

    reader.skip(8); // signature (8 bytes)
    const tagLen = reader.readUint32();
    reader.skip(tagLen); // tag data
  }

  // Palette
  const paletteLen = reader.readUint16();
  if (paletteLen > 0) {
    reader.skip(paletteLen * 3); // RGB palette entries
  }

  // Read first (largest) mipmap
  const rawWidth = reader.readUint16();
  const rawHeight = reader.readUint16();

  const lzoCompressed = (rawWidth & 0x8000) !== 0;
  const width = rawWidth & 0x7fff;
  const height = rawHeight;

  // 3-byte LE data length
  const b0 = reader.readUint8();
  const b1 = reader.readUint8();
  const b2 = reader.readUint8();
  const dataLen = b0 | (b1 << 8) | (b2 << 16);

  let mipData = Buffer.from(data.subarray(reader.position, reader.position + dataLen));
  reader.skip(dataLen);

  // LZO decompress if needed
  if (lzoCompressed) {
    const expectedSize = dxtExpectedSize(type, width, height);
    const result = lzoAddon.decompress(mipData, expectedSize);
    mipData = result.data;
  }

  // Decode DXT to RGBA
  let rgba: Buffer;
  if (type === PAA_DXT1) {
    rgba = decodeDXT1(mipData, width, height);
  } else if (type === PAA_DXT5) {
    rgba = decodeDXT5(mipData, width, height);
  } else {
    throw new Error(`Unsupported PAA type: 0x${type.toString(16)}`);
  }

  // Force all alpha to 255 (satellite textures should be fully opaque)
  for (let i = 3; i < rgba.length; i += 4) {
    rgba[i] = 255;
  }

  return { type, width, height, rgba };
}

function dxtExpectedSize(type: number, w: number, h: number): number {
  const blocks = Math.ceil(w / 4) * Math.ceil(h / 4);
  if (type === PAA_DXT1) return blocks * 8;
  return blocks * 16; // DXT5
}

// --- DXT1 Decoder ---

function rgb565to888(c: number): [number, number, number] {
  const r = ((c >> 11) & 0x1f) * 255 / 31;
  const g = ((c >> 5) & 0x3f) * 255 / 63;
  const b = (c & 0x1f) * 255 / 31;
  return [r | 0, g | 0, b | 0];
}

function decodeDXT1(src: Buffer, width: number, height: number): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  let srcOff = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const c0raw = src.readUInt16LE(srcOff); srcOff += 2;
      const c1raw = src.readUInt16LE(srcOff); srcOff += 2;
      const indices = src.readUInt32LE(srcOff); srcOff += 4;

      const c0 = rgb565to888(c0raw);
      const c1 = rgb565to888(c1raw);

      const colors: [number, number, number, number][] = [
        [c0[0], c0[1], c0[2], 255],
        [c1[0], c1[1], c1[2], 255],
        [0, 0, 0, 255],
        [0, 0, 0, 0],
      ];

      if (c0raw > c1raw) {
        colors[2] = [((2 * c0[0] + c1[0]) / 3) | 0, ((2 * c0[1] + c1[1]) / 3) | 0, ((2 * c0[2] + c1[2]) / 3) | 0, 255];
        colors[3] = [((c0[0] + 2 * c1[0]) / 3) | 0, ((c0[1] + 2 * c1[1]) / 3) | 0, ((c0[2] + 2 * c1[2]) / 3) | 0, 255];
      } else {
        colors[2] = [((c0[0] + c1[0]) / 2) | 0, ((c0[1] + c1[1]) / 2) | 0, ((c0[2] + c1[2]) / 2) | 0, 255];
        colors[3] = [0, 0, 0, 0]; // transparent
      }

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;

          const bitIdx = (py * 4 + px) * 2;
          const colorIdx = (indices >> bitIdx) & 0x03;
          const c = colors[colorIdx];

          const dstOff = (y * width + x) * 4;
          rgba[dstOff] = c[0];
          rgba[dstOff + 1] = c[1];
          rgba[dstOff + 2] = c[2];
          rgba[dstOff + 3] = c[3];
        }
      }
    }
  }

  return rgba;
}

// --- DXT5 Decoder ---

function decodeDXT5(src: Buffer, width: number, height: number): Buffer {
  const rgba = Buffer.alloc(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  let srcOff = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Alpha block
      const a0 = src[srcOff++];
      const a1 = src[srcOff++];
      // 6 bytes of 3-bit alpha indices (48 bits for 16 pixels)
      // Read as two 24-bit values to avoid JS number precision issues
      const alphaLo = src[srcOff] | (src[srcOff + 1] << 8) | (src[srcOff + 2] << 16);
      const alphaHi = src[srcOff + 3] | (src[srcOff + 4] << 8) | (src[srcOff + 5] << 16);
      srcOff += 6;

      // Build alpha lookup
      const alphas = new Uint8Array(8);
      alphas[0] = a0;
      alphas[1] = a1;
      if (a0 > a1) {
        for (let i = 1; i <= 6; i++) alphas[i + 1] = ((7 - i) * a0 + i * a1) / 7;
      } else {
        for (let i = 1; i <= 4; i++) alphas[i + 1] = ((5 - i) * a0 + i * a1) / 5;
        alphas[6] = 0;
        alphas[7] = 255;
      }

      // Color block (same as DXT1)
      const c0raw = src.readUInt16LE(srcOff); srcOff += 2;
      const c1raw = src.readUInt16LE(srcOff); srcOff += 2;
      const indices = src.readUInt32LE(srcOff); srcOff += 4;

      const c0 = rgb565to888(c0raw);
      const c1 = rgb565to888(c1raw);

      const colors: [number, number, number][] = [
        c0, c1,
        [((2 * c0[0] + c1[0]) / 3) | 0, ((2 * c0[1] + c1[1]) / 3) | 0, ((2 * c0[2] + c1[2]) / 3) | 0],
        [((c0[0] + 2 * c1[0]) / 3) | 0, ((c0[1] + 2 * c1[1]) / 3) | 0, ((c0[2] + 2 * c1[2]) / 3) | 0],
      ];

      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;

          const pixIdx = py * 4 + px;
          const colorIdx = (indices >> (pixIdx * 2)) & 0x03;
          const c = colors[colorIdx];

          // Get alpha from 48-bit field (3 bits per pixel)
          const alphaBitOffset = pixIdx * 3;
          let alphaIdx: number;
          if (alphaBitOffset < 24) {
            alphaIdx = (alphaLo >> alphaBitOffset) & 0x07;
          } else {
            alphaIdx = (alphaHi >> (alphaBitOffset - 24)) & 0x07;
          }

          const dstOff = (y * width + x) * 4;
          rgba[dstOff] = c[0];
          rgba[dstOff + 1] = c[1];
          rgba[dstOff + 2] = c[2];
          rgba[dstOff + 3] = alphas[alphaIdx];
        }
      }
    }
  }

  return rgba;
}
