import * as THREE from "three";
import { FlyCamera } from "./fly-camera";
import { createTerrain, createWater, applySatelliteTexture, type TerrainData } from "./terrain";
import { createObjects } from "./objects";
import { mapDirDegToWorldYawRad, mapToWorldX, worldToMapX } from "./map-coords";
import { PlanMode, type MarkColor } from "./plan-mode";
import type {
  MapWorkerResponse,
  WorkerMapLoadedMessage,
  WorkerProgressMessage,
  WorkerSatelliteReadyMessage,
  WorkerTerrainData,
  WorkerObjectsData,
  MissionDetails,
  MissionMarkerDef,
  MissionObjectDef,
  ReplayData,
  ReplayListItem,
  ReplayTimelineEvent,
  ReplayWorkerResponse,
} from "./workers/types";

// --- Three.js Setup ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x87ceeb);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x87ceeb, 5000, 30000);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 1, 100000);
(window as any).__camera = camera;
camera.position.set(0, 500, 0);

const flyCamera = new FlyCamera(camera, renderer.domElement);

const ambientLight = new THREE.AmbientLight(0x606080, 1.5);
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xffeedd, 2.0);
sunLight.position.set(1, 0.8, 0.6).normalize().multiplyScalar(10000);
scene.add(sunLight);

const gridHelper = new THREE.GridHelper(10000, 100, 0x444444, 0x333333);
scene.add(gridHelper);

const hudEl = document.getElementById("hud")!;
const statusEl = document.getElementById("status")!;

function setStatus(text: string) {
  statusEl.textContent = text;
}

// --- Worker ---
const loaderWorker = new Worker(new URL("./workers/map-loader.worker.ts", import.meta.url), {
  type: "module",
});
const replayWorker = new Worker(new URL("./workers/replay-loader.worker.ts", import.meta.url), {
  type: "module",
});

// --- Plan Mode ---
const planMode = new PlanMode(scene, camera, renderer);
(window as any).__planMode = planMode;
const planToggle = document.getElementById("plan-toggle")!;
const planPanel = document.getElementById("plan-panel")!;
const planStatus = document.getElementById("plan-status")!;
const markListEl = document.getElementById("plan-mark-list")!;

const MARK_COLOR_CSS: Record<MarkColor, string> = {
  R: "#ff4444",
  G: "#44ff44",
  B: "#4488ff",
};

const markTextInput = document.getElementById("mark-text") as HTMLInputElement;
const markInputRow = document.querySelector(".plan-input-row") as HTMLElement;

function updatePlanUI() {
  markListEl.innerHTML = "";
  for (const mark of planMode.marks) {
    const item = document.createElement("div");
    item.className = "mark-item";
    item.style.borderLeftColor = MARK_COLOR_CSS[mark.color];

    const label = document.createElement("span");
    label.className = "mark-label";
    const pos = mark.worldPos;
    label.textContent = `${mark.text} (${pos.x.toFixed(0)}, ${pos.z.toFixed(0)})`;
    label.title = `${mark.text} в ${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)}`;
    item.appendChild(label);

    const moveBtn = document.createElement("button");
    moveBtn.textContent = "Перем.";
    moveBtn.addEventListener("click", () => {
      planMode.startMove(mark.id);
      updatePlanStatus();
    });
    item.appendChild(moveBtn);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-del";
    delBtn.textContent = "Удал.";
    delBtn.addEventListener("click", () => {
      planMode.removeMark(mark.id);
    });
    item.appendChild(delBtn);

    markListEl.appendChild(item);
  }

  for (const line of planMode.lines) {
    const item = document.createElement("div");
    item.className = "mark-item";
    item.style.borderLeftColor = MARK_COLOR_CSS[line.color];

    const label = document.createElement("span");
    label.className = "mark-label";
    const s = line.start;
    const e = line.end;
    const dist = Math.sqrt((e.x - s.x) ** 2 + (e.z - s.z) ** 2);
    const typeLabel = line.lineType === "straight" ? "Прямая" : "По земле";
    label.textContent = `${typeLabel} (${dist.toFixed(0)}m)`;
    label.title = `${s.x.toFixed(0)},${s.z.toFixed(0)} -> ${e.x.toFixed(0)},${e.z.toFixed(0)}`;
    item.appendChild(label);

    const delBtn = document.createElement("button");
    delBtn.className = "btn-del";
    delBtn.textContent = "Удал.";
    delBtn.addEventListener("click", () => {
      planMode.removeLine(line.id);
    });
    item.appendChild(delBtn);

    markListEl.appendChild(item);
  }

  updatePlanStatus();
}

function updatePlanStatus() {
  if (planMode.hasPending()) {
    planStatus.textContent = "Введите имя метки и нажмите Enter (Esc - отмена)";
    markInputRow.style.display = "flex";
    markTextInput.focus();
  } else if (planMode.isMoving()) {
    const movingMark = planMode.marks.find((m) => m.id === planMode.getMovingId());
    planStatus.textContent = `Кликните по земле, чтобы переместить "${movingMark?.text}"`;
    markInputRow.style.display = "none";
  } else {
    planStatus.textContent = "Двойной клик: метка | Клик+перетаскивание: линия";
    markInputRow.style.display = "none";
  }
}

planMode.onMarksChanged = updatePlanUI;
planMode.onPendingChanged = () => updatePlanStatus();

markTextInput.addEventListener("keydown", (e) => {
  if (e.code === "Enter") {
    e.preventDefault();
    const text = markTextInput.value.trim();
    if (text && planMode.hasPending()) {
      planMode.confirmPending(text);
      markTextInput.value = "";
    }
  }
  if (e.code === "Escape") {
    planMode.cancelPending();
    markTextInput.value = "";
  }
});

function togglePlanMode() {
  planMode.toggle();
  planToggle.classList.toggle("active", planMode.active);
  planPanel.style.display = planMode.active ? "block" : "none";
  if (planMode.active && document.pointerLockElement) {
    document.exitPointerLock();
  }
  updatePlanUI();
}

planToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  togglePlanMode();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "KeyP" && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement)) {
    togglePlanMode();
  }
  if (e.code === "Space" && replayReady && !(e.target instanceof HTMLInputElement)) {
    e.preventDefault();
    replayPlaying = !replayPlaying;
    updateReplayPanels();
  }
  if (e.code === "Escape" && planMode.active && !planMode.hasPending() && planMode.isMoving()) {
    planMode.cancelMove();
    updatePlanUI();
  }
});

// --- Minimap ---
const minimapCanvas = document.getElementById("minimap") as HTMLCanvasElement;
const minimapCtx = minimapCanvas.getContext("2d")!;
let minimapImage: CanvasImageSource | null = null;
let currentMapSize = 0;

// --- Map State ---
let currentTerrain: THREE.Group | null = null;
let currentWater: THREE.Mesh | null = null;
let currentObjects: THREE.Group | null = null;
let currentMapName: string | null = null;
let isLoading = false;

const pendingAutoMap = new URLSearchParams(window.location.search).get("map")?.toLowerCase() ?? null;
const legacyPboParam = new URLSearchParams(window.location.search).get("pbo");
const legacyWrpParam = new URLSearchParams(window.location.search).get("wrp");

if (legacyPboParam || legacyWrpParam) {
  setStatus("Старые ссылки ?pbo= и ?wrp= не поддерживаются в статическом режиме. Используйте ?map=<name> и выберите папку.");
}

interface MapFileEntry {
  id: string;
  mapName: string;
  file: File;
  relativePath: string;
}

let mapFiles: MapFileEntry[] = [];
let currentTerrainInfo: {
  elevations: Float32Array;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  mapSize: number;
} | null = null;

const MAP_FOLDER_DB_NAME = "arma3-map-viewer";
const MAP_FOLDER_STORE_NAME = "settings";
const MAP_FOLDER_HANDLE_KEY = "last-map-folder-handle";
const supportsPersistentFolderAccess =
  typeof window !== "undefined" && "showDirectoryPicker" in window && "indexedDB" in window;
let hasStoredMapFolderHandle = false;

function openMapFolderDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MAP_FOLDER_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MAP_FOLDER_STORE_NAME)) {
        db.createObjectStore(MAP_FOLDER_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Не удалось открыть БД дескрипторов папок"));
  });
}

async function loadStoredMapFolderHandle(): Promise<any | null> {
  if (!supportsPersistentFolderAccess) return null;
  const db = await openMapFolderDb();
  try {
    return await new Promise<any | null>((resolve, reject) => {
      const tx = db.transaction(MAP_FOLDER_STORE_NAME, "readonly");
      const req = tx.objectStore(MAP_FOLDER_STORE_NAME).get(MAP_FOLDER_HANDLE_KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error ?? new Error("Не удалось прочитать сохраненный дескриптор папки"));
    });
  } finally {
    db.close();
  }
}

async function saveStoredMapFolderHandle(handle: any): Promise<void> {
  if (!supportsPersistentFolderAccess) return;
  const db = await openMapFolderDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MAP_FOLDER_STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Не удалось сохранить дескриптор папки"));
      tx.objectStore(MAP_FOLDER_STORE_NAME).put(handle, MAP_FOLDER_HANDLE_KEY);
    });
  } finally {
    db.close();
  }
}

async function ensureMapFolderPermission(handle: any, requestPrompt: boolean): Promise<boolean> {
  const queryPermission = handle?.queryPermission;
  const requestPermission = handle?.requestPermission;
  if (typeof queryPermission === "function") {
    const state = await queryPermission.call(handle, { mode: "read" });
    if (state === "granted") return true;
    if (!requestPrompt) return false;
  }
  if (!requestPrompt || typeof requestPermission !== "function") return false;
  const state = await requestPermission.call(handle, { mode: "read" });
  return state === "granted";
}

type MapFolderEntry = { file: File; relativePath: string };

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

async function listDirectoryEntries(
  dirHandle: any
): Promise<Array<{ name: string; entry: any }>> {
  const items: Array<{ name: string; entry: any }> = [];
  for await (const [name, entry] of dirHandle.entries()) {
    items.push({ name, entry });
  }
  return items;
}

async function collectMapEntriesRecursively(
  dirHandle: any,
  pathPrefix = "",
  maxDepth = 48
): Promise<MapFolderEntry[]> {
  if (maxDepth < 0) return [];
  const found: MapFolderEntry[] = [];
  for await (const [name, entry] of dirHandle.entries()) {
    const relPath = pathPrefix ? `${pathPrefix}/${name}` : name;
    if (entry.kind === "directory") {
      if (maxDepth === 0) continue;
      const nested = await collectMapEntriesRecursively(entry, relPath, maxDepth - 1);
      found.push(...nested);
      continue;
    }
    if (entry.kind !== "file" || !/\.(pbo|wrp)$/i.test(name)) {
      continue;
    }
    const file = await entry.getFile();
    found.push({ file, relativePath: relPath });
  }
  return found;
}

async function collectMapEntriesFromAddonsDirectory(
  addonsHandle: any,
  addonsPath: string
): Promise<MapFolderEntry[]> {
  // Addons folders are where map pbos live; keep recursion shallow to avoid unrelated trees.
  return collectMapEntriesRecursively(addonsHandle, addonsPath, 4);
}

async function collectMapEntriesFromSelectedFolder(rootHandle: any): Promise<MapFolderEntry[]> {
  const rootEntries = await listDirectoryEntries(rootHandle);
  const rootName = normalizeName(String(rootHandle?.name || ""));
  const addonsScanTargets: Array<{ handle: any; path: string }> = [];
  const directMapFiles: MapFolderEntry[] = [];

  if (rootName === "addons") {
    addonsScanTargets.push({ handle: rootHandle, path: "" });
  }

  for (const item of rootEntries) {
    if (item.entry.kind === "file" && /\.(pbo|wrp)$/i.test(item.name)) {
      const file = await item.entry.getFile();
      directMapFiles.push({ file, relativePath: item.name });
      continue;
    }
    if (item.entry.kind !== "directory") continue;

    const lower = normalizeName(item.name);
    if (lower === "addons") {
      addonsScanTargets.push({ handle: item.entry, path: item.name });
      continue;
    }

    if (lower === "expansion") {
      const expEntries = await listDirectoryEntries(item.entry);
      const expAddons = expEntries.find((e) => e.entry.kind === "directory" && normalizeName(e.name) === "addons");
      if (expAddons) {
        addonsScanTargets.push({
          handle: expAddons.entry,
          path: `${item.name}/${expAddons.name}`,
        });
      }
      continue;
    }

    if (item.name.startsWith("@")) {
      const modEntries = await listDirectoryEntries(item.entry);
      const modAddons = modEntries.find((e) => e.entry.kind === "directory" && normalizeName(e.name) === "addons");
      if (modAddons) {
        addonsScanTargets.push({
          handle: modAddons.entry,
          path: `${item.name}/${modAddons.name}`,
        });
      }
      continue;
    }

    if (lower === "!workshop") {
      const workshopMods = await listDirectoryEntries(item.entry);
      for (const mod of workshopMods) {
        if (mod.entry.kind !== "directory") continue;
        const modEntries = await listDirectoryEntries(mod.entry);
        const modAddons = modEntries.find((e) => e.entry.kind === "directory" && normalizeName(e.name) === "addons");
        if (!modAddons) continue;
        addonsScanTargets.push({
          handle: modAddons.entry,
          path: `${item.name}/${mod.name}/${modAddons.name}`,
        });
      }
    }
  }

  const found = [...directMapFiles];
  if (addonsScanTargets.length > 0) {
    for (const target of addonsScanTargets) {
      const entries = await collectMapEntriesFromAddonsDirectory(target.handle, target.path);
      found.push(...entries);
    }
  } else {
    // Non-standard folder layout: fallback to recursive scan for compatibility.
    const recursive = await collectMapEntriesRecursively(rootHandle, "", 48);
    found.push(...recursive);
  }

  const dedup = new Map<string, MapFolderEntry>();
  for (const item of found) {
    if (!dedup.has(item.relativePath)) {
      dedup.set(item.relativePath, item);
    }
  }
  return Array.from(dedup.values());
}

async function collectMapEntriesFromDirectory(
  dirHandle: any,
  pathPrefix = ""
): Promise<Array<{ file: File; relativePath: string }>> {
  if (pathPrefix) {
    return collectMapEntriesRecursively(dirHandle, pathPrefix, 48);
  }
  return collectMapEntriesFromSelectedFolder(dirHandle);
}

// --- Replay State ---
interface ReplayRowEntry {
  id: string;
  row: ReplayListItem;
}

interface RuntimeUnitState {
  id: number;
  x: number;
  y: number;
  z: number;
  dir: number;
  stateFlag: number;
  vehicleRef: number;
  prevTimeSec: number;
  currTimeSec: number;
  prevX: number;
  prevY: number;
  prevZ: number;
  prevDir: number;
}

interface RuntimeUnitVisual {
  id: number;
  name: string;
  side: number;
  unitType: string;
  state: RuntimeUnitState;
  mesh: THREE.Mesh;
  labelEl: HTMLDivElement;
}

interface ReplayLine {
  line: THREE.Line;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  ttl: number;
  kind: "kill" | "hit";
}

type ReplayBoardTab = "kills" | "events";

interface MissionMarkerRender {
  marker: MissionMarkerDef;
  worldX: number;
  worldZ: number;
  color: string;
}

let replayRows: ReplayRowEntry[] = [];
let replayVisibleRows: ReplayRowEntry[] = [];
let replayData: ReplayData | null = null;
let replayUnitsById = new Map<number, ReplayData["units"][number]>();
let replayIsLoading = false;
let replayReady = false;
let replayPlaying = false;
let replayCurrentFrame = 0;
let replayCurrentTimeSec = 0;
let replayLastAppliedFrame = -1;
let replayPendingStart = false;
let replayWaitingForMap = false;
let replayLastAutoReplayParam: string | null = null;
let replayEventFilter = {
  messages: true,
  kills: true,
  hits: true,
  medical: true,
};
let replayEventboardLastSignature = "";
let replayEventboardManualScrollWhilePaused = false;
let replayEventboardProgrammaticScroll = false;
let selectedReplayRow: ReplayListItem | null = null;
let missionDetails: MissionDetails | null = null;
let missionIsLoading = false;
let missionMarkersRender: MissionMarkerRender[] = [];

const replayRuntimeStates = new Map<number, RuntimeUnitState>();
const replayVisuals = new Map<number, RuntimeUnitVisual>();
const replayGroup = new THREE.Group();
scene.add(replayGroup);
const replayLines: ReplayLine[] = [];
const missionGroup = new THREE.Group();
scene.add(missionGroup);

const SIDE_COLORS: Record<number, number> = {
  0: 0x3a8fff,
  1: 0xff4a4a,
  2: 0x45d36f,
  3: 0xd08cff,
  4: 0xb0b0b0,
  5: 0x444444,
};
const REPLAY_SPEED_MULTIPLIER = 2;

const pendingAutoReplay = new URLSearchParams(window.location.search).get("replay");
const pendingAutoReplayArchive = new URLSearchParams(window.location.search).get("archive");
const DEPLOY_REPLAY_PROXY_URL =
  typeof (import.meta as { env?: Record<string, unknown> }).env?.VITE_REPLAY_PROXY_URL === "string"
    ? String((import.meta as { env?: Record<string, unknown> }).env?.VITE_REPLAY_PROXY_URL).trim()
    : "";

const replayProxyInput = document.getElementById("replay-proxy") as HTMLInputElement;
const replayProxyRow = document.getElementById("replay-proxy-row") as HTMLElement;
const replayServerFilter = document.getElementById("replay-server-filter") as HTMLSelectElement;
const btnFetchReplays = document.getElementById("btn-fetch-replays") as HTMLButtonElement;
const replaySelect = document.getElementById("replay-select") as HTMLSelectElement;
const btnLoadReplay = document.getElementById("btn-load-replay") as HTMLButtonElement;
const btnLoadMission = document.getElementById("btn-load-mission") as HTMLButtonElement;
const btnToggleMissionManual = document.getElementById("btn-toggle-mission-manual") as HTMLButtonElement;
const manualMissionPanel = document.getElementById("manual-mission-panel") as HTMLElement;
const missionUrlInput = document.getElementById("mission-url") as HTMLInputElement;
const btnLoadMissionUrl = document.getElementById("btn-load-mission-url") as HTMLButtonElement;
const missionShowMarkersInput = document.getElementById("mission-show-markers") as HTMLInputElement;
const missionShowObjectsInput = document.getElementById("mission-show-objects") as HTMLInputElement;
const replayStatusEl = document.getElementById("replay-status") as HTMLElement;
const missionStatusEl = document.getElementById("mission-status") as HTMLElement;
const replayMetaEl = document.getElementById("replay-meta") as HTMLElement;
const replayPanel = document.getElementById("replay-panel") as HTMLElement;
const replayPlayBtn = document.getElementById("btn-replay-play") as HTMLButtonElement;
const replayPauseBtn = document.getElementById("btn-replay-pause") as HTMLButtonElement;
const replaySeekInput = document.getElementById("replay-seek") as HTMLInputElement;
const replaySpeedSelect = document.getElementById("replay-speed") as HTMLSelectElement;
const replayTimeEl = document.getElementById("replay-time") as HTMLElement;
const replayShowDeadInput = document.getElementById("replay-show-dead") as HTMLInputElement;
const replayBoardKillsBtn = document.getElementById("btn-board-kills") as HTMLButtonElement;
const replayBoardEventsBtn = document.getElementById("btn-board-events") as HTMLButtonElement;
const replayBoardKillsPane = document.getElementById("replay-board-kills") as HTMLElement;
const replayBoardEventsPane = document.getElementById("replay-board-events") as HTMLElement;
const replayKillboardEl = document.getElementById("replay-killboard") as HTMLElement;
const replayEventboardEl = document.getElementById("replay-eventboard") as HTMLElement;
const replayFilterMessages = document.getElementById("replay-filter-messages") as HTMLInputElement;
const replayFilterKills = document.getElementById("replay-filter-kills") as HTMLInputElement;
const replayFilterHits = document.getElementById("replay-filter-hits") as HTMLInputElement;
const replayFilterMedical = document.getElementById("replay-filter-medical") as HTMLInputElement;
const replayLabelLayer = document.getElementById("replay-label-layer") as HTMLElement;
let replayBoardTab: ReplayBoardTab = localStorage.getItem("replay_board_tab") === "events" ? "events" : "kills";

replayProxyInput.value = localStorage.getItem("replay_proxy_url") || DEPLOY_REPLAY_PROXY_URL;
replaySpeedSelect.value = localStorage.getItem("replay_speed") || "1";
replayShowDeadInput.checked = localStorage.getItem("replay_show_dead") === "1";
missionShowMarkersInput.checked = localStorage.getItem("mission_show_markers") !== "0";
missionShowObjectsInput.checked = localStorage.getItem("mission_show_objects") !== "0";
missionUrlInput.value = localStorage.getItem("mission_manual_url") || "";
btnLoadMission.disabled = true;
if (replayProxyInput.value.trim()) {
  replayProxyRow.style.display = "none";
}

function setMissionManualPanelOpen(open: boolean) {
  manualMissionPanel.style.display = open ? "block" : "none";
  btnToggleMissionManual.textContent = open ? "Скрыть ручной ввод миссии" : "Хочу ввести миссию вручную";
}

setMissionManualPanelOpen(localStorage.getItem("mission_manual_panel_open") === "1");

function setReplayBoardTab(tab: ReplayBoardTab) {
  replayBoardTab = tab;
  replayBoardKillsBtn.classList.toggle("active", tab === "kills");
  replayBoardEventsBtn.classList.toggle("active", tab === "events");
  replayBoardKillsPane.classList.toggle("active", tab === "kills");
  replayBoardEventsPane.classList.toggle("active", tab === "events");
  localStorage.setItem("replay_board_tab", tab);
}

setReplayBoardTab(replayBoardTab);

function extractMapName(name: string): string {
  const file = name.split("/").pop()?.split("\\").pop() ?? name;
  return file.replace(/\.(pbo|wrp)$/i, "");
}

function updateUrlMapParam(mapName: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("map", mapName);
  url.searchParams.delete("pbo");
  url.searchParams.delete("wrp");
  history.replaceState(null, "", url);
}

function updateUrlReplayParams(replayName: string, archive?: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("replay", replayName);
  if (typeof archive === "number" && archive > 0) {
    url.searchParams.set("archive", String(archive));
  } else {
    url.searchParams.delete("archive");
  }
  history.replaceState(null, "", url);
}

function setReplayStatus(text: string) {
  replayStatusEl.textContent = text;
}

function setMissionStatus(text: string) {
  missionStatusEl.textContent = text;
}

function setMissionLoading(loading: boolean) {
  missionIsLoading = loading;
  btnLoadMission.disabled = loading || !replayData;
  btnLoadMissionUrl.disabled = loading;
}

function replaySourceLabel(source: string): string {
  if (source === "direct") return "напрямую";
  if (source === "proxy") return "через прокси";
  return source;
}

function replayProgressStageLabel(stage: string): string {
  if (stage === "fetch_list") return "получение списка";
  if (stage === "fetch_replay") return "получение реплея";
  if (stage === "parse_replay") return "разбор реплея";
  if (stage === "fetch_mission") return "загрузка миссии";
  if (stage === "parse_mission") return "разбор миссии";
  return stage;
}

function getReplayProxyUrl(): string | undefined {
  const value = replayProxyInput.value.trim();
  if (!value) {
    localStorage.removeItem("replay_proxy_url");
    return DEPLOY_REPLAY_PROXY_URL || undefined;
  }
  localStorage.setItem("replay_proxy_url", value);
  return value;
}

function normalizeMapToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(cup_|cwr3_|gm_|rhspk_|rhs_|uk3cb_|gm_)/, "")
    .replace(/_summer|_winter|_old|_s$/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function missionMarkerColorCss(colorName: string): string {
  const key = colorName.toLowerCase();
  if (key.includes("blue")) return "#6db8ff";
  if (key.includes("green")) return "#7de28c";
  if (key.includes("red")) return "#ff7373";
  if (key.includes("orange")) return "#ffb86a";
  if (key.includes("yellow")) return "#ffd166";
  if (key.includes("black")) return "#7f8a96";
  return "#cccccc";
}

function missionMarkerColorHex(colorName: string): number {
  const css = missionMarkerColorCss(colorName).replace("#", "");
  return Number.parseInt(css, 16) || 0xcccccc;
}

function replayMapCandidates(data: ReplayData): string[] {
  const fromHeader = data.header.mapKey || "";
  const fromName = data.replayName.includes(".")
    ? data.replayName.slice(data.replayName.lastIndexOf(".") + 1)
    : "";
  const set = new Set<string>();
  for (const item of [fromHeader, fromName]) {
    if (!item) continue;
    set.add(item.toLowerCase());
    set.add(item.replace(/_/g, "").toLowerCase());
    set.add(normalizeMapToken(item));
  }
  return Array.from(set).filter((item) => item.length > 0);
}

function mapEntryTokens(entry: MapFileEntry): string[] {
  const fromName = entry.mapName;
  const fromPath = extractMapName(entry.relativePath);
  const set = new Set<string>();
  for (const item of [fromName, fromPath]) {
    set.add(item.toLowerCase());
    set.add(item.replace(/_/g, "").toLowerCase());
    set.add(normalizeMapToken(item));
  }
  return Array.from(set).filter((item) => item.length > 0);
}

function findReplayMapMatches(data: ReplayData): MapFileEntry[] {
  const candidates = replayMapCandidates(data);
  const exactMatches: MapFileEntry[] = [];
  const fuzzyMatches: MapFileEntry[] = [];

  for (const entry of mapFiles) {
    const tokens = mapEntryTokens(entry);
    const isExact = candidates.some((candidate) => tokens.includes(candidate));
    if (isExact) {
      exactMatches.push(entry);
      continue;
    }
    const isFuzzy = candidates.some((candidate) =>
      tokens.some((token) => token.includes(candidate) || candidate.includes(token))
    );
    if (isFuzzy) fuzzyMatches.push(entry);
  }

  if (exactMatches.length > 0) return exactMatches;
  return fuzzyMatches;
}

function formatReplayTime(timeSec: number): string {
  const clamped = Math.max(0, Math.floor(timeSec));
  const h = String(Math.floor(clamped / 3600)).padStart(2, "0");
  const m = String(Math.floor((clamped % 3600) / 60)).padStart(2, "0");
  const s = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function unitSideCss(side: number): string {
  if (side === 0) return "west";
  if (side === 1) return "east";
  if (side === 2) return "guer";
  if (side === 3) return "civ";
  return "unknown";
}

function mapXToWorldX(mapX: number): number {
  if (!currentMapSize) return mapX;
  return mapToWorldX(mapX, currentMapSize);
}

function clearCurrentMap() {
  minimapImage = null;
  if (currentTerrain) scene.remove(currentTerrain);
  if (currentWater) scene.remove(currentWater);
  if (currentObjects) scene.remove(currentObjects);
  clearMissionOverlay();
  currentTerrainInfo = null;
  scene.remove(gridHelper);
}

function applyLoadedMap(
  mapName: string,
  terrainData: WorkerTerrainData,
  objectsData: WorkerObjectsData,
  satelliteTiles: number
) {
  clearCurrentMap();
  if (replayData) {
    replayReady = false;
    clearReplayRuntime();
  }

  const terrainInput: TerrainData = {
    gridWidth: terrainData.gridWidth,
    gridHeight: terrainData.gridHeight,
    cellSize: terrainData.cellSize,
    mapSize: terrainData.mapSize,
    elevationMin: terrainData.elevationMin,
    elevationMax: terrainData.elevationMax,
    elevations: terrainData.elevations,
  };

  currentTerrain = createTerrain(terrainInput);
  scene.add(currentTerrain);
  planMode.setTerrain(currentTerrain);

  currentWater = createWater(terrainData.mapSize);
  scene.add(currentWater);
  currentMapSize = terrainData.mapSize;

  const terrainInfoData = {
    elevations: terrainData.elevations,
    gridWidth: terrainData.gridWidth,
    gridHeight: terrainData.gridHeight,
    cellSize: terrainData.cellSize,
    mapSize: terrainData.mapSize,
  };
  flyCamera.terrain = terrainInfoData;
  currentTerrainInfo = terrainInfoData;
  planMode.setTerrainInfo(terrainInfoData);

  const centerX = terrainData.mapSize / 2;
  const centerZ = terrainData.mapSize / 2;
  const centerIdx =
    Math.floor(terrainData.gridHeight / 2) * terrainData.gridWidth + Math.floor(terrainData.gridWidth / 2);
  const centerElev = terrainData.elevations[centerIdx] || 100;
  camera.position.set(centerX, centerElev + 500, centerZ);

  currentObjects = createObjects(objectsData, terrainData.mapSize);
  scene.add(currentObjects);

  currentMapName = mapName;
  renderMissionOverlay();
  minimapCanvas.style.display = "block";
  updateUrlMapParam(mapName);

  setStatus(
    [
      `Загружена карта: ${mapName}`,
      `Рельеф: ${terrainData.gridWidth}x${terrainData.gridHeight}, шаг ${terrainData.cellSize.toFixed(2)}м`,
      `Высоты: ${terrainData.elevationMin.toFixed(1)}..${terrainData.elevationMax.toFixed(1)}м`,
      `Объекты: ${objectsData.nObjects}`,
      satelliteTiles > 0
        ? `Спутниковые тайлы: ${satelliteTiles} (генерация текстуры...)`
        : "В этой карте нет спутниковых тайлов",
    ].join("\n")
  );
}

function mapProgressStageLabel(stage: WorkerProgressMessage["stage"]): string {
  const labels: Record<WorkerProgressMessage["stage"], string> = {
    read: "чтение",
    parse_pbo: "разбор PBO",
    parse_wrp: "разбор WRP",
    prepare_terrain: "подготовка рельефа",
    prepare_objects: "подготовка объектов",
    satellite: "спутниковая текстура",
    done: "готово",
  };
  return labels[stage] || stage;
}

function handleWorkerProgress(msg: WorkerProgressMessage) {
  const progressText =
    typeof msg.completed === "number" && typeof msg.total === "number"
      ? ` (${msg.completed}/${msg.total})`
      : "";
  setStatus(
    `Загрузка ${msg.mapName}: ${mapProgressStageLabel(msg.stage)}${progressText}${msg.detail ? `\n${msg.detail}` : ""}`
  );
}

function handleSatelliteReady(msg: WorkerSatelliteReadyMessage) {
  if (!currentTerrain || !currentMapName || msg.mapName !== currentMapName) return;

  const rgba = new Uint8ClampedArray(msg.rgba);
  const canvas = document.createElement("canvas");
  canvas.width = msg.width;
  canvas.height = msg.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(rgba, msg.width, msg.height), 0, 0);

  minimapImage = canvas;

  const texture = new THREE.CanvasTexture(canvas);
  applySatelliteTexture(currentTerrain, texture);

  setStatus(`${statusEl.textContent}\nСпутниковая текстура применена (${msg.width}x${msg.height}).`);
}

function sampleTerrainHeight(x: number, z: number): number {
  if (!currentTerrainInfo || currentTerrainInfo.gridWidth < 2 || currentTerrainInfo.gridHeight < 2) {
    return 0;
  }
  const mapX = worldToMapX(x, currentTerrainInfo.mapSize);
  const gx = mapX / currentTerrainInfo.cellSize;
  const gz = z / currentTerrainInfo.cellSize;

  const x0 = Math.max(0, Math.min(currentTerrainInfo.gridWidth - 1, Math.floor(gx)));
  const z0 = Math.max(0, Math.min(currentTerrainInfo.gridHeight - 1, Math.floor(gz)));
  const x1 = Math.max(0, Math.min(currentTerrainInfo.gridWidth - 1, x0 + 1));
  const z1 = Math.max(0, Math.min(currentTerrainInfo.gridHeight - 1, z0 + 1));
  const tx = gx - x0;
  const tz = gz - z0;

  const idx00 = z0 * currentTerrainInfo.gridWidth + x0;
  const idx10 = z0 * currentTerrainInfo.gridWidth + x1;
  const idx01 = z1 * currentTerrainInfo.gridWidth + x0;
  const idx11 = z1 * currentTerrainInfo.gridWidth + x1;

  const h00 = currentTerrainInfo.elevations[idx00] ?? 0;
  const h10 = currentTerrainInfo.elevations[idx10] ?? h00;
  const h01 = currentTerrainInfo.elevations[idx01] ?? h00;
  const h11 = currentTerrainInfo.elevations[idx11] ?? h00;

  const hx0 = h00 + (h10 - h00) * tx;
  const hx1 = h01 + (h11 - h01) * tx;
  return hx0 + (hx1 - hx0) * tz;
}

function disposeGroupChildren(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[group.children.length - 1];
    group.remove(child);
    child.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else if (material) {
        material.dispose();
      }
    });
  }
}

function clearMissionOverlay() {
  missionMarkersRender = [];
  disposeGroupChildren(missionGroup);
}

function missionMapMatchesCurrentMap(): boolean {
  if (!missionDetails || !currentMapName) return false;
  const currentToken = normalizeMapToken(currentMapName);
  const missionToken = normalizeMapToken(missionDetails.mapKey || "");
  if (!currentToken) return false;
  if (!missionToken) return true;
  return missionToken === currentToken || missionToken.includes(currentToken) || currentToken.includes(missionToken);
}

function missionMarkerOpacity(marker: MissionMarkerDef): number {
  if (marker.alpha > 0) {
    return Math.max(0.08, Math.min(0.7, marker.alpha));
  }
  if (marker.drawBorder) return 0.45;
  return 0.22;
}

function buildMissionMarkerPoints(marker: MissionMarkerDef, worldX: number, worldZ: number, y: number): THREE.Vector3[] {
  const markerType = marker.markerType.toUpperCase();
  const a = Math.max(1, marker.a || 20);
  const b = Math.max(1, marker.b || a);
  const yaw = mapDirDegToWorldYawRad(marker.angleDeg || 0);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);

  const points: THREE.Vector3[] = [];
  if (markerType === "RECTANGLE") {
    const corners: Array<[number, number]> = [
      [-a, -b],
      [a, -b],
      [a, b],
      [-a, b],
      [-a, -b],
    ];
    for (const [dx, dz] of corners) {
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      points.push(new THREE.Vector3(worldX + rx, y, worldZ + rz));
    }
    return points;
  }

  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const dx = Math.cos(t) * a;
    const dz = Math.sin(t) * b;
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    points.push(new THREE.Vector3(worldX + rx, y, worldZ + rz));
  }
  return points;
}

function renderMissionOverlay() {
  clearMissionOverlay();
  if (!missionDetails || !currentMapName) return;
  if (!missionMapMatchesCurrentMap()) {
    setMissionStatus(
      `Детали миссии загружены (${missionDetails.missionFile}), но карта не совпадает (${missionDetails.mapKey} != ${currentMapName}).`
    );
    return;
  }

  let renderedObjectsCount = 0;

  if (missionShowMarkersInput.checked) {
    for (const marker of missionDetails.markers) {
      const worldX = mapXToWorldX(marker.x);
      const worldZ = marker.z;
      const colorCss = missionMarkerColorCss(marker.colorName);
      const linePoints = buildMissionMarkerPoints(marker, worldX, worldZ, sampleTerrainHeight(worldX, worldZ) + 1.5);
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
      const lineMaterial = new THREE.LineBasicMaterial({
        color: missionMarkerColorHex(marker.colorName),
        transparent: true,
        opacity: missionMarkerOpacity(marker),
      });
      const line = new THREE.Line(lineGeometry, lineMaterial);
      line.renderOrder = 1;
      missionGroup.add(line);
      missionMarkersRender.push({
        marker,
        worldX,
        worldZ,
        color: colorCss,
      });
    }
  }

  if (missionShowObjectsInput.checked && missionDetails.objects.length > 0) {
    const objectLimit = 30000;
    const count = Math.min(objectLimit, missionDetails.objects.length);
    renderedObjectsCount = count;
    const geometry = new THREE.BoxGeometry(1.4, 1.4, 2.8);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const tmp = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const obj = missionDetails.objects[i];
      tmp.position.set(mapXToWorldX(obj.x), obj.y + 0.7, obj.z);
      tmp.rotation.set(0, mapDirDegToWorldYawRad(obj.angleDeg), 0);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 1;
    missionGroup.add(mesh);
  }

  const objectRendered = missionShowObjectsInput.checked ? renderedObjectsCount : 0;
  const markerRendered = missionShowMarkersInput.checked ? missionDetails.markers.length : 0;
  const objectExtra =
    missionShowObjectsInput.checked && missionDetails.objects.length > renderedObjectsCount
      ? ` (показано ${renderedObjectsCount} из ${missionDetails.objects.length})`
      : "";
  setMissionStatus(
    `Детали миссии: маркеры ${markerRendered}, объекты ${objectRendered}${objectExtra}. Файл: ${missionDetails.missionFile} (${replaySourceLabel(missionDetails.source)}).`
  );
}

function clearReplayLines() {
  for (const line of replayLines) {
    replayGroup.remove(line.line);
    line.line.geometry.dispose();
    const material = line.line.material;
    if (material instanceof THREE.Material) material.dispose();
  }
  replayLines.length = 0;
}

function clearReplayVisuals() {
  clearReplayLines();
  for (const visual of replayVisuals.values()) {
    replayGroup.remove(visual.mesh);
    visual.mesh.geometry.dispose();
    const material = visual.mesh.material;
    if (material instanceof THREE.Material) material.dispose();
    visual.labelEl.remove();
  }
  replayVisuals.clear();
}

function clearReplayRuntime() {
  replayRuntimeStates.clear();
  clearReplayVisuals();
  replayCurrentFrame = 0;
  replayCurrentTimeSec = 0;
  replayLastAppliedFrame = -1;
  replayPlaying = false;
  replayEventboardLastSignature = "";
  replayEventboardManualScrollWhilePaused = false;
}

function sideColor(side: number): number {
  return SIDE_COLORS[side] ?? SIDE_COLORS[4];
}

function tintColorWithWhite(color: number, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const rr = Math.round(r + (255 - r) * t);
  const gg = Math.round(g + (255 - g) * t);
  const bb = Math.round(b + (255 - b) * t);
  return `#${rr.toString(16).padStart(2, "0")}${gg.toString(16).padStart(2, "0")}${bb.toString(16).padStart(2, "0")}`;
}

function stateIsDead(unitType: string, stateFlag: number): boolean {
  if (stateFlag === -1) return true;
  if (stateFlag >= 1) {
    if (unitType === "man") return true;
    return true;
  }
  return false;
}

function stateIsUnconscious(unitType: string, stateFlag: number): boolean {
  return unitType === "man" && stateFlag >= 2;
}

function ensureReplayVisual(id: number): RuntimeUnitVisual | null {
  const state = replayRuntimeStates.get(id);
  const unit = replayUnitsById.get(id);
  if (!state || !unit) return null;
  const existing = replayVisuals.get(id);
  if (existing) return existing;

  const isMan = unit.unitType === "man";
  const geometry = isMan
    ? (() => {
        const g = new THREE.ConeGeometry(3.08, 10.5, 3);
        g.rotateX(Math.PI / 2); // point along +Z so yaw=0 is north
        return g;
      })()
    : new THREE.SphereGeometry(8, 10, 10);
  const material = new THREE.MeshLambertMaterial({
    color: sideColor(unit.side),
    emissive: 0x202020,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false;
  mesh.renderOrder = 2;
  replayGroup.add(mesh);

  const labelEl = document.createElement("div");
  labelEl.className = `replay-label unit-side-${unitSideCss(unit.side)}`;
  labelEl.textContent = unit.playerName || unit.name || `#${id}`;
  labelEl.style.display = "none";
  replayLabelLayer.appendChild(labelEl);

  const visual: RuntimeUnitVisual = {
    id,
    name: unit.playerName || unit.name,
    side: unit.side,
    unitType: unit.unitType || "unknown",
    state,
    mesh,
    labelEl,
  };
  replayVisuals.set(id, visual);
  return visual;
}

function resolveInterpolatedState(state: RuntimeUnitState, nowSec: number) {
  const duration = state.currTimeSec - state.prevTimeSec;
  let alpha = 1;
  if (duration > 0.001) {
    alpha = Math.max(0, Math.min(1, (nowSec - state.prevTimeSec) / duration));
  }
  return {
    x: state.prevX + (state.x - state.prevX) * alpha,
    y: state.prevY + (state.y - state.prevY) * alpha,
    z: state.prevZ + (state.z - state.prevZ) * alpha,
    dir: state.prevDir + (state.dir - state.prevDir) * alpha,
  };
}

function resolveReplayWorldPosition(id: number, nowSec: number): { x: number; y: number; z: number; dirDeg: number } | null {
  const state = replayRuntimeStates.get(id);
  const unit = replayUnitsById.get(id);
  if (!state || !unit) return null;

  const base = resolveInterpolatedState(state, nowSec);
  let mapX = base.x;
  let mapZ = base.y;
  let alt = base.z;
  let dir = base.dir;

  if (unit.unitType === "man" && state.vehicleRef > 0) {
    const vehicleState = replayRuntimeStates.get(state.vehicleRef);
    if (vehicleState) {
      const vehicleBase = resolveInterpolatedState(vehicleState, nowSec);
      mapX = vehicleBase.x;
      mapZ = vehicleBase.y;
      alt = vehicleBase.z;
      dir = vehicleBase.dir;
    }
  }

  const worldX = mapXToWorldX(mapX);
  const terrainY = sampleTerrainHeight(worldX, mapZ);
  return {
    x: worldX,
    y: terrainY + Math.max(alt, 0) + 3,
    z: mapZ,
    dirDeg: dir,
  };
}

function updateReplayVisuals(nowSec: number) {
  if (!replayReady) return;
  const showDead = replayShowDeadInput.checked;
  for (const visual of replayVisuals.values()) {
    visual.mesh.visible = false;
    visual.labelEl.style.display = "none";
  }
  for (const [id, state] of replayRuntimeStates.entries()) {
    const visual = ensureReplayVisual(id);
    const unit = replayUnitsById.get(id);
    if (!visual || !unit) continue;
    const worldPos = resolveReplayWorldPosition(id, nowSec);
    if (!worldPos) {
      visual.labelEl.style.display = "none";
      continue;
    }

    const dead = stateIsDead(unit.unitType, state.stateFlag);
    const unconscious = stateIsUnconscious(unit.unitType, state.stateFlag);
    if (dead && !showDead) {
      visual.mesh.visible = false;
      visual.labelEl.style.display = "none";
      continue;
    }

    visual.mesh.visible = true;
    const meshY = unit.unitType === "man" ? worldPos.y + 2.625 : worldPos.y;
    visual.mesh.position.set(worldPos.x, meshY, worldPos.z);
    visual.mesh.rotation.set(0, mapDirDegToWorldYawRad(worldPos.dirDeg), 0);
    visual.labelEl.textContent = visual.name || `#${id}`;

    const material = visual.mesh.material as THREE.MeshLambertMaterial;
    if (dead) {
      material.color.setHex(0x555555);
      material.emissive.setHex(0x050505);
      material.opacity = 0.35;
    } else if (unconscious) {
      material.color.setHex(0xffd166);
      material.emissive.setHex(0x332200);
      material.opacity = 0.65;
    } else {
      material.color.setHex(sideColor(unit.side));
      material.emissive.setHex(0x202020);
      material.opacity = 0.95;
    }
    if (dead) {
      visual.labelEl.style.color = tintColorWithWhite(sideColor(unit.side), 0.78);
      visual.labelEl.style.opacity = "0.7";
    } else {
      visual.labelEl.style.color = "";
      visual.labelEl.style.opacity = "1";
    }

    const p = new THREE.Vector3(worldPos.x, worldPos.y + 16, worldPos.z).project(camera);
    if (p.z < -1 || p.z > 1) {
      visual.labelEl.style.display = "none";
      continue;
    }
    const sx = (p.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-p.y * 0.5 + 0.5) * window.innerHeight;
    if (sx < -80 || sx > window.innerWidth + 80 || sy < -30 || sy > window.innerHeight + 30) {
      visual.labelEl.style.display = "none";
      continue;
    }
    visual.labelEl.style.display = "block";
    visual.labelEl.style.left = `${sx}px`;
    visual.labelEl.style.top = `${sy}px`;
  }
}

function addReplayLine(
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  side: number,
  kind: "kill" | "hit",
  keep = false
) {
  const points = [new THREE.Vector3(from.x, from.y + 2, from.z), new THREE.Vector3(to.x, to.y + 2, to.z)];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: kind === "kill" ? sideColor(side) : 0xffffff,
    transparent: true,
    opacity: kind === "kill" ? 0.65 : 0.35,
  });
  const line = new THREE.Line(geometry, material);
  replayGroup.add(line);

  replayLines.push({
    line,
    fromX: from.x,
    fromZ: from.z,
    toX: to.x,
    toZ: to.z,
    ttl: keep ? Number.POSITIVE_INFINITY : kind === "kill" ? 8 : 2,
    kind,
  });
}

function updateReplayLines(dt: number) {
  for (let i = replayLines.length - 1; i >= 0; i--) {
    const line = replayLines[i];
    if (!Number.isFinite(line.ttl)) continue;
    line.ttl -= dt;
    if (line.ttl > 0) continue;
    replayGroup.remove(line.line);
    line.line.geometry.dispose();
    const material = line.line.material;
    if (material instanceof THREE.Material) material.dispose();
    replayLines.splice(i, 1);
  }
}

function findFrameForTime(timeSec: number): number {
  if (!replayData || replayData.frameTimes.length === 0) return 0;
  let lo = 0;
  let hi = replayData.frameTimes.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (replayData.frameTimes[mid] <= timeSec) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
}

function applyReplayFrameStates(frameIndex: number) {
  if (!replayData) return;
  const frameTimeSec = replayData.frameTimes[frameIndex] ?? 0;
  const stateOffset = replayData.frameStateOffsets[frameIndex] ?? 0;
  const stateCount = replayData.frameStateCounts[frameIndex] ?? 0;
  const stride = replayData.stateStride;

  for (let i = 0; i < stateCount; i++) {
    const base = (stateOffset + i) * stride;
    const id = Math.trunc(replayData.stateData[base] || 0);
    if (id <= 0) continue;

    const nextX = replayData.stateData[base + 1] || 0;
    const nextY = replayData.stateData[base + 2] || 0;
    const nextZ = replayData.stateData[base + 3] || 0;
    const nextDir = replayData.stateData[base + 4] || 0;
    const nextFlag = replayData.stateData[base + 5] || 0;
    const nextVehicle = replayData.stateData[base + 6] || 0;

    const existing = replayRuntimeStates.get(id);
    if (!existing) {
      replayRuntimeStates.set(id, {
        id,
        x: nextX,
        y: nextY,
        z: nextZ,
        dir: nextDir,
        stateFlag: nextFlag,
        vehicleRef: nextVehicle,
        prevTimeSec: frameTimeSec,
        currTimeSec: frameTimeSec,
        prevX: nextX,
        prevY: nextY,
        prevZ: nextZ,
        prevDir: nextDir,
      });
      continue;
    }

    existing.prevX = existing.x;
    existing.prevY = existing.y;
    existing.prevZ = existing.z;
    existing.prevDir = existing.dir;
    existing.prevTimeSec = existing.currTimeSec;
    existing.x = nextX;
    existing.y = nextY;
    existing.z = nextZ;
    existing.dir = nextDir;
    existing.stateFlag = nextFlag;
    existing.vehicleRef = nextVehicle;
    existing.currTimeSec = frameTimeSec;
  }
}

function applyReplayFrameEvents(frameIndex: number) {
  if (!replayData) return;
  const eventOffset = replayData.frameEventOffsets[frameIndex] ?? 0;
  const eventCount = replayData.frameEventCounts[frameIndex] ?? 0;
  for (let i = 0; i < eventCount; i++) {
    const event = replayData.events[eventOffset + i];
    if (!event) continue;
    if (event.type === 4) {
      if (!replayShowDeadInput.checked) continue;
      const killerPos = resolveReplayWorldPosition(event.killerId, event.timeSec);
      const victimPos = resolveReplayWorldPosition(event.victimId, event.timeSec);
      const killerUnit = replayUnitsById.get(event.killerId);
      if (killerPos && victimPos) {
        addReplayLine(killerPos, victimPos, killerUnit?.side ?? 4, "kill", true);
      }
      continue;
    }
    if (event.type === 5) {
      const fromPos = resolveReplayWorldPosition(event.sourceId, event.timeSec);
      const toPos = resolveReplayWorldPosition(event.targetId, event.timeSec);
      const sourceUnit = replayUnitsById.get(event.sourceId);
      if (fromPos && toPos) {
        addReplayLine(fromPos, toPos, sourceUnit?.side ?? 4, "hit");
      }
    }
  }
}

function rebuildReplayStateToFrame(targetFrame: number) {
  if (!replayData) return;
  replayRuntimeStates.clear();
  clearReplayVisuals();
  clearReplayLines();

  const clamped = Math.max(0, Math.min(targetFrame, replayData.frameTimes.length - 1));
  for (let frame = 0; frame <= clamped; frame++) {
    applyReplayFrameStates(frame);
    applyReplayFrameEvents(frame);
  }
  replayLastAppliedFrame = clamped;
}

function setReplayTime(timeSec: number) {
  if (!replayData || replayData.frameTimes.length === 0) return;
  const lastTime = replayData.frameTimes[replayData.frameTimes.length - 1] || 0;
  replayCurrentTimeSec = Math.max(0, Math.min(timeSec, lastTime));
  const targetFrame = findFrameForTime(replayCurrentTimeSec);

  if (targetFrame < replayLastAppliedFrame) {
    rebuildReplayStateToFrame(targetFrame);
  } else {
    for (let frame = replayLastAppliedFrame + 1; frame <= targetFrame; frame++) {
      applyReplayFrameStates(frame);
      applyReplayFrameEvents(frame);
    }
    replayLastAppliedFrame = targetFrame;
  }

  replayCurrentFrame = targetFrame;
  updateReplayVisuals(replayCurrentTimeSec);
  updateEventboard();
  updateReplayPanels();
}

function focusReplayUnit(unitId: number) {
  const pos = resolveReplayWorldPosition(unitId, replayCurrentTimeSec);
  if (!pos) return;
  camera.position.set(pos.x + 60, pos.y + 120, pos.z + 60);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function eventUnitLabel(unitId: number): { nameHtml: string; sideClass: string } {
  const unit = replayUnitsById.get(unitId);
  const name = unit?.playerName || unit?.name || `#${unitId}`;
  const sideClass = `unit-side-${unitSideCss(unit?.side ?? 4)}`;
  return { nameHtml: escapeHtml(name), sideClass };
}

function describeReplayEventHtml(event: ReplayTimelineEvent): string {
  if (event.type === 0) return escapeHtml(event.message);
  if (event.type === 4) {
    const killer = eventUnitLabel(event.killerId);
    const victim = eventUnitLabel(event.victimId);
    const dist = event.distance > 0 ? ` (${Math.round(event.distance)}m)` : "";
    return (
      `<span class="${killer.sideClass}">${killer.nameHtml}</span> -> ` +
      `<span class="${victim.sideClass}">${victim.nameHtml}</span> ` +
      `оружие: ${escapeHtml(event.weapon)}${escapeHtml(dist)}`
    );
  }
  if (event.type === 5) {
    const source = eventUnitLabel(event.sourceId);
    const target = eventUnitLabel(event.targetId);
    return (
      `<span class="${source.sideClass}">${source.nameHtml}</span> попал в ` +
      `<span class="${target.sideClass}">${target.nameHtml}</span> ` +
      `(${escapeHtml(event.weapon)})`
    );
  }
  if (event.type === 7) {
    const actor = eventUnitLabel(event.actorId);
    const target = eventUnitLabel(event.targetId);
    return (
      `<span class="${actor.sideClass}">${actor.nameHtml}</span> -> ` +
      `<span class="${target.sideClass}">${target.nameHtml}</span>: ` +
      `${escapeHtml(event.action)}`
    );
  }
  return `Событие ${escapeHtml(String(event.eventType))}`;
}

function updateKillboard() {
  if (!replayData) {
    replayKillboardEl.innerHTML = "";
    return;
  }

  const stats = new Map<number, { kills: number; deaths: number; teamkills: number }>();
  const ensure = (id: number) => {
    const existing = stats.get(id);
    if (existing) return existing;
    const next = { kills: 0, deaths: 0, teamkills: 0 };
    stats.set(id, next);
    return next;
  };

  for (const event of replayData.events) {
    if (event.type !== 4) continue;
    if (event.killerId > 0 && event.killerId !== event.victimId) {
      ensure(event.killerId).kills++;
    }
    if (event.victimId > 0) {
      ensure(event.victimId).deaths++;
    }
    const killerSide = replayUnitsById.get(event.killerId)?.side;
    const victimSide = replayUnitsById.get(event.victimId)?.side;
    if (
      event.killerId > 0 &&
      event.killerId !== event.victimId &&
      killerSide !== undefined &&
      killerSide === victimSide
    ) {
      ensure(event.killerId).teamkills++;
    }
  }

  const rows = Array.from(stats.entries())
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)
    .slice(0, 80);

  replayKillboardEl.innerHTML = rows
    .map((row) => {
      const unit = replayUnitsById.get(row.id);
      const name = unit?.playerName || unit?.name || `#${row.id}`;
      const side = unitSideCss(unit?.side ?? 4);
      return (
        `<button class="kb-row unit-side-${side}" data-unit-id="${row.id}" type="button">` +
        `<span class="kb-name">${name}</span>` +
        `<span class="kb-stats">${row.kills}/${row.deaths}${row.teamkills > 0 ? ` tk:${row.teamkills}` : ""}</span>` +
        `</button>`
      );
    })
    .join("");
}

function visibleReplayEventsAt(timeSec: number): ReplayTimelineEvent[] {
  if (!replayData) return [];
  const limit = 1500;
  const out: ReplayTimelineEvent[] = [];
  for (let i = replayData.events.length - 1; i >= 0; i--) {
    const event = replayData.events[i];
    if (event.timeSec > timeSec) continue;
    const include =
      (event.type === 0 && replayEventFilter.messages) ||
      (event.type === 4 && replayEventFilter.kills) ||
      (event.type === 5 && replayEventFilter.hits) ||
      (event.type === 7 && replayEventFilter.medical);
    if (!include) continue;
    out.push(event);
    if (out.length >= limit) break;
  }
  out.reverse();
  return out;
}

function replayEventboardNearBottom(thresholdPx = 12): boolean {
  const distanceToBottom =
    replayEventboardEl.scrollHeight - (replayEventboardEl.scrollTop + replayEventboardEl.clientHeight);
  return distanceToBottom <= thresholdPx;
}

function updateEventboard(force = false) {
  if (!replayData) {
    replayEventboardEl.innerHTML = "";
    replayEventboardLastSignature = "";
    replayEventboardManualScrollWhilePaused = false;
    return;
  }
  const previousScrollTop = replayEventboardEl.scrollTop;
  const previousScrollHeight = replayEventboardEl.scrollHeight;
  const events = visibleReplayEventsAt(replayCurrentTimeSec);
  const filterKey = `${replayEventFilter.messages ? 1 : 0}${replayEventFilter.kills ? 1 : 0}${replayEventFilter.hits ? 1 : 0}${replayEventFilter.medical ? 1 : 0}`;
  const first = events[0];
  const last = events[events.length - 1];
  const signature = `${replayData.replayName}|${filterKey}|${events.length}|${first ? `${first.frame}:${first.type}` : "none"}|${last ? `${last.frame}:${last.type}` : "none"}`;
  if (!force && signature === replayEventboardLastSignature) return;
  replayEventboardLastSignature = signature;
  replayEventboardEl.innerHTML = events
    .map((event) => {
      return (
        `<button class="ev-row" data-time="${event.timeSec}" data-frame="${event.frame}" type="button">` +
        `<span class="ev-time">${formatReplayTime(event.timeSec)}</span>` +
        `<span class="ev-text">${describeReplayEventHtml(event)}</span>` +
        `</button>`
      );
    })
    .join("");

  replayEventboardProgrammaticScroll = true;
  if (replayPlaying || !replayEventboardManualScrollWhilePaused) {
    replayEventboardEl.scrollTop = replayEventboardEl.scrollHeight;
  } else {
    const growth = Math.max(0, replayEventboardEl.scrollHeight - previousScrollHeight);
    replayEventboardEl.scrollTop = previousScrollTop + growth;
  }
  replayEventboardProgrammaticScroll = false;
}

function updateReplayPanels() {
  if (!replayData || replayData.frameTimes.length === 0) {
    replayPanel.style.display = "none";
    return;
  }
  replayPanel.style.display = "block";
  const last = replayData.frameTimes[replayData.frameTimes.length - 1] || 0;
  replaySeekInput.max = String(last);
  replaySeekInput.value = String(Math.floor(replayCurrentTimeSec));
  replayTimeEl.textContent = `${formatReplayTime(replayCurrentTimeSec)} / ${formatReplayTime(last)}`;
  replayPlayBtn.disabled = replayPlaying;
  replayPauseBtn.disabled = !replayPlaying;
}

function replayMapMatchesCurrentMap(): boolean {
  if (!replayData || !currentMapName) return false;
  const currentToken = normalizeMapToken(currentMapName);
  if (!currentToken) return false;
  return replayMapCandidates(replayData).some((candidate) => {
    return candidate === currentToken || candidate.includes(currentToken) || currentToken.includes(candidate);
  });
}

function startReplayIfReady() {
  if (!replayData) return;
  if (!currentMapName) {
    replayPendingStart = true;
    replayWaitingForMap = true;
    setReplayStatus("Чтобы запустить реплей, загрузите карту.");
    return;
  }
  if (!replayMapMatchesCurrentMap()) {
    replayPendingStart = true;
    replayWaitingForMap = true;
    setReplayStatus(`Реплей ожидает карту "${replayData.header.mapKey}". Выберите подходящую и загрузите.`);
    return;
  }

  replayReady = true;
  replayPendingStart = false;
  replayWaitingForMap = false;
  clearReplayRuntime();

  const firstTime = replayData.frameTimes[0] || 0;
  replayCurrentTimeSec = firstTime;
  setReplayTime(firstTime);
  setReplayStatus(`Реплей готов: ${replayData.replayName}`);
  updateReplayPanels();
}

function attemptMapAutoloadForReplay() {
  if (!replayData) return;
  if (mapFiles.length === 0) {
    replayPendingStart = true;
    replayWaitingForMap = true;
    setReplayStatus("Выберите карту (файлы/папку), чтобы реплей мог авто-загрузить рельеф.");
    return;
  }

  const matches = findReplayMapMatches(replayData);
  if (matches.length === 0) {
    replayPendingStart = true;
    replayWaitingForMap = true;
    setReplayStatus(
      `Для ключа карты "${replayData.header.mapKey}" совпадений нет. Выберите карту вручную и нажмите "Загрузить карту".`
    );
    return;
  }

  if (matches.length > 1) {
    replayPendingStart = true;
    replayWaitingForMap = true;
    const names = matches.slice(0, 4).map((item) => item.mapName).join(", ");
    setReplayStatus(`Карта реплея определяется неоднозначно (${names}). Выберите одну вручную.`);
    return;
  }

  const target = matches[0];
  mapSelect.value = target.id;
  if (currentMapName?.toLowerCase() === target.mapName.toLowerCase()) {
    startReplayIfReady();
    return;
  }

  replayPendingStart = true;
  replayWaitingForMap = true;
  void loadMapFile(target.file, target.relativePath);
  setReplayStatus(`Автозагрузка карты ${target.mapName} для реплея...`);
}

function updateReplayMeta() {
  if (!replayData) {
    replayMetaEl.textContent = "";
    return;
  }
  const missionExtra =
    missionDetails && missionDetails.replayName === replayData.replayName
      ? `Детали миссии: ${missionDetails.markers.length} маркеров, ${missionDetails.objects.length} объектов`
      : "Детали миссии: не загружены";
  replayMetaEl.textContent = [
    `Реплей: ${replayData.replayName}`,
    `Карта: ${replayData.header.mapKey}`,
    `Миссия: ${replayData.header.missionName}`,
    `Источник: ${replaySourceLabel(replayData.source)}`,
    `Кадры: ${replayData.frameTimes.length}`,
    missionExtra,
  ].join("\n");
}

function replayRowServerTag(entry: ReplayRowEntry): string {
  const tag = entry.row.serverTag || entry.row.tags[0] || entry.row.name.split(".")[0] || "";
  return tag.trim();
}

function renderReplayServerOptions() {
  const selected = replayServerFilter.value || "all";
  const servers = Array.from(
    new Set(replayRows.map((entry) => replayRowServerTag(entry)).filter((item) => item.length > 0))
  ).sort((a, b) => a.localeCompare(b));

  replayServerFilter.innerHTML = "";
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "Все";
  replayServerFilter.appendChild(all);
  for (const server of servers) {
    const option = document.createElement("option");
    option.value = server;
    option.textContent = server;
    replayServerFilter.appendChild(option);
  }
  replayServerFilter.value = servers.includes(selected) ? selected : "all";
}

function renderReplaySelectOptions() {
  const selectedId = replaySelect.value;
  const server = replayServerFilter.value || "all";
  replayVisibleRows =
    server === "all"
      ? replayRows
      : replayRows.filter((entry) => replayRowServerTag(entry).toLowerCase() === server.toLowerCase());

  replaySelect.innerHTML = "";
  if (replayVisibleRows.length === 0) {
    replaySelect.disabled = true;
    btnLoadReplay.disabled = true;
    if (!missionIsLoading) btnLoadMission.disabled = true;
    replaySelect.innerHTML = '<option value="">-- для этого сервера реплеев нет --</option>';
    return;
  }

  for (const entry of replayVisibleRows) {
    const option = document.createElement("option");
    option.value = entry.id;
    const serverTag = replayRowServerTag(entry) || "?";
    option.textContent = `${serverTag} | ${entry.row.missionDate} | ${entry.row.missionName} | ${entry.row.mapKey}`;
    option.title = entry.row.name;
    replaySelect.appendChild(option);
  }
  replaySelect.disabled = false;
  btnLoadReplay.disabled = false;
  replaySelect.value = replayVisibleRows.some((entry) => entry.id === selectedId)
    ? selectedId
    : replayVisibleRows[0].id;
}

function setReplayRows(rows: ReplayListItem[]) {
  replayRows = rows.map((row, index) => ({
    id: `${index}:${row.name}`,
    row,
  }));
  replayVisibleRows = [];
  selectedReplayRow = null;
  renderReplayServerOptions();
  renderReplaySelectOptions();
}

function loadReplayList() {
  if (replayIsLoading) return;
  replayIsLoading = true;
  setReplayStatus("Получение списка реплеев...");
  replayWorker.postMessage({
    type: "load_replay_list",
    filters: ["1", "2", "3", "4", "10", "20:1"],
    proxyUrl: getReplayProxyUrl(),
  });
}

function loadSelectedReplay() {
  if (replayIsLoading) return;
  const selected = replayRows.find((entry) => entry.id === replaySelect.value);
  if (!selected) return;
  selectedReplayRow = selected.row;
  replayIsLoading = true;
  replayReady = false;
  replayPlaying = false;
  missionDetails = null;
  setMissionLoading(false);
  clearMissionOverlay();
  setMissionStatus("Детали миссии не загружены.");
  btnLoadMission.disabled = true;
  setReplayStatus(`Загрузка реплея ${selected.row.name}...`);
  replayWorker.postMessage({
    type: "load_replay_detail",
    replayName: selected.row.name,
    archive: selected.row.archive,
    proxyUrl: getReplayProxyUrl(),
  });
}

function loadMissionDetails() {
  if (missionIsLoading || !replayData) return;
  setMissionLoading(true);
  const missionName = selectedReplayRow?.missionName || replayData.header.missionName;
  const mapKey = selectedReplayRow?.mapKey || replayData.header.mapKey;
  setMissionStatus("Загрузка файла mission.pbo...");
  replayWorker.postMessage({
    type: "load_mission_details",
    replayName: replayData.replayName,
    missionName,
    mapKey,
    proxyUrl: getReplayProxyUrl(),
  });
}

function loadMissionFromUrl() {
  if (missionIsLoading) return;
  const missionUrl = missionUrlInput.value.trim();
  if (!missionUrl) {
    setMissionStatus("Введите ссылку на mission.pbo.");
    return;
  }
  localStorage.setItem("mission_manual_url", missionUrl);
  setMissionLoading(true);
  setMissionStatus("Загрузка mission.pbo по ссылке...");
  replayWorker.postMessage({
    type: "load_mission_url",
    missionUrl,
    replayName: replayData?.replayName,
    missionName: replayData?.header.missionName || selectedReplayRow?.missionName,
    mapKey: replayData?.header.mapKey || selectedReplayRow?.mapKey,
    proxyUrl: getReplayProxyUrl(),
  });
}

replayWorker.onmessage = (event: MessageEvent<ReplayWorkerResponse>) => {
  const msg = event.data;
  if (msg.type === "replay_progress") {
    if (msg.stage === "fetch_mission" || msg.stage === "parse_mission") {
      setMissionStatus(msg.detail || replayProgressStageLabel(msg.stage));
    } else {
      setReplayStatus(msg.detail || replayProgressStageLabel(msg.stage));
    }
    return;
  }
  if (msg.type === "error") {
    if (missionIsLoading) {
      setMissionLoading(false);
      setMissionStatus(`Ошибка: ${msg.message}`);
    } else {
      replayIsLoading = false;
      replayReady = false;
      btnLoadMission.disabled = !replayData;
      setReplayStatus(`Ошибка: ${msg.message}`);
    }
    return;
  }
  if (msg.type === "replay_list_loaded") {
    replayIsLoading = false;
    setReplayRows(msg.rows);
    setReplayStatus(`Загружено реплеев: ${msg.rows.length} (${replaySourceLabel(msg.source)}).`);

    if (pendingAutoReplay && pendingAutoReplay !== replayLastAutoReplayParam) {
      const archiveFilter = pendingAutoReplayArchive ? Number(pendingAutoReplayArchive) : NaN;
      const target = replayRows.find((entry) => {
        if (entry.row.name !== pendingAutoReplay) return false;
        if (!Number.isFinite(archiveFilter)) return true;
        return entry.row.archive === archiveFilter;
      });
      if (target) {
        const serverTag = replayRowServerTag(target);
        const hasServerOption = Array.from(replayServerFilter.options).some((opt) => opt.value === serverTag);
        if (serverTag && hasServerOption) {
          replayServerFilter.value = serverTag;
          renderReplaySelectOptions();
        }
        replaySelect.value = target.id;
        replayLastAutoReplayParam = pendingAutoReplay;
        loadSelectedReplay();
      }
    }
    return;
  }
  if (msg.type === "replay_parsed") {
    replayIsLoading = false;
    replayData = msg.replay;
    if (!selectedReplayRow || selectedReplayRow.name !== replayData.replayName) {
      selectedReplayRow = replayRows.find((entry) => entry.row.name === replayData.replayName)?.row ?? selectedReplayRow;
    }
    replayUnitsById = new Map(replayData.units.map((unit) => [unit.id, unit]));
    replayReady = false;
    replayPendingStart = true;
    clearReplayRuntime();
    updateReplayMeta();
    updateKillboard();
    updateEventboard(true);
    updateReplayPanels();
    setMissionLoading(false);
    btnLoadMission.disabled = false;
    updateUrlReplayParams(replayData.replayName, replayData.archive);
    setReplayStatus(`Реплей разобран (${replaySourceLabel(replayData.source)}). Подбираю карту...`);
    setMissionStatus("Опционально: нажмите «Загрузить детали миссии», чтобы добавить маркеры и объекты.");
    attemptMapAutoloadForReplay();
    return;
  }
  if (msg.type === "mission_details_loaded") {
    setMissionLoading(false);
    missionDetails = msg.mission;
    updateReplayMeta();
    renderMissionOverlay();
    if (!currentMapName) {
      const mapHint = msg.mission.mapKey ? `"${msg.mission.mapKey}"` : "подходящую карту";
      setMissionStatus(
        `Детали миссии загружены (${msg.mission.missionFile}). Загрузите ${mapHint}, чтобы показать объекты.`
      );
    }
  }
};

loaderWorker.onmessage = (event: MessageEvent<MapWorkerResponse>) => {
  const msg = event.data;

  if (msg.type === "progress") {
    handleWorkerProgress(msg);
    return;
  }

  if (msg.type === "error") {
    isLoading = false;
    setStatus(`Ошибка: ${msg.message}`);
    return;
  }

  if (msg.type === "map_loaded") {
    const data = msg as WorkerMapLoadedMessage;
    isLoading = false;
    applyLoadedMap(data.map.name, data.terrain, data.objects, data.map.satelliteTiles);
    if (replayPendingStart) {
      startReplayIfReady();
    }
    if (data.map.satelliteTiles > 0) {
      loaderWorker.postMessage({
        type: "generate_satellite",
        mapName: data.map.name,
        size: 4096,
      });
    }
    return;
  }

  if (msg.type === "satellite_ready") {
    handleSatelliteReady(msg);
  }
};

function setMapEntries(entries: Array<{ file: File; relativePath: string }>) {
  mapFiles = entries
    .filter((entry) => /\.(pbo|wrp)$/i.test(entry.file.name))
    .map((entry, index) => ({
      id: `${index}:${entry.relativePath}`,
      mapName: extractMapName(entry.file.name),
      file: entry.file,
      relativePath: entry.relativePath,
    }))
    .sort((a, b) => a.mapName.localeCompare(b.mapName));

  const mapSelect = document.getElementById("map-select") as HTMLSelectElement;
  const btnLoadMap = document.getElementById("btn-load-map") as HTMLButtonElement;

  mapSelect.innerHTML = "";
  if (mapFiles.length === 0) {
    mapSelect.innerHTML = '<option value="">-- карты не найдены --</option>';
    mapSelect.disabled = true;
    btnLoadMap.disabled = true;
    setStatus("В выбранных файлах нет .pbo/.wrp.");
    return;
  }

  for (const entry of mapFiles) {
    const opt = document.createElement("option");
    opt.value = entry.id;
    opt.textContent = entry.mapName;
    opt.title = entry.relativePath;
    mapSelect.appendChild(opt);
  }

  mapSelect.disabled = false;
  btnLoadMap.disabled = false;

  let autoMapTriggered = false;
  const autoTarget = pendingAutoMap;
  if (autoTarget) {
    const matched = mapFiles.find((entry) => entry.mapName.toLowerCase() === autoTarget);
    if (matched) {
      mapSelect.value = matched.id;
      void loadMapFile(matched.file, matched.relativePath);
      autoMapTriggered = true;
    } else {
      setStatus(`Найдено карт: ${mapFiles.length}. Цель автозагрузки "${autoTarget}" не найдена.`);
    }
  }

  if (!autoMapTriggered && (!replayData || !replayPendingStart)) {
    setStatus(`Найдено карт: ${mapFiles.length}. Выберите карту и нажмите "Загрузить карту".`);
  }

  if (replayData && replayPendingStart) {
    attemptMapAutoloadForReplay();
  }
}

function setMaps(files: File[]) {
  const entries = files.map((file) => ({
    file,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
  setMapEntries(entries);
}

function updateReopenFolderButton(button: HTMLButtonElement) {
  if (!supportsPersistentFolderAccess) {
    button.style.display = "none";
    return;
  }
  button.style.display = "";
  button.disabled = !hasStoredMapFolderHandle;
}

async function openStoredMapFolder(requestPrompt: boolean) {
  if (!supportsPersistentFolderAccess) return;
  const handle = await loadStoredMapFolderHandle();
  if (!handle) {
    hasStoredMapFolderHandle = false;
    setStatus("Ранее выбранная папка не сохранена.");
    return;
  }

  const granted = await ensureMapFolderPermission(handle, requestPrompt);
  if (!granted) {
    setStatus('Нет доступа к папке. Нажмите "Открыть прошлую папку", чтобы выдать разрешение.');
    return;
  }

  setStatus("Сканирую папку в поиске файлов .pbo/.wrp...");
  const entries = await collectMapEntriesFromDirectory(handle);
  setMapEntries(entries);
}

async function pickFolderWithPersistentAccess() {
  if (!supportsPersistentFolderAccess) return false;
  const picker = (window as any).showDirectoryPicker as
    | ((options?: { mode?: "read" | "readwrite"; id?: string }) => Promise<any>)
    | undefined;
  if (!picker) return false;

  try {
    const handle = await picker({ mode: "read", id: "arma3-map-folder" });
    try {
      await saveStoredMapFolderHandle(handle);
      hasStoredMapFolderHandle = true;
    } catch {
      hasStoredMapFolderHandle = false;
    }
    setStatus("Сканирую папку в поиске файлов .pbo/.wrp...");
    const entries = await collectMapEntriesFromDirectory(handle);
    setMapEntries(entries);
    return true;
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return true;
    }
    setStatus(`Ошибка выбора папки: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }
}

async function loadMapFile(file: File, displayName: string) {
  if (isLoading) return;
  isLoading = true;

  try {
    setStatus(`Чтение ${displayName}...`);
    const buffer = await file.arrayBuffer();

    loaderWorker.postMessage(
      {
        type: "load_map",
        fileName: displayName,
        fileBytes: buffer,
      },
      [buffer]
    );
  } catch (err: unknown) {
    isLoading = false;
    setStatus(`Ошибка чтения файла карты: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- UI Bindings ---
const mapSelect = document.getElementById("map-select") as HTMLSelectElement;
const btnLoadMap = document.getElementById("btn-load-map") as HTMLButtonElement;
const btnPickFolder = document.getElementById("btn-pick-folder") as HTMLButtonElement;
const btnReopenFolder = document.getElementById("btn-reopen-folder") as HTMLButtonElement;
const btnPickFiles = document.getElementById("btn-pick-files") as HTMLButtonElement;
const folderInput = document.getElementById("folder-picker") as HTMLInputElement;
const filesInput = document.getElementById("file-picker") as HTMLInputElement;
updateReopenFolderButton(btnReopenFolder);

btnPickFolder.addEventListener("click", async () => {
  if (supportsPersistentFolderAccess) {
    const handled = await pickFolderWithPersistentAccess();
    if (handled) {
      updateReopenFolderButton(btnReopenFolder);
      return;
    }
  }
  folderInput.value = "";
  folderInput.click();
});

btnReopenFolder.addEventListener("click", async () => {
  await openStoredMapFolder(true);
  updateReopenFolderButton(btnReopenFolder);
});

btnPickFiles.addEventListener("click", () => {
  filesInput.value = "";
  filesInput.click();
});

folderInput.addEventListener("change", () => {
  const files = Array.from(folderInput.files || []);
  setMaps(files);
});

filesInput.addEventListener("change", () => {
  const files = Array.from(filesInput.files || []);
  setMaps(files);
});

void (async () => {
  if (!supportsPersistentFolderAccess) return;
  try {
    const stored = await loadStoredMapFolderHandle();
    hasStoredMapFolderHandle = Boolean(stored);
    updateReopenFolderButton(btnReopenFolder);
    if (!stored) return;
    const granted = await ensureMapFolderPermission(stored, false);
    if (!granted) {
      setStatus('Найдена ранее выбранная папка. Нажмите "Открыть прошлую папку", чтобы выдать доступ.');
      return;
    }
    setStatus("Восстанавливаю карты из ранее выбранной папки...");
    const entries = await collectMapEntriesFromDirectory(stored);
    setMapEntries(entries);
  } catch (err: unknown) {
    setStatus(`Не удалось восстановить прошлую папку: ${err instanceof Error ? err.message : String(err)}`);
  }
})();

btnLoadMap.addEventListener("click", () => {
  const selected = mapFiles.find((entry) => entry.id === mapSelect.value);
  if (!selected) return;
  void loadMapFile(selected.file, selected.relativePath);
  if (replayPendingStart) {
    replayWaitingForMap = true;
    setReplayStatus("Загрузка выбранной карты для реплея...");
  }
});

btnFetchReplays.addEventListener("click", () => {
  loadReplayList();
});

replayServerFilter.addEventListener("change", () => {
  renderReplaySelectOptions();
});

btnLoadReplay.addEventListener("click", () => {
  loadSelectedReplay();
});

btnLoadMission.addEventListener("click", () => {
  loadMissionDetails();
});

btnToggleMissionManual.addEventListener("click", () => {
  const nextOpen = manualMissionPanel.style.display !== "block";
  setMissionManualPanelOpen(nextOpen);
  localStorage.setItem("mission_manual_panel_open", nextOpen ? "1" : "0");
});

btnLoadMissionUrl.addEventListener("click", () => {
  loadMissionFromUrl();
});

missionUrlInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  loadMissionFromUrl();
});

missionUrlInput.addEventListener("input", () => {
  const value = missionUrlInput.value.trim();
  if (!value) {
    localStorage.removeItem("mission_manual_url");
    return;
  }
  localStorage.setItem("mission_manual_url", value);
});

missionShowMarkersInput.addEventListener("change", () => {
  localStorage.setItem("mission_show_markers", missionShowMarkersInput.checked ? "1" : "0");
  renderMissionOverlay();
  updateReplayMeta();
});

missionShowObjectsInput.addEventListener("change", () => {
  localStorage.setItem("mission_show_objects", missionShowObjectsInput.checked ? "1" : "0");
  renderMissionOverlay();
  updateReplayMeta();
});

replayBoardKillsBtn.addEventListener("click", () => {
  setReplayBoardTab("kills");
});

replayBoardEventsBtn.addEventListener("click", () => {
  setReplayBoardTab("events");
});

replayPlayBtn.addEventListener("click", () => {
  if (!replayData) return;
  replayEventboardManualScrollWhilePaused = false;
  replayPlaying = true;
  updateReplayPanels();
});

replayPauseBtn.addEventListener("click", () => {
  replayPlaying = false;
  updateReplayPanels();
});

replaySeekInput.addEventListener("input", () => {
  if (!replayData) return;
  replayPlaying = false;
  setReplayTime(Number(replaySeekInput.value));
  updateReplayPanels();
});

replaySpeedSelect.addEventListener("change", () => {
  localStorage.setItem("replay_speed", replaySpeedSelect.value);
});

replayShowDeadInput.addEventListener("change", () => {
  localStorage.setItem("replay_show_dead", replayShowDeadInput.checked ? "1" : "0");
  if (!replayData) return;
  rebuildReplayStateToFrame(replayCurrentFrame);
  updateReplayVisuals(replayCurrentTimeSec);
  updateReplayPanels();
});

for (const [el, key] of [
  [replayFilterMessages, "messages"],
  [replayFilterKills, "kills"],
  [replayFilterHits, "hits"],
  [replayFilterMedical, "medical"],
] as const) {
  el.addEventListener("change", () => {
    replayEventFilter[key] = el.checked;
    updateEventboard(true);
  });
}

replayKillboardEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLButtonElement>(".kb-row");
  if (!row) return;
  const unitId = Number(row.dataset.unitId || 0);
  if (!Number.isFinite(unitId) || unitId <= 0) return;
  focusReplayUnit(unitId);
});

replayEventboardEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const row = target.closest<HTMLButtonElement>(".ev-row");
  if (!row) return;
  const time = Number(row.dataset.time || 0);
  if (!Number.isFinite(time)) return;
  replayPlaying = false;
  setReplayTime(time);
  updateReplayPanels();
});

replayEventboardEl.addEventListener("scroll", () => {
  if (replayEventboardProgrammaticScroll) return;
  if (replayPlaying) return;
  replayEventboardManualScrollWhilePaused = !replayEventboardNearBottom();
});

// --- Render Loop ---
const clock = new THREE.Clock();

function updateMinimap() {
  if (!currentMapSize) return;
  const size = minimapCanvas.width;
  if (minimapImage) {
    minimapCtx.drawImage(minimapImage, 0, 0, size, size);
  } else {
    minimapCtx.fillStyle = "#2a3a2a";
    minimapCtx.fillRect(0, 0, size, size);
  }

  const px = Math.max(0, Math.min(1, camera.position.x / currentMapSize));
  const pz = Math.max(0, Math.min(1, camera.position.z / currentMapSize));
  const mx = px * size;
  const my = (1 - pz) * size;

  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const angle = Math.atan2(dir.x, dir.z);

  const coneLen = 25;
  const coneSpread = 0.5;
  minimapCtx.beginPath();
  minimapCtx.moveTo(mx, my);
  minimapCtx.lineTo(mx + Math.sin(angle - coneSpread) * coneLen, my - Math.cos(angle - coneSpread) * coneLen);
  minimapCtx.lineTo(mx + Math.sin(angle + coneSpread) * coneLen, my - Math.cos(angle + coneSpread) * coneLen);
  minimapCtx.closePath();
  minimapCtx.fillStyle = "rgba(255,255,255,0.2)";
  minimapCtx.fill();

  const lineLen = 15;
  minimapCtx.beginPath();
  minimapCtx.moveTo(mx, my);
  minimapCtx.lineTo(mx + Math.sin(angle) * lineLen, my - Math.cos(angle) * lineLen);
  minimapCtx.strokeStyle = "#ff3333";
  minimapCtx.lineWidth = 2;
  minimapCtx.stroke();

  minimapCtx.beginPath();
  minimapCtx.arc(mx, my, 4, 0, Math.PI * 2);
  minimapCtx.fillStyle = "#ff3333";
  minimapCtx.fill();
  minimapCtx.strokeStyle = "#fff";
  minimapCtx.lineWidth = 1.5;
  minimapCtx.stroke();

  for (const mark of planMode.marks) {
    const markPx = (mark.worldPos.x / currentMapSize) * size;
    const markPy = (1 - mark.worldPos.z / currentMapSize) * size;

    minimapCtx.beginPath();
    minimapCtx.moveTo(markPx, markPy - 5);
    minimapCtx.lineTo(markPx + 4, markPy);
    minimapCtx.lineTo(markPx, markPy + 5);
    minimapCtx.lineTo(markPx - 4, markPy);
    minimapCtx.closePath();
    minimapCtx.fillStyle = MARK_COLOR_CSS[mark.color];
    minimapCtx.fill();
    minimapCtx.strokeStyle = "#fff";
    minimapCtx.lineWidth = 1;
    minimapCtx.stroke();

    minimapCtx.font = "bold 9px monospace";
    minimapCtx.fillStyle = "#fff";
    minimapCtx.textAlign = "center";
    minimapCtx.fillText(mark.text, markPx, markPy - 8);
  }

  for (const line of planMode.lines) {
    const sx = (line.start.x / currentMapSize) * size;
    const sy = (1 - line.start.z / currentMapSize) * size;
    const ex = (line.end.x / currentMapSize) * size;
    const ey = (1 - line.end.z / currentMapSize) * size;

    minimapCtx.beginPath();
    minimapCtx.moveTo(sx, sy);
    minimapCtx.lineTo(ex, ey);
    minimapCtx.strokeStyle = MARK_COLOR_CSS[line.color];
    minimapCtx.lineWidth = 2;
    minimapCtx.stroke();
  }

  if (missionMarkersRender.length > 0) {
    for (const item of missionMarkersRender) {
      const points = buildMissionMarkerPoints(item.marker, item.worldX, item.worldZ, 0);
      if (points.length < 2) continue;
      minimapCtx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const px = (p.x / currentMapSize) * size;
        const py = (1 - p.z / currentMapSize) * size;
        if (i === 0) minimapCtx.moveTo(px, py);
        else minimapCtx.lineTo(px, py);
      }
      minimapCtx.strokeStyle = item.color;
      minimapCtx.lineWidth = item.marker.drawBorder ? 1.6 : 1.1;
      minimapCtx.globalAlpha = missionMarkerOpacity(item.marker);
      minimapCtx.stroke();
      minimapCtx.globalAlpha = 1;
    }
  }

  if (replayReady) {
    for (const line of replayLines) {
      const sx = (line.fromX / currentMapSize) * size;
      const sy = (1 - line.fromZ / currentMapSize) * size;
      const ex = (line.toX / currentMapSize) * size;
      const ey = (1 - line.toZ / currentMapSize) * size;
      minimapCtx.beginPath();
      minimapCtx.moveTo(sx, sy);
      minimapCtx.lineTo(ex, ey);
      minimapCtx.strokeStyle = line.kind === "kill" ? "rgba(255,80,80,0.7)" : "rgba(255,255,255,0.35)";
      minimapCtx.lineWidth = line.kind === "kill" ? 1.5 : 1;
      minimapCtx.stroke();
    }

    for (const visual of replayVisuals.values()) {
      if (!visual.mesh.visible) continue;
      const vx = visual.mesh.position.x;
      const vz = visual.mesh.position.z;
      const pxUnit = (vx / currentMapSize) * size;
      const pyUnit = (1 - vz / currentMapSize) * size;
      minimapCtx.beginPath();
      minimapCtx.arc(pxUnit, pyUnit, 2.5, 0, Math.PI * 2);
      minimapCtx.fillStyle = `#${sideColor(visual.side).toString(16).padStart(6, "0")}`;
      minimapCtx.fill();
    }
  }
}

minimapCanvas.addEventListener("click", (e) => {
  if (!currentMapSize) return;
  const rect = minimapCanvas.getBoundingClientRect();
  const scaleX = minimapCanvas.width / rect.width;
  const scaleY = minimapCanvas.height / rect.height;
  const cx = (e.clientX - rect.left) * scaleX;
  const cy = (e.clientY - rect.top) * scaleY;
  const size = minimapCanvas.width;

  const worldX = (cx / size) * currentMapSize;
  const worldZ = (1 - cy / size) * currentMapSize;
  camera.position.set(worldX, camera.position.y, worldZ);
});

minimapCanvas.addEventListener("mousedown", (e) => {
  e.stopPropagation();
});
planPanel.addEventListener("mousedown", (e) => {
  e.stopPropagation();
});
replayPanel.addEventListener("mousedown", (e) => {
  e.stopPropagation();
});
planToggle.addEventListener("mousedown", (e) => {
  e.stopPropagation();
});

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (replayReady && replayData) {
    if (replayPlaying) {
      const speed = (Number(replaySpeedSelect.value) || 1) * REPLAY_SPEED_MULTIPLIER;
      const next = replayCurrentTimeSec + dt * speed;
      const max = replayData.frameTimes[replayData.frameTimes.length - 1] || 0;
      setReplayTime(next);
      if (next >= max) {
        replayPlaying = false;
        updateReplayPanels();
      }
    } else {
      updateReplayVisuals(replayCurrentTimeSec);
      updateReplayPanels();
    }
    updateReplayLines(dt);
  }

  flyCamera.update(dt);
  hudEl.textContent = flyCamera.getInfo();
  renderer.render(scene, camera);
  updateMinimap();
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

setStatus("Для начала выберите папку с картами (или отдельные файлы). Можно выбрать корневую папку игры.");
setReplayStatus(
  DEPLOY_REPLAY_PROXY_URL
    ? "Чтобы начать, получите список реплеев. Прокси деплоя настроен."
    : "Чтобы начать, получите список реплеев."
);
if (pendingAutoReplay) {
  loadReplayList();
}
