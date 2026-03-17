export const MAP_MIRROR_X = true;

export function mapToWorldX(mapX: number, mapSize: number): number {
  if (!MAP_MIRROR_X) return mapX;
  return mapSize - mapX;
}

export function worldToMapX(worldX: number, mapSize: number): number {
  if (!MAP_MIRROR_X) return worldX;
  return mapSize - worldX;
}

export function terrainSampleIndexX(gridX: number, gridWidth: number): number {
  if (!MAP_MIRROR_X) return gridX;
  return gridWidth - 1 - gridX;
}

export function textureUFromGridX(gridX: number, gridWidth: number): number {
  if (gridWidth <= 1) return 0;
  const u = gridX / (gridWidth - 1);
  return MAP_MIRROR_X ? 1 - u : u;
}

export function mapDirDegToWorldDeg(mapDirDeg: number): number {
  const normalized = ((mapDirDeg % 360) + 360) % 360;
  if (!MAP_MIRROR_X) return normalized;
  return (360 - normalized) % 360;
}

export function mapDirDegToWorldYawRad(mapDirDeg: number): number {
  return (mapDirDegToWorldDeg(mapDirDeg) * Math.PI) / 180;
}
