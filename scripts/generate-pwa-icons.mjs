// Run after changing favicon.svg: node scripts/generate-pwa-icons.mjs
// Requires the existing Playwright Chromium installation; PNGs are committed.
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/favicon.svg", import.meta.url), "utf8");
const artwork = source.replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const directory = new URL("../public/icons/", import.meta.url);
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size, maskable] of [
    ["icon-192.png", 192, false],
    ["icon-512.png", 512, false],
    ["icon-maskable-512.png", 512, true],
    ["apple-touch-icon.png", 180, true],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    // Keep the artwork inside the central 80% circle on adaptive icons.
    const contents = maskable
      ? `<rect width="64" height="64" fill="#AFCFBE"/><g transform="translate(8 8) scale(.75)">${artwork}</g>`
      : artwork;
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">${contents}</svg>`);
    await page.screenshot({ path: new URL(name, directory).pathname, omitBackground: true });
  }
} finally {
  await browser.close();
}
