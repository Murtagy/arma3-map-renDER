import puppeteer from "puppeteer";

const url = process.argv[2] || "http://localhost:5173/?pbo=/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_zargabad.pbo";
const output = process.argv[3] || "screenshot.png";

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
    { timeout: 300000 }
  );

  const status = await page.$eval("#status", (el) => el.textContent);
  console.log("Status:", status?.split("\n").pop());

  await new Promise((r) => setTimeout(r, 5000));

  // Optional: move camera and set look target via CLI args
  // arg4: "x,y,z" position, arg5: "lx,ly,lz" lookAt target (optional)
  const cameraPos = process.argv[4]; // e.g. "3800,200,3800"
  if (cameraPos) {
    const [cx, cy, cz] = cameraPos.split(",").map(Number);
    const lookTarget = process.argv[5]; // e.g. "3900,0,3900"
    const [lx, ly, lz] = lookTarget
      ? lookTarget.split(",").map(Number)
      : [cx + 100, cy - 50, cz + 100];
    await page.evaluate((x, y, z, tx, ty, tz) => {
      const cam = (window as any).__camera;
      if (cam) {
        cam.position.set(x, y, z);
        cam.lookAt(tx, ty, tz);
      }
    }, cx, cy, cz, lx, ly, lz);
    await new Promise((r) => setTimeout(r, 500));
  }

  await page.screenshot({ path: output });
  console.log(`Screenshot: ${output}`);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
