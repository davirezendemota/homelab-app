import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const baseUrl = process.env.MOCK_URL ?? "http://127.0.0.1:10003";
const outDir = path.join(root, "docs", "screenshots");
const outFile = path.join(outDir, "dashboard-mock-desktop.png");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});

await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForSelector(".dashboard-panel--containers .row", {
  timeout: 60_000,
});
await page.waitForSelector(".dashboard-panel--meters .meter", {
  timeout: 60_000,
});
await page.waitForTimeout(1500);

await mkdir(outDir, { recursive: true });
await page.screenshot({ path: outFile, fullPage: true });
await browser.close();

console.log(`Screenshot saved: ${outFile}`);
