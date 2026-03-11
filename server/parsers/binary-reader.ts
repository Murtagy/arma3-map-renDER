/**
 * Simple binary reader for parsing Arma 3 file formats.
 * Wraps a Buffer with a cursor for sequential reads.
 */
export class BinaryReader {
  readonly buffer: Buffer;
  private pos: number;
  private le: boolean; // little-endian

  constructor(buffer: Buffer, littleEndian = true) {
    this.buffer = buffer;
    this.pos = 0;
    this.le = littleEndian;
  }

  get position(): number {
    return this.pos;
  }

  get length(): number {
    return this.buffer.length;
  }

  get remaining(): number {
    return this.buffer.length - this.pos;
  }

  seek(offset: number) {
    this.pos = offset;
  }

  skip(bytes: number) {
    this.pos += bytes;
  }

  readUint8(): number {
    const v = this.buffer.readUInt8(this.pos);
    this.pos += 1;
    return v;
  }

  readUint16(): number {
    const v = this.le
      ? this.buffer.readUInt16LE(this.pos)
      : this.buffer.readUInt16BE(this.pos);
    this.pos += 2;
    return v;
  }

  readInt32(): number {
    const v = this.le
      ? this.buffer.readInt32LE(this.pos)
      : this.buffer.readInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  readUint32(): number {
    const v = this.le
      ? this.buffer.readUInt32LE(this.pos)
      : this.buffer.readUInt32BE(this.pos);
    this.pos += 4;
    return v;
  }

  readFloat32(): number {
    const v = this.le
      ? this.buffer.readFloatLE(this.pos)
      : this.buffer.readFloatBE(this.pos);
    this.pos += 4;
    return v;
  }

  readFloat64(): number {
    const v = this.le
      ? this.buffer.readDoubleLE(this.pos)
      : this.buffer.readDoubleBE(this.pos);
    this.pos += 8;
    return v;
  }

  readBytes(count: number): Buffer {
    const slice = this.buffer.subarray(this.pos, this.pos + count);
    this.pos += count;
    return Buffer.from(slice);
  }

  readString(length: number): string {
    const s = this.buffer.toString("ascii", this.pos, this.pos + length);
    this.pos += length;
    return s;
  }

  /** Read null-terminated ASCII string */
  readAsciiz(): string {
    let end = this.pos;
    while (end < this.buffer.length && this.buffer[end] !== 0) {
      end++;
    }
    const s = this.buffer.toString("ascii", this.pos, end);
    this.pos = end + 1; // skip the null terminator
    return s;
  }

  /** Read an array of float32 values */
  readFloat32Array(count: number): Float32Array {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.readFloat32();
    }
    return arr;
  }

  /** Read an array of uint16 values */
  readUint16Array(count: number): Uint16Array {
    const arr = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.readUint16();
    }
    return arr;
  }

  /** Read a compressed int (used in ODOL P3D) */
  readCompressedInt(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.readUint8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result;
  }

  /** Read XYZ triplet as [x, y, z] */
  readXYZ(): [number, number, number] {
    return [this.readFloat32(), this.readFloat32(), this.readFloat32()];
  }

  /** Read a 4x4 transform matrix (column-major, 12 floats — 3x4 in Arma) */
  readTransformMatrix(): number[] {
    const m: number[] = [];
    for (let i = 0; i < 12; i++) {
      m.push(this.readFloat32());
    }
    return m;
  }

  /** Peek at bytes without advancing position */
  peek(count: number): Buffer {
    return Buffer.from(this.buffer.subarray(this.pos, this.pos + count));
  }

  /** Debug: hex dump from current position */
  hexDump(count: number = 64): string {
    const bytes = this.buffer.subarray(this.pos, this.pos + count);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    const ascii = Array.from(bytes)
      .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
      .join("");
    return `[${this.pos}] ${hex}\n     ${ascii}`;
  }
}
