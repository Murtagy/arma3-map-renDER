import puppeteer from "puppeteer";

const url =
  process.argv[2] ||
  "http://localhost:5173/?pbo=/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_zargabad.pbo";
const output = process.argv[3] || "screenshot-plan.png";

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("PAGE ERROR:", msg.text());
  });

  console.log(`Opening: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Wait for map to load
  await page.waitForFunction(
    () => {
      const el = document.getElementById("status");
      return el && (el.textContent?.includes("Done!") || el.textContent?.includes("Error"));
    },
    { timeout: 300000 },
  );

  const status = await page.$eval("#status", (el) => el.textContent);
  console.log("Status:", status?.split("\n").pop());

  // Wait for rendering to settle
  await new Promise((r) => setTimeout(r, 3000));

  // Position camera looking straight down at the map center for reliable raycasting
  await page.evaluate(() => {
    const cam = (window as any).__camera;
    if (cam) {
      cam.position.set(3800, 800, 3800);
      cam.lookAt(3800, 0, 3800);
    }
  });
  await new Promise((r) => setTimeout(r, 500));

  // Toggle plan mode by clicking the button
  await page.click("#plan-toggle");
  await new Promise((r) => setTimeout(r, 300));

  // Verify plan panel is visible
  const panelVisible = await page.$eval(
    "#plan-panel",
    (el) => (el as HTMLElement).style.display !== "none",
  );
  console.log("Plan panel visible:", panelVisible);

  // Helper: double-click to pin location, type name, press Enter (Arma-style)
  async function placeMark(x: number, y: number, name: string, color?: string) {
    // Select color if specified
    if (color) {
      await page.select("#mark-color", color);
    }
    // Double-click on terrain to pin the location
    await page.mouse.click(x, y, { count: 2 });
    await new Promise((r) => setTimeout(r, 300));
    // Type the name into the now-visible input
    await page.type("#mark-text", name);
    // Press Enter to confirm
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 300));
  }

  // Place marks with different colors
  await placeMark(640, 400, "Alpha", "R");
  await placeMark(500, 450, "Bravo", "G");
  await placeMark(780, 350, "Rally Point", "B");

  // Draw lines by click-drag
  async function drawLine(x1: number, y1: number, x2: number, y2: number, color?: string, lineType?: string) {
    if (color) await page.select("#mark-color", color);
    if (lineType) await page.select("#line-type", lineType);
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    const steps = 5;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await page.mouse.move(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
      await new Promise((r) => setTimeout(r, 50));
    }
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 300));
  }

  // Ground line (follows terrain)
  await drawLine(400, 400, 700, 350, "R", "ground");
  // Straight line (direct ray, arcs over valleys)
  await drawLine(550, 300, 600, 500, "G", "straight");

  // Check items in the list
  const itemCount = await page.$$eval("#plan-mark-list .mark-item", (items) => items.length);
  console.log("Items placed:", itemCount, "(3 marks + 2 lines)");

  // Now angle the camera to see everything in 3D perspective
  await page.evaluate(() => {
    const cam = (window as any).__camera;
    if (cam) {
      cam.position.set(3500, 500, 3500);
      cam.lookAt(3800, 200, 3800);
    }
  });

  // Let it render
  await new Promise((r) => setTimeout(r, 1000));

  await page.screenshot({ path: output });
  console.log(`Screenshot: ${output}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
