import assert from "node:assert/strict";
import test from "node:test";
import { startServer } from "./helpers/server.mjs";

test("serves a revalidated worker that precaches only the current public build", async (t) => {
  const { url } = await startServer(t);
  const response = await fetch(`${url}/sw.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /javascript/);
  assert.equal(response.headers.get("cache-control"), "no-cache");
  const worker = await response.text();
  const assets = JSON.parse(worker.match(/const ASSETS = (.*);/)[1]);
  assert.ok(assets.includes("/"));
  assert.ok(assets.some(path => /^\/assets\/.*\.js$/.test(path)));
  assert.ok(assets.some(path => /^\/assets\/.*\.css$/.test(path)));
  assert.ok(assets.every(path => !path.startsWith("/api")));
  for (const path of assets) assert.equal((await fetch(url + path)).status, 200, path);
});

test("serves an installable manifest and correctly sized icons without requiring login", async (t) => {
  const { url } = await startServer(t);
  const html = await (await fetch(url)).text();
  const manifestPath = html.match(/rel="manifest" href="([^"]+)"/)[1];
  const response = await fetch(url + manifestPath);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/manifest\+json/);
  assert.equal(response.headers.get("cache-control"), "no-cache");
  const manifest = await response.json();
  assert.equal(manifest.name, "1 more thing");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal((await fetch(new URL(manifest.start_url, url))).status, 200);
  assert.ok(manifest.icons.some(icon => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons.some(icon => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(manifest.icons.some(icon => icon.purpose === "maskable"));
  const appleIcon = html.match(/rel="apple-touch-icon" sizes="180x180" href="([^"]+)"/)[1];
  for (const icon of [...manifest.icons, { src: appleIcon, sizes: "180x180" }]) {
    const image = await fetch(url + icon.src);
    assert.equal(image.status, 200, icon.src);
    assert.match(image.headers.get("content-type"), /image\/png/);
    assert.equal(image.headers.get("cache-control"), "no-cache");
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  assert.equal((await fetch(url + "/icons/missing.png")).status, 404);
});
