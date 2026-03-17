import { BinaryReader } from "./binary-reader";

export interface PboEntry {
  filename: string;
  packingMethod: number;
  originalSize: number;
  reserved: number;
  timestamp: number;
  dataSize: number;
  dataOffset: number;
}

export interface PboFile {
  prefix: string;
  entries: PboEntry[];
  buffer: Uint8Array;
}

const PACKING_VERS = 0x56657273;
const PACKING_CPRS = 0x43707273;

export function parsePboBuffer(buf: Uint8Array): PboFile {
  const reader = new BinaryReader(buf);

  const entries: PboEntry[] = [];
  let prefix = "";

  while (true) {
    const filename = reader.readAsciiz();
    const packingMethod = reader.readUint32();
    const originalSize = reader.readUint32();
    const reserved = reader.readUint32();
    const timestamp = reader.readUint32();
    const dataSize = reader.readUint32();

    if (packingMethod === PACKING_VERS) {
      while (true) {
        const key = reader.readAsciiz();
        if (key === "") break;
        const value = reader.readAsciiz();
        if (key === "prefix") prefix = value;
      }
      continue;
    }

    if (filename === "" && packingMethod === 0 && originalSize === 0 && dataSize === 0) {
      break;
    }

    entries.push({
      filename,
      packingMethod,
      originalSize,
      reserved,
      timestamp,
      dataSize,
      dataOffset: 0,
    });
  }

  const dataStart = reader.position;
  let offset = dataStart;
  for (const entry of entries) {
    entry.dataOffset = offset;
    offset += entry.dataSize;
  }

  return { prefix, entries, buffer: buf };
}

export function extractEntry(pbo: PboFile, entry: PboEntry): Uint8Array {
  if (entry.packingMethod === PACKING_CPRS) {
    throw new Error(`Compressed PBO entry not supported: ${entry.filename}`);
  }
  return pbo.buffer.subarray(entry.dataOffset, entry.dataOffset + entry.dataSize);
}

export function listEntries(pbo: PboFile): string[] {
  return pbo.entries.map((e) => e.filename);
}
