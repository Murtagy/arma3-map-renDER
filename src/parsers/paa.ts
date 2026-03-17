import { BinaryReader } from "./binary-reader";
import { decompressLzo } from "./lzo";

const PAA_DXT1 = 0xff01;
const PAA_DXT5 = 0xff05;

export interface PaaImage {
  type: number;
  width: number;
  height: number;
  rgba: Uint8Array;
}

export function parsePaa(data: Uint8Array): PaaImage {
  const reader = new BinaryReader(data);

  const type = reader.readUint16();

  while (reader.position < data.length) {
    const peek = data[reader.position];
    if (peek !== 0x47) break;
    reader.skip(8);
    const tagLen = reader.readUint32();
    reader.skip(tagLen);
  }

  const paletteLen = reader.readUint16();
  if (paletteLen > 0) {
    reader.skip(paletteLen * 3);
  }

  const rawWidth = reader.readUint16();
  const rawHeight = reader.readUint16();
  const lzoCompressed = (rawWidth & 0x8000) !== 0;
  const width = rawWidth & 0x7fff;
  const height = rawHeight;

  const b0 = reader.readUint8();
  const b1 = reader.readUint8();
  const b2 = reader.readUint8();
  const dataLen = b0 | (b1 << 8) | (b2 << 16);

  let mipData = data.subarray(reader.position, reader.position + dataLen);

  if (lzoCompressed) {
    const expectedSize = dxtExpectedSize(type, width, height);
    const result = decompressLzo(mipData, 0, expectedSize);
    if (result.data.length !== expectedSize) {
      throw new Error(
        `PAA LZO size mismatch: got ${result.data.length}, expected ${expectedSize}`
      );
    }
    mipData = result.data;
  }

  let rgba: Uint8Array;
  if (type === PAA_DXT1) {
    rgba = decodeDXT1(mipData, width, height);
  } else if (type === PAA_DXT5) {
    rgba = decodeDXT5(mipData, width, height);
  } else {
    throw new Error(`Unsupported PAA type: 0x${type.toString(16)}`);
  }

  for (let i = 3; i < rgba.length; i += 4) {
    rgba[i] = 255;
  }

  return { type, width, height, rgba };
}

function dxtExpectedSize(type: number, w: number, h: number): number {
  const blocks = Math.ceil(w / 4) * Math.ceil(h / 4);
  return type === PAA_DXT1 ? blocks * 8 : blocks * 16;
}

function rgb565to888(c: number): [number, number, number] {
  const r = (((c >> 11) & 0x1f) * 255) / 31;
  const g = (((c >> 5) & 0x3f) * 255) / 63;
  const b = ((c & 0x1f) * 255) / 31;
  return [r | 0, g | 0, b | 0];
}

function decodeDXT1(src: Uint8Array, width: number, height: number): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const rgba = new Uint8Array(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  let srcOff = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const c0raw = dv.getUint16(srcOff, true);
      srcOff += 2;
      const c1raw = dv.getUint16(srcOff, true);
      srcOff += 2;
      const indices = dv.getUint32(srcOff, true);
      srcOff += 4;

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
        colors[3] = [0, 0, 0, 0];
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

function decodeDXT5(src: Uint8Array, width: number, height: number): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const rgba = new Uint8Array(width * height * 4);
  const blocksX = Math.ceil(width / 4);
  const blocksY = Math.ceil(height / 4);
  let srcOff = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const a0 = src[srcOff++];
      const a1 = src[srcOff++];

      const alphaLo = src[srcOff] | (src[srcOff + 1] << 8) | (src[srcOff + 2] << 16);
      const alphaHi = src[srcOff + 3] | (src[srcOff + 4] << 8) | (src[srcOff + 5] << 16);
      srcOff += 6;

      const alphas = new Uint8Array(8);
      alphas[0] = a0;
      alphas[1] = a1;
      if (a0 > a1) {
        for (let i = 1; i <= 6; i++) {
          alphas[i + 1] = (((7 - i) * a0 + i * a1) / 7) | 0;
        }
      } else {
        for (let i = 1; i <= 4; i++) {
          alphas[i + 1] = (((5 - i) * a0 + i * a1) / 5) | 0;
        }
        alphas[6] = 0;
        alphas[7] = 255;
      }

      const c0raw = dv.getUint16(srcOff, true);
      srcOff += 2;
      const c1raw = dv.getUint16(srcOff, true);
      srcOff += 2;
      const indices = dv.getUint32(srcOff, true);
      srcOff += 4;

      const c0 = rgb565to888(c0raw);
      const c1 = rgb565to888(c1raw);
      const colors: [number, number, number][] = [
        c0,
        c1,
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

          const alphaBitOffset = pixIdx * 3;
          const alphaIdx = alphaBitOffset < 24
            ? (alphaLo >> alphaBitOffset) & 0x07
            : (alphaHi >> (alphaBitOffset - 24)) & 0x07;

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
