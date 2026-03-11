import puppeteer from "puppeteer";

const url = process.argv[2] || "http://localhost:5173";
const output = process.argv[3] || "screenshot.png";

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 10000 });
  // Wait a bit for Three.js to render
  await new Promise((r) => setTimeout(r, 1000));
  await page.screenshot({ path: output });
  console.log(`Screenshot saved to ${output}`);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
