/// <reference lib="webworker" />

import type {
  ReplayData,
  ReplayListItem,
  ReplayTimelineEvent,
  ReplayUnitDef,
  ReplayWorkerRequest,
  ReplayWorkerResponse,
} from "./types";

const REPLAY_BASE_URL = "https://replay.tsgames.ru";
const DEFAULT_FILTERS = ["1", "2", "3", "4", "10", "20:1"];

interface ReplayListResponse {
  rows?: Array<{
    name?: unknown;
    archive?: unknown;
    fileSize?: unknown;
    array?: unknown;
  }>;
  error?: unknown;
}

interface ReplayDetailResponse {
  json?: unknown;
  error?: unknown;
}

function post(msg: ReplayWorkerResponse, transfer?: Transferable[]) {
  if (transfer && transfer.length > 0) {
    self.postMessage(msg, transfer);
    return;
  }
  self.postMessage(msg);
}

function progress(stage: "fetch_list" | "fetch_replay" | "parse_replay", detail?: string) {
  post({ type: "replay_progress", stage, detail });
}

function toNumber(value: unknown, fallback = 0): number {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toInt(value: unknown, fallback = 0): number {
  return Math.trunc(toNumber(value, fallback));
}

function toStringSafe(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function getReplayMapFromName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1 || dot + 1 >= name.length) return "";
  return name.slice(dot + 1);
}

function buildListUrl(filters: string[]): string {
  const params = new URLSearchParams();
  params.set("a", "l");
  for (const filter of filters) {
    params.append("params[f][]", filter);
  }
  return `${REPLAY_BASE_URL}/ajax.php?${params.toString()}`;
}

function buildReplayDetailUrl(replayName: string, archive: number): string {
  const params = new URLSearchParams();
  params.set("a", "gl");
  params.set("params[f]", replayName);
  params.set("params[ar]", String(archive));
  params.set("params[a]", "3");
  return `${REPLAY_BASE_URL}/ajax.php?${params.toString()}`;
}

function buildProxyUrl(proxyUrl: string, targetUrl: string): string {
  if (proxyUrl.includes("{url}")) {
    return proxyUrl.replace("{url}", encodeURIComponent(targetUrl));
  }
  if (proxyUrl.endsWith("?") || proxyUrl.endsWith("=") || proxyUrl.endsWith("&")) {
    return `${proxyUrl}${encodeURIComponent(targetUrl)}`;
  }
  if (proxyUrl.includes("?")) {
    return `${proxyUrl}&url=${encodeURIComponent(targetUrl)}`;
  }
  return `${proxyUrl}?url=${encodeURIComponent(targetUrl)}`;
}

async function fetchJsonWithFallback(url: string, proxyUrl?: string): Promise<{
  json: unknown;
  source: "direct" | "proxy";
}> {
  const trimmedProxy = proxyUrl?.trim() || "";

  if (trimmedProxy) {
    const proxiedUrl = buildProxyUrl(trimmedProxy, url);
    try {
      const response = await fetch(proxiedUrl, {
        method: "GET",
        credentials: "omit",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return { json: await response.json(), source: "proxy" };
    } catch (err: unknown) {
      const proxyError = normalizeError(err);
      throw new Error(`Replay fetch via proxy failed: ${proxyError}`);
    }
  }

  let directError = "";
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return { json: await response.json(), source: "direct" };
  } catch (err: unknown) {
    directError = normalizeError(err);
  }

  throw new Error(
    `Replay fetch failed. ${directError}. This is often browser CORS blocking cross-origin access.`
  );
}

function parseReplayListPayload(payload: unknown): ReplayListItem[] {
  const data = payload as ReplayListResponse;
  if (data.error && toStringSafe(data.error).trim()) {
    throw new Error(`Replay list API error: ${toStringSafe(data.error)}`);
  }

  if (!Array.isArray(data.rows)) {
    throw new Error("Replay list payload is missing rows");
  }

  const rows: ReplayListItem[] = [];
  for (const row of data.rows) {
    const name = toStringSafe(row.name);
    if (!name) continue;
    const tagsRaw = Array.isArray(row.array) ? row.array : [];
    const tags = tagsRaw.map((item) => toStringSafe(item)).filter((item) => item.length > 0);
    rows.push({
      name,
      archive: toInt(row.archive, 0),
      fileSize: toInt(row.fileSize, 0),
      tags,
      serverTag: tags[0] || name.split(".")[0] || "",
      mapKey: tags[3] || getReplayMapFromName(name),
      missionName: tags[2] || "",
      missionDate: tags[1] || "",
    });
  }

  return rows;
}

function parseReplayEvent(
  eventRaw: unknown[],
  frame: number,
  timeSec: number
): ReplayTimelineEvent {
  const eventType = toInt(eventRaw[0], -1);

  if (eventType === 0) {
    return {
      type: 0,
      frame,
      timeSec,
      message: toStringSafe(eventRaw[1]),
    };
  }

  if (eventType === 4) {
    return {
      type: 4,
      frame,
      timeSec,
      killerId: toInt(eventRaw[2], 0),
      victimId: toInt(eventRaw[3], 0),
      weapon: toStringSafe(eventRaw[4]),
      ammo: toStringSafe(eventRaw[5]),
      distance: toNumber(eventRaw[6], 0),
    };
  }

  if (eventType === 5) {
    return {
      type: 5,
      frame,
      timeSec,
      sourceId: toInt(eventRaw[10] ?? eventRaw[2], 0),
      targetId: toInt(eventRaw[3], 0),
      weapon: toStringSafe(eventRaw[4]),
      ammo: toStringSafe(eventRaw[5]),
      distance: toNumber(eventRaw[6], 0),
      damage: toNumber(eventRaw[7], 0),
      fatal: Boolean(eventRaw[8]),
      projectile: toStringSafe(eventRaw[9]),
    };
  }

  if (eventType === 7) {
    return {
      type: 7,
      frame,
      timeSec,
      actorId: toInt(eventRaw[2], 0),
      targetId: toInt(eventRaw[3], 0),
      action: toStringSafe(eventRaw[4]),
      amount: toNumber(eventRaw[5], 0),
      success: Boolean(eventRaw[6]),
      canCancel: Boolean(eventRaw[7]),
    };
  }

  return {
    type: -1,
    eventType,
    frame,
    timeSec,
    raw: eventRaw,
  };
}

function parseReplayPayload(
  replayName: string,
  archive: number,
  source: "direct" | "proxy",
  payload: unknown
): ReplayData {
  const data = payload as ReplayDetailResponse;
  if (data.error && toStringSafe(data.error).trim()) {
    throw new Error(`Replay detail API error: ${toStringSafe(data.error)}`);
  }

  if (typeof data.json !== "string") {
    throw new Error("Replay detail payload does not contain json string");
  }

  const raw = JSON.parse(data.json) as unknown;
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error("Replay format is invalid");
  }

  const headerRaw = Array.isArray(raw[0]) ? raw[0] : [];
  const mapKey = toStringSafe(headerRaw[0]) || getReplayMapFromName(replayName);
  const missionName = toStringSafe(headerRaw[1]);
  const recordedAt = toStringSafe(headerRaw[2]);
  const missionDateParts = Array.isArray(headerRaw[3])
    ? headerRaw[3].map((value) => toInt(value, 0))
    : [];
  const stepSec = toInt(headerRaw[4], 5);
  const initialMarkers = Array.isArray(headerRaw[5]) ? headerRaw[5] : [];

  const unitsById = new Map<number, ReplayUnitDef>();
  const ensureUnit = (id: number): ReplayUnitDef => {
    const existing = unitsById.get(id);
    if (existing) return existing;
    const created: ReplayUnitDef = {
      id,
      kind: "unit",
      name: `#${id}`,
      playerName: "",
      model: "",
      side: 4,
      unitType: "unknown",
      group: "",
      slot: "",
      steamId: "",
    };
    unitsById.set(id, created);
    return created;
  };

  const initFrame = Array.isArray(raw[1]) ? raw[1] : [];
  const defsRaw = Array.isArray(initFrame[1]) ? initFrame[1] : [];
  for (const entry of defsRaw) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const defType = toInt(entry[0], -1);
    const id = toInt(entry[1], 0);
    if (id <= 0) continue;
    const unit = ensureUnit(id);

    if (defType === 1) {
      unit.kind = "unit";
      unit.name = toStringSafe(entry[2], unit.name);
      unit.model = toStringSafe(entry[3], unit.model);
      unit.side = toInt(entry[4], unit.side);
      unit.unitType = toStringSafe(entry[5], unit.unitType).toLowerCase();
      unit.group = toStringSafe(entry[6], unit.group);
      unit.slot = toStringSafe(entry[7], unit.slot);
      continue;
    }

    if (defType === 2) {
      unit.kind = "vehicle";
      unit.name = toStringSafe(entry[2], unit.name);
      unit.model = toStringSafe(entry[2], unit.model);
      unit.side = 3;
      unit.unitType = toStringSafe(entry[3], "vehicle").toLowerCase();
      unit.slot = unit.name;
      continue;
    }

    if (defType === 3) {
      const unitName = toStringSafe(entry[2]);
      const playerName = toStringSafe(entry[3]);
      unit.name = playerName || unitName || unit.name;
      unit.playerName = playerName;
      unit.steamId = toStringSafe(entry[4], unit.steamId);
    }
  }

  const frameTimes: number[] = [];
  const frameStateOffsets: number[] = [];
  const frameStateCounts: number[] = [];
  const frameEventOffsets: number[] = [];
  const frameEventCounts: number[] = [];
  const stateValues: number[] = [];
  const events: ReplayTimelineEvent[] = [];

  for (let frameIndex = 2; frameIndex < raw.length; frameIndex++) {
    const frameRaw = Array.isArray(raw[frameIndex]) ? raw[frameIndex] : [];
    const timeSec = toInt(frameRaw[0], 0);
    frameTimes.push(timeSec);

    const eventOffset = events.length;
    const eventsRaw = Array.isArray(frameRaw[1]) ? frameRaw[1] : [];
    for (const eventEntry of eventsRaw) {
      if (!Array.isArray(eventEntry) || eventEntry.length === 0) continue;
      events.push(parseReplayEvent(eventEntry, frameIndex - 2, timeSec));
    }
    frameEventOffsets.push(eventOffset);
    frameEventCounts.push(events.length - eventOffset);

    const stateOffset = stateValues.length / 7;
    for (let stateIndex = 2; stateIndex < frameRaw.length; stateIndex++) {
      const stateRaw = frameRaw[stateIndex];
      if (!Array.isArray(stateRaw) || stateRaw.length === 0) continue;
      const id = toInt(stateRaw[0], 0);
      if (id <= 0) continue;
      ensureUnit(id);
      stateValues.push(
        id,
        toNumber(stateRaw[1], 0),
        toNumber(stateRaw[2], 0),
        toNumber(stateRaw[3], 0),
        toNumber(stateRaw[4], 0),
        stateRaw.length > 5 ? toNumber(stateRaw[5], 0) : 0,
        stateRaw.length > 6 ? toNumber(stateRaw[6], 0) : 0
      );
    }
    frameStateOffsets.push(stateOffset);
    frameStateCounts.push(stateValues.length / 7 - stateOffset);
  }

  const units = Array.from(unitsById.values()).sort((a, b) => a.id - b.id);

  return {
    replayName,
    archive,
    source,
    header: {
      mapKey,
      missionName,
      recordedAt,
      missionDateParts,
      stepSec,
      initialMarkers,
    },
    units,
    frameTimes: Uint32Array.from(frameTimes),
    frameStateOffsets: Uint32Array.from(frameStateOffsets),
    frameStateCounts: Uint32Array.from(frameStateCounts),
    stateStride: 7,
    stateData: Float32Array.from(stateValues),
    frameEventOffsets: Uint32Array.from(frameEventOffsets),
    frameEventCounts: Uint32Array.from(frameEventCounts),
    events,
  };
}

async function handleLoadReplayList(filters: string[] | undefined, proxyUrl?: string) {
  const listFilters = filters && filters.length > 0 ? filters : DEFAULT_FILTERS;
  progress("fetch_list", "Fetching replay list");
  const listUrl = buildListUrl(listFilters);
  const { json, source } = await fetchJsonWithFallback(listUrl, proxyUrl);
  const rows = parseReplayListPayload(json);
  post({
    type: "replay_list_loaded",
    rows,
    source,
  });
}

async function handleLoadReplayDetail(replayName: string, archive: number | undefined, proxyUrl?: string) {
  progress("fetch_replay", `Fetching replay ${replayName}`);
  const replayUrl = buildReplayDetailUrl(replayName, archive ?? 1);
  const { json, source } = await fetchJsonWithFallback(replayUrl, proxyUrl);
  progress("parse_replay", "Parsing replay timeline");
  const replay = parseReplayPayload(replayName, archive ?? 1, source, json);
  post(
    {
      type: "replay_parsed",
      replay,
    },
    [
      replay.frameTimes.buffer,
      replay.frameStateOffsets.buffer,
      replay.frameStateCounts.buffer,
      replay.stateData.buffer,
      replay.frameEventOffsets.buffer,
      replay.frameEventCounts.buffer,
    ]
  );
}

self.onmessage = async (event: MessageEvent<ReplayWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === "load_replay_list") {
      await handleLoadReplayList(msg.filters, msg.proxyUrl);
      return;
    }

    if (msg.type === "load_replay_detail") {
      await handleLoadReplayDetail(msg.replayName, msg.archive, msg.proxyUrl);
      return;
    }
  } catch (err: unknown) {
    post({ type: "error", message: normalizeError(err) });
  }
};

export {};
