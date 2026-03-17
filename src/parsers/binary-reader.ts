export class BinaryReader {
  readonly buffer: Uint8Array;
  private dv: DataView;
  private pos: number;
  private le: boolean;

  constructor(buffer: Uint8Array, littleEndian = true) {
    this.buffer = buffer;
    this.dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
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
    this.ensure(bytes);
    this.pos += bytes;
  }

  private ensure(bytes: number) {
    if (this.pos + bytes > this.buffer.length) {
      throw new Error(
        `BinaryReader out of bounds: pos=${this.pos}, need=${bytes}, len=${this.buffer.length}`
      );
    }
  }

  readUint8(): number {
    this.ensure(1);
    const v = this.dv.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  readUint16(): number {
    this.ensure(2);
    const v = this.dv.getUint16(this.pos, this.le);
    this.pos += 2;
    return v;
  }

  readInt32(): number {
    this.ensure(4);
    const v = this.dv.getInt32(this.pos, this.le);
    this.pos += 4;
    return v;
  }

  readUint32(): number {
    this.ensure(4);
    const v = this.dv.getUint32(this.pos, this.le);
    this.pos += 4;
    return v;
  }

  readFloat32(): number {
    this.ensure(4);
    const v = this.dv.getFloat32(this.pos, this.le);
    this.pos += 4;
    return v;
  }

  readFloat64(): number {
    this.ensure(8);
    const v = this.dv.getFloat64(this.pos, this.le);
    this.pos += 8;
    return v;
  }

  readBytes(count: number): Uint8Array {
    this.ensure(count);
    const slice = this.buffer.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }

  readString(length: number): string {
    this.ensure(length);
    let out = "";
    const end = this.pos + length;
    for (let i = this.pos; i < end; i++) {
      out += String.fromCharCode(this.buffer[i]);
    }
    this.pos = end;
    return out;
  }

  readAsciiz(): string {
    let end = this.pos;
    while (end < this.buffer.length && this.buffer[end] !== 0) {
      end++;
    }
    let out = "";
    for (let i = this.pos; i < end; i++) {
      out += String.fromCharCode(this.buffer[i]);
    }
    this.pos = end + 1;
    return out;
  }

  readFloat32Array(count: number): Float32Array {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.readFloat32();
    }
    return arr;
  }

  readUint16Array(count: number): Uint16Array {
    const arr = new Uint16Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.readUint16();
    }
    return arr;
  }

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

  readXYZ(): [number, number, number] {
    return [this.readFloat32(), this.readFloat32(), this.readFloat32()];
  }

  readTransformMatrix(): number[] {
    const m: number[] = [];
    for (let i = 0; i < 12; i++) {
      m.push(this.readFloat32());
    }
    return m;
  }

  peek(count: number): Uint8Array {
    return this.buffer.subarray(this.pos, this.pos + count);
  }
}
