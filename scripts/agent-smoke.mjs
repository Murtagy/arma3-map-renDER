import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function runCommand(cmd, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: false,
      ...options,
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function killProcess(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }, 5000).unref();
}

function selectMapByName(page, mapName) {
  return page.evaluate((target) => {
    const select = document.getElementById("map-select");
    if (!(select instanceof HTMLSelectElement)) return false;
    const normalizedTarget = target.toLowerCase();
    for (const option of Array.from(select.options)) {
      if (option.textContent?.trim().toLowerCase() === normalizedTarget) {
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, mapName);
}

async function waitForStatus(page, { timeoutMs, requireSatellite }) {
  const started = Date.now();
  let sawLoaded = false;

  while (Date.now() - started < timeoutMs) {
    const status = await page.locator("#status").textContent();
    const statusText = (status || "").trim();

    if (statusText.includes("Error:")) {
      throw new Error(`Smoke test failed with UI error:\n${statusText}`);
    }

    if (statusText.includes("Loaded ")) {
      sawLoaded = true;
    }

    if (sawLoaded) {
      if (!requireSatellite) {
        return statusText;
      }

      if (
        statusText.includes("Satellite texture applied") ||
        statusText.includes("No satellite tiles in this map")
      ) {
        return statusText;
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error("Timed out waiting for map load to complete");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const shouldBuild = args.has("--build");

  const mapFile = process.env.MAP_FILE;
  if (!mapFile) {
    throw new Error("MAP_FILE is required. Example: MAP_FILE=/abs/path/cup_zargabad.pbo npm run test:agent");
  }
  if (!existsSync(mapFile)) {
    throw new Error(`MAP_FILE does not exist: ${mapFile}`);
  }

  const screenshotPath = resolve(process.env.SCREENSHOT_PATH || "artifacts/agent-smoke.png");
  const mapName = process.env.MAP_NAME;
  const port = Number(process.env.SMOKE_PORT || 4173);
  const baseUrl = `http://127.0.0.1:${port}`;

  if (shouldBuild) {
    console.log("[agent-smoke] Building app...");
    await runCommand(npmCmd, ["run", "build"]);
  }

  console.log("[agent-smoke] Starting preview server...");
  const preview = spawn(
    npmCmd,
    ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(port)],
    { stdio: "pipe", shell: false }
  );

  preview.stdout.on("data", (chunk) => process.stdout.write(`[preview] ${chunk}`));
  preview.stderr.on("data", (chunk) => process.stderr.write(`[preview] ${chunk}`));

  let browser;
  try {
    await waitForServer(baseUrl, 60000);

    console.log("[agent-smoke] Launching browser...");
    browser = await chromium.launch({
      headless: true,
      args: [
        "--use-angle=swiftshader",
        "--use-gl=angle",
        "--ignore-gpu-blocklist",
        "--enable-webgl",
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

    const runtimeErrors = [];
    page.on("pageerror", (err) => runtimeErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") runtimeErrors.push(msg.text());
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });

    await page.waitForTimeout(1000);
    if (runtimeErrors.length > 0) {
      throw new Error(`Startup console errors detected:\\n${runtimeErrors.join("\\n")}`);
    }

    const fileInput = page.locator("#file-picker");
    await fileInput.setInputFiles(mapFile);
    await page.dispatchEvent("#file-picker", "change");

    const injectedFiles = await page.evaluate(() => {
      const input = document.getElementById("file-picker");
      if (!(input instanceof HTMLInputElement)) return -1;
      return input.files?.length ?? 0;
    });
    console.log(`[agent-smoke] Injected files: ${injectedFiles}`);

    await page.waitForFunction(() => {
      const select = document.getElementById("map-select");
      return select instanceof HTMLSelectElement && !select.disabled && select.options.length > 0;
    }, { timeout: 30000 });

    if (mapName) {
      const ok = await selectMapByName(page, mapName);
      if (!ok) {
        throw new Error(`MAP_NAME not found in dropdown: ${mapName}`);
      }
    }

    await page.locator("#btn-load-map").click();

    const finalStatus = await waitForStatus(page, {
      timeoutMs: 6 * 60 * 1000,
      requireSatellite: true,
    });

    const minimapVisible = await page.evaluate(() => {
      const c = document.getElementById("minimap");
      if (!(c instanceof HTMLCanvasElement)) return false;
      return getComputedStyle(c).display !== "none";
    });

    if (!minimapVisible) {
      throw new Error("Minimap is not visible after load");
    }

    if (runtimeErrors.length > 0) {
      throw new Error(`Runtime console errors detected:\n${runtimeErrors.join("\n")}`);
    }

    mkdirSync(dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log("[agent-smoke] Success");
    console.log(`[agent-smoke] Final status: ${finalStatus.split("\n")[0]}`);
    console.log(`[agent-smoke] Screenshot: ${screenshotPath}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    killProcess(preview);
  }
}

main().catch((err) => {
  console.error(`[agent-smoke] ERROR: ${err.message}`);
  process.exit(1);
});
