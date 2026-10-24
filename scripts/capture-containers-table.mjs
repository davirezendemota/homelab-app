import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const baseUrl = process.env.MOCK_URL ?? "http://127.0.0.1:10003";
const outDir = path.join(root, "docs", "screenshots");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 1,
});

await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 120_000 });
await page.waitForSelector(".dashboard-panel--containers .container-table", {
  timeout: 60_000,
});
await page.locator('[data-sort="name"]').click();
await page.waitForSelector(".flat-list.container-table-scroll .container-table", {
  timeout: 30_000,
});
await page.waitForTimeout(600);

const table = page.locator(".flat-list.container-table-scroll .container-table").first();
const heads = table.locator(".ct-head .ct-th");
const cells = table.locator(".ct-data").first().locator(".ct-cell");
const n = await heads.count();
let maxDx = 0;
for (let i = 0; i < n; i++) {
  const h = await heads.nth(i).boundingBox();
  const c = await cells.nth(i).boundingBox();
  const dx = Math.abs((c?.x ?? 0) - (h?.x ?? 0));
  const dw = Math.abs((c?.width ?? 0) - (h?.width ?? 0));
  maxDx = Math.max(maxDx, dx, dw);
  if (dx > 1 || dw > 1) {
    console.warn(`col ${i}: dx=${dx.toFixed(2)} dw=${dw.toFixed(2)}`);
  }
}
if (maxDx > 1) {
  throw new Error(`Colunas desalinhadas (max delta ${maxDx.toFixed(2)}px)`);
}

await mkdir(outDir, { recursive: true });
await table.screenshot({ path: path.join(outDir, "containers-table.png") });
await page
  .locator(".flat-list.container-table-scroll")
  .screenshot({ path: path.join(outDir, "containers-flat-list.png") });
await page
  .locator(".dashboard-panel--containers")
  .screenshot({ path: path.join(outDir, "containers-panel.png") });

await browser.close();
console.log(`OK — colunas alinhadas (max delta ${maxDx.toFixed(2)}px)`);
console.log(`Screenshots: ${outDir}/containers-table.png`);
