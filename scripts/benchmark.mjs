import http from "node:http";
import { performance } from "node:perf_hooks";
import { rm } from "node:fs/promises";
import { startServer, legacyCookie } from "../tests/helpers/server.mjs";

// No production URL by default: benchmark an isolated temporary database.
const server = process.env.BENCH_URL ? null : await startServer(null);
const base = process.env.BENCH_URL ?? server.url;
const cookie = process.env.BENCH_COOKIE ?? legacyCookie();
const requests = Number(process.env.BENCH_REQUESTS ?? 2000);
const concurrency = Number(process.env.BENCH_CONCURRENCY ?? 16);
if (server) {
  const thoughts = Array.from({ length: 1000 }, (_, id) => ({
    id: `bench-${id}`, text: `Myśl numer ${id}`, status: "active",
    createdAt: "2026-09-01T10:00:00.000Z", lastPresentedAt: null, completedAt: null,
  }));
  const result = await fetch(`${base}/api/thoughts/import`, { method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ thoughts }) });
  if (!result.ok) throw new Error(await result.text());
}
const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
async function run(path, count) {
  const samples = [];
  let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next++ < count) {
      const before = performance.now();
      await new Promise((resolve, reject) => {
        const request = http.get(new URL(path, base), { agent, headers: { Cookie: cookie } }, response => {
          if (response.statusCode !== 200) reject(new Error(`HTTP ${response.statusCode}`));
          response.resume();
          response.once("end", resolve);
          response.once("error", reject);
        });
        request.once("error", reject);
      });
      samples.push(performance.now() - before);
    }
  }));
  const elapsed = performance.now() - start;
  samples.sort((a, b) => a - b);
  return { path, requests: count, concurrency, requestsPerSecond: Math.round(count / elapsed * 1000),
    p50Ms: +samples[Math.floor(count * .5)].toFixed(2), p95Ms: +samples[Math.floor(count * .95)].toFixed(2) };
}
try {
  const results = [];
  for (const path of ["/", "/api/auth/session", "/api/thoughts"]) {
    await run(path, 200);
    results.push(await run(path, requests));
  }
  console.log(JSON.stringify({ base, results }, null, 2));
} finally {
  agent.destroy();
  if (server) { await server.stop(); await rm(server.directory, { recursive: true, force: true }); }
}
