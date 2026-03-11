import { readFileSync } from "fs";
import { BinaryReader } from "./binary-reader.js";

export interface PboEntry {
  filename: string;
  packingMethod: number;
  originalSize: number;
  reserved: number;
  timestamp: number;
  dataSize: number;
  dataOffset: number; // computed after reading all headers
}

export interface PboFile {
  prefix: string;
  entries: PboEntry[];
  buffer: Buffer;
}

const PACKING_VERS = 0x56657273; // 'Vers' - product entry
const PACKING_CPRS = 0x43707273; // 'Cprs' - compressed
const PACKING_ENCO = 0x456e6372; // 'Encr' - encrypted

/**
 * Parse a PBO archive file.
 * PBO is the standard archive format for Arma content.
 */
export function parsePbo(filePath: string): PboFile {
  const buf = readFileSync(filePath);
  const reader = new BinaryReader(buf);

  const entries: PboEntry[] = [];
  let prefix = "";

  // Read entry headers
  while (true) {
    const filename = reader.readAsciiz();
    const packingMethod = reader.readUint32();
    const originalSize = reader.readUint32();
    const reserved = reader.readUint32();
    const timestamp = reader.readUint32();
    const dataSize = reader.readUint32();

    // Special "Vers" product entry — first entry with empty filename
    if (packingMethod === PACKING_VERS) {
      // Read product properties (key=value pairs until empty string)
      while (true) {
        const key = reader.readAsciiz();
        if (key === "") break;
        const value = reader.readAsciiz();
        if (key === "prefix") {
          prefix = value;
        }
      }
      continue;
    }

    // Empty entry marks end of headers
    if (
      filename === "" &&
      packingMethod === 0 &&
      originalSize === 0 &&
      dataSize === 0
    ) {
      break;
    }

    entries.push({
      filename,
      packingMethod,
      originalSize,
      reserved,
      timestamp,
      dataSize,
      dataOffset: 0, // computed below
    });
  }

  // Compute data offsets — data starts right after all headers
  const dataStart = reader.position;
  let offset = dataStart;
  for (const entry of entries) {
    entry.dataOffset = offset;
    offset += entry.dataSize;
  }

  return { prefix, entries, buffer: buf };
}

/**
 * Extract a single file from a PBO.
 * Returns the raw file data as a Buffer.
 */
export function extractEntry(pbo: PboFile, entry: PboEntry): Buffer {
  if (entry.packingMethod === PACKING_CPRS) {
    // Compressed entries need LZH/LZSS decompression
    // For now, return raw data and we'll handle decompression if needed
    console.warn(`Compressed entry: ${entry.filename} — returning raw data`);
  }
  return pbo.buffer.subarray(
    entry.dataOffset,
    entry.dataOffset + entry.dataSize
  );
}

/**
 * Find an entry by filename (case-insensitive).
 */
export function findEntry(
  pbo: PboFile,
  filename: string
): PboEntry | undefined {
  const lower = filename.toLowerCase().replace(/\\/g, "/");
  return pbo.entries.find(
    (e) => e.filename.toLowerCase().replace(/\\/g, "/") === lower
  );
}

/**
 * List all entries in a PBO.
 */
export function listEntries(pbo: PboFile): string[] {
  return pbo.entries.map((e) => e.filename);
}
