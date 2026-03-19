import type { MissionMarkerDef, MissionObjectDef, MissionUnitDef } from "../workers/types";

export interface MissionSqmData {
  sourceName: string;
  markers: MissionMarkerDef[];
  objects: MissionObjectDef[];
  units: MissionUnitDef[];
}

interface ClassCtx {
  name: string;
  inMission: boolean;
}

interface EntityCtx {
  depth: number;
  parentEntity: EntityCtx | null;
  layer: string;
  id: number;
  dataType: string;
  name: string;
  type: string;
  markerType: string;
  colorName: string;
  fillName: string;
  alpha: number;
  a: number;
  b: number;
  angleDeg: number;
  drawBorder: boolean;
  sideName: string;
  slotName: string;
  callsign: string;
  roleDescription: string;
  playerName: string;
  isPlayable: boolean;
  isPlayer: boolean;
  groupNameHint: string;
  position: [number, number, number] | null;
  angles: [number, number, number] | null;
}

function parseSqmString(valueRaw: string): string {
  const trimmed = valueRaw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

function parseSqmNumber(valueRaw: string, fallback = 0): number {
  const num = Number(valueRaw.trim());
  return Number.isFinite(num) ? num : fallback;
}

function parseSqmNumberArray(valueRaw: string): number[] {
  const trimmed = valueRaw.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return [];
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  return body
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((num) => Number.isFinite(num));
}

function findNearestLayerName(entityStack: EntityCtx[]): string {
  for (let i = entityStack.length - 1; i >= 0; i--) {
    const entity = entityStack[i];
    if (entity.dataType === "Layer" && entity.name) return entity.name;
    if (entity.layer) return entity.layer;
  }
  return "";
}

function findNearestParentEntity(entityStack: EntityCtx[], currentDepth: number): EntityCtx | null {
  for (let i = entityStack.length - 1; i >= 0; i--) {
    if (entityStack[i].depth < currentDepth) {
      return entityStack[i];
    }
  }
  return null;
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function sideNameToIndex(sideName: string): number {
  const normalized = sideName.trim().toLowerCase();
  if (!normalized) return 4;
  if (normalized === "west" || normalized === "blufor" || normalized === "blu_f") return 0;
  if (normalized === "east" || normalized === "opfor" || normalized === "opf_f") return 1;
  if (normalized === "guer" || normalized === "independent" || normalized === "resistance" || normalized === "ind_f")
    return 2;
  if (normalized === "civ" || normalized === "civilian") return 3;
  if (normalized === "empty") return 4;
  return 4;
}

function isMissionUnitEntity(entity: EntityCtx): boolean {
  if (entity.dataType !== "Object") return false;
  if (!entity.position) return false;
  if (!entity.type || entity.type.toLowerCase().startsWith("land_")) return false;

  if (entity.isPlayable || entity.isPlayer) return true;

  const parentIsGroup = entity.parentEntity?.dataType === "Group";
  if (parentIsGroup) return true;

  const sideKnown = sideNameToIndex(entity.sideName) !== 4;
  if (!sideKnown) return false;
  if (entity.groupNameHint.trim()) return true;
  if (entity.slotName.trim() || entity.roleDescription.trim()) return true;
  return false;
}

function sideIndexToKey(side: number): string {
  if (side === 0) return "west";
  if (side === 1) return "east";
  if (side === 2) return "guer";
  if (side === 3) return "civ";
  return "unknown";
}

function resolveEntityGroupName(
  entity: EntityCtx,
  syntheticGroupByEntity: Map<EntityCtx, string>,
  sideGroupCounters: Map<string, number>
): string {
  const parent = entity.parentEntity;
  if (parent && parent.dataType === "Group") {
    const parentName = firstNonEmpty(parent.slotName, parent.callsign, parent.name, parent.groupNameHint);
    if (parentName) return parentName;

    const cached = syntheticGroupByEntity.get(parent);
    if (cached) return cached;
    const sideIdx = sideNameToIndex(parent.sideName || entity.sideName);
    const sideKey = sideIndexToKey(sideIdx);
    const next = (sideGroupCounters.get(sideKey) || 0) + 1;
    sideGroupCounters.set(sideKey, next);
    const synthetic = `1-${next}`;
    syntheticGroupByEntity.set(parent, synthetic);
    return synthetic;
  }
  return firstNonEmpty(entity.groupNameHint);
}

function parseClassName(line: string): string | null {
  const match = line.match(/^class\s+([A-Za-z0-9_#]+)/);
  return match?.[1] ?? null;
}

export function parseMissionSqm(text: string): MissionSqmData {
  const markers: MissionMarkerDef[] = [];
  const objects: MissionObjectDef[] = [];
  const units: MissionUnitDef[] = [];
  const syntheticGroupByEntity = new Map<EntityCtx, string>();
  const sideGroupCounters = new Map<string, number>();
  const classStack: ClassCtx[] = [];
  const entityStack: EntityCtx[] = [];

  let pendingClass: string | null = null;
  let sourceName = "";

  const finalizeEntity = (entity: EntityCtx) => {
    if (!entity.position) return;

    if (entity.dataType === "Marker") {
      markers.push({
        id: entity.id,
        layer: entity.layer,
        name: entity.name,
        markerType: entity.markerType || "ELLIPSE",
        type: entity.type,
        colorName: entity.colorName,
        fillName: entity.fillName,
        alpha: entity.alpha,
        a: entity.a,
        b: entity.b,
        angleDeg: entity.angleDeg,
        drawBorder: entity.drawBorder,
        x: entity.position[0],
        y: entity.position[1],
        z: entity.position[2],
      });
      return;
    }

    if (entity.dataType === "Object") {
      const yaw = entity.angles && Number.isFinite(entity.angles[1]) ? entity.angles[1] : 0;
      objects.push({
        id: entity.id,
        layer: entity.layer,
        type: entity.type,
        x: entity.position[0],
        y: entity.position[1],
        z: entity.position[2],
        angleDeg: (yaw * 180) / Math.PI,
      });

      if (isMissionUnitEntity(entity)) {
        const group = resolveEntityGroupName(entity, syntheticGroupByEntity, sideGroupCounters);
        const slot = firstNonEmpty(
          entity.slotName,
          entity.roleDescription,
          entity.callsign,
          entity.playerName,
          entity.name,
          entity.type,
          `#${entity.id || units.length + 1}`
        );
        units.push({
          id: entity.id || units.length + 1,
          group,
          slot,
          side: sideNameToIndex(entity.sideName),
          x: entity.position[0],
          y: entity.position[1],
          z: entity.position[2],
          type: entity.type,
        });
      }
    }
  };

  const openClass = (className: string) => {
    const parent = classStack[classStack.length - 1];
    const inMission = Boolean(parent?.inMission || className === "Mission");
    classStack.push({ name: className, inMission });

    if (inMission && parent?.name === "Entities" && /^Item\d+$/.test(className)) {
      const currentDepth = classStack.length;
      entityStack.push({
        depth: currentDepth,
        parentEntity: findNearestParentEntity(entityStack, currentDepth),
        layer: findNearestLayerName(entityStack),
        id: 0,
        dataType: "",
        name: "",
        type: "",
        markerType: "",
        colorName: "",
        fillName: "",
        alpha: 1,
        a: 0,
        b: 0,
        angleDeg: 0,
        drawBorder: false,
        sideName: "",
        slotName: "",
        callsign: "",
        roleDescription: "",
        playerName: "",
        isPlayable: false,
        isPlayer: false,
        groupNameHint: "",
        position: null,
        angles: null,
      });
    }
  };

  const closeClass = () => {
    if (classStack.length === 0) return;

    const topEntity = entityStack[entityStack.length - 1];
    if (topEntity && topEntity.depth === classStack.length) {
      finalizeEntity(topEntity);
      entityStack.pop();
    }

    classStack.pop();
  };

  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line || line.startsWith("//")) continue;

    if (pendingClass && line.startsWith("{")) {
      openClass(pendingClass);
      pendingClass = null;
      line = line.slice(1).trim();
      if (!line) continue;
    }

    const className = parseClassName(line);
    if (className) {
      if (line.includes("{")) {
        openClass(className);
      } else {
        pendingClass = className;
      }
      continue;
    }

    if (line === "{" && pendingClass) {
      openClass(pendingClass);
      pendingClass = null;
      continue;
    }

    if (line.startsWith("};") || line === "}" || line === "};") {
      closeClass();
      continue;
    }

    const assignment = line.match(/^([A-Za-z0-9_#]+)(\[\])?\s*=\s*(.+);\s*$/);
    if (!assignment) continue;

    const key = assignment[1];
    const hasArraySuffix = Boolean(assignment[2]);
    const valueRaw = assignment[3];

    if (!sourceName && key === "sourceName") {
      sourceName = parseSqmString(valueRaw);
    }

    const entity = entityStack[entityStack.length - 1];
    if (!entity) continue;

    const classDepth = classStack.length;
    const currentClass = classStack[classDepth - 1];
    const atEntityLevel = classDepth === entity.depth;
    const inPositionInfo = currentClass?.name === "PositionInfo" && classDepth === entity.depth + 1;
    const keyLower = key.toLowerCase();

    if (inPositionInfo && hasArraySuffix && key === "position") {
      const arr = parseSqmNumberArray(valueRaw);
      if (arr.length >= 3) entity.position = [arr[0], arr[1], arr[2]];
      continue;
    }

    if (inPositionInfo && hasArraySuffix && key === "angles") {
      const arr = parseSqmNumberArray(valueRaw);
      if (arr.length >= 3) entity.angles = [arr[0], arr[1], arr[2]];
      continue;
    }

    if (!hasArraySuffix) {
      if (keyLower === "side") {
        entity.sideName = parseSqmString(valueRaw);
      } else if (keyLower === "name") {
        const value = parseSqmString(valueRaw);
        if (entity.dataType === "Group" && value && !entity.groupNameHint) {
          entity.groupNameHint = value;
        }
        if (entity.dataType === "Object" && value && !entity.slotName) {
          entity.slotName = value;
        }
      } else if (keyLower === "isplayable") {
        entity.isPlayable = parseSqmNumber(valueRaw, 0) > 0.5;
      } else if (keyLower === "isplayer") {
        entity.isPlayer = parseSqmNumber(valueRaw, 0) > 0.5;
      } else if (keyLower === "callsign") {
        const value = parseSqmString(valueRaw);
        if (value && !entity.callsign) entity.callsign = value;
      } else if (keyLower === "description" || keyLower === "slot" || keyLower === "rolename") {
        const value = parseSqmString(valueRaw);
        if (value && !entity.roleDescription) entity.roleDescription = value;
      } else if (keyLower === "text") {
        const value = parseSqmString(valueRaw);
        if (value && !entity.slotName) entity.slotName = value;
      } else if (keyLower === "player") {
        const value = parseSqmString(valueRaw);
        if (value && value.toUpperCase() !== "PLAYER COMMANDER" && value.toUpperCase() !== "PLAYER" && !entity.playerName) {
          entity.playerName = value;
        }
      } else if (keyLower === "groupid") {
        const value = parseSqmString(valueRaw);
        if (value && !entity.groupNameHint) entity.groupNameHint = value;
      }
    }

    if (!atEntityLevel) continue;

    if (hasArraySuffix && key === "position") {
      const arr = parseSqmNumberArray(valueRaw);
      if (arr.length >= 3) entity.position = [arr[0], arr[1], arr[2]];
      continue;
    }

    if (key === "dataType") {
      entity.dataType = parseSqmString(valueRaw);
      continue;
    }
    if (key === "name") {
      entity.name = parseSqmString(valueRaw);
      if (entity.dataType === "Layer") {
        entity.layer = entity.name;
      }
      if (entity.dataType === "Object" && !entity.slotName) {
        entity.slotName = entity.name;
      }
      if (entity.dataType === "Group" && !entity.groupNameHint) {
        entity.groupNameHint = entity.name;
      }
      continue;
    }
    if (key === "id") {
      entity.id = Math.trunc(parseSqmNumber(valueRaw, 0));
      continue;
    }
    if (key === "type") {
      entity.type = parseSqmString(valueRaw);
      continue;
    }
    if (key === "markerType") {
      entity.markerType = parseSqmString(valueRaw);
      continue;
    }
    if (key === "colorName") {
      entity.colorName = parseSqmString(valueRaw);
      continue;
    }
    if (key === "fillName") {
      entity.fillName = parseSqmString(valueRaw);
      continue;
    }
    if (key === "alpha") {
      entity.alpha = parseSqmNumber(valueRaw, 1);
      continue;
    }
    if (key === "a") {
      entity.a = parseSqmNumber(valueRaw, 0);
      continue;
    }
    if (key === "b") {
      entity.b = parseSqmNumber(valueRaw, 0);
      continue;
    }
    if (key === "angle") {
      entity.angleDeg = parseSqmNumber(valueRaw, 0);
      continue;
    }
    if (key === "drawBorder") {
      entity.drawBorder = parseSqmNumber(valueRaw, 0) > 0.5;
      continue;
    }
  }

  return {
    sourceName,
    markers,
    objects,
    units,
  };
}
