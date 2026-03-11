import puppeteer from "puppeteer";

const pboPath = process.argv[2] || "/Users/murtagy/Downloads/1981964169_cup_terrains__maps_20/addons/cup_zargabad.pbo";
const output = process.argv[3] || "screenshot.png";

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Enable console logging from the page
  page.on("console", (msg) => console.log("PAGE:", msg.text()));

  await page.goto("http://localhost:5173", { waitUntil: "networkidle0", timeout: 10000 });

  // Type the PBO path and click Load
  await page.type("#file-path", pboPath);
  await page.click("#btn-load-pbo");

  // Wait for the map to load (watch for status updates)
  console.log("Loading map...");
  await page.waitForFunction(
    () => {
      const el = document.getElementById("status");
      return el && (el.textContent?.includes("Done!") || el.textContent?.includes("Error"));
    },
    { timeout: 120000 }
  );

  // Get status text
  const status = await page.$eval("#status", (el) => el.textContent);
  console.log("Status:", status);

  // Wait for rendering
  await new Promise((r) => setTimeout(r, 2000));

  await page.screenshot({ path: output });
  console.log(`Screenshot saved to ${output}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
