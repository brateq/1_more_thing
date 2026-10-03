import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { availablePort, legacyCookie, passwordHash, secret } from "./helpers/server.mjs";

const image = process.env.AND1_TEST_IMAGE ?? "and1:test";
const name = `and1-migration-test-${process.pid}`;
const directory = await mkdtemp(join(tmpdir(), "and1-container-"));
const volume = `${name}-data`;
const port = await availablePort();
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Docker failed");
  return result.stdout.trim();
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(docker(["logs", name]));
}
try {
  const db = new DatabaseSync(join(directory, "and1.db"));
  db.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(createHash("sha256").update(sql).digest("hex"), entry.when);
  }
  db.prepare("INSERT INTO thoughts VALUES (?, ?, ?, ?, ?, ?, ?)").run("legacy-container", "Myśl z poprzedniej wersji", "active", 1786097112123, null, null, 1786097112123);
  db.close();
  docker(["volume", "create", volume]);
  docker(["run", "--rm", "--user", "0", "--entrypoint", "sh", "-v", `${volume}:/app/data`, "-v", `${directory}:/fixture:ro`, image,
    "-c", "cp /fixture/and1.db /app/data/and1.db && chown 1000:1000 /app/data/and1.db"]);
  docker(["run", "-d", "--name", name, "-p", `127.0.0.1:${port}:3000`, "-v", `${volume}:/app/data`,
    "-e", `AUTH_PASSWORD_HASH=${passwordHash()}`, "-e", `SESSION_SECRET=${secret}`, image]);
  await ready();
  assert.equal(docker(["exec", name, "id", "-u"]), "1000");
  docker(["exec", name, "and1", "healthcheck"]);
  const url = `http://127.0.0.1:${port}`;
  const headers = { Cookie: legacyCookie(), "Content-Type": "application/json" };
  const list = await (await fetch(`${url}/api/thoughts`, { headers })).json();
  assert.equal(list.thoughts[0].text, "Myśl z poprzedniej wersji");
  const update = await fetch(`${url}/api/thoughts/legacy-container`, { method: "PATCH", headers, body: JSON.stringify({ text: "Zapis z kontenera Rust" }) });
  assert.equal(update.status, 200);
  const html = await fetch(url);
  const asset = (await html.text()).match(/src="(\/assets\/[^\"]+\.js)"/)[1];
  const javascript = await fetch(url + asset, { headers: { "Accept-Encoding": "br" } });
  assert.equal(javascript.status, 200);
  assert.equal(javascript.headers.get("content-encoding"), "br");
  assert.equal(javascript.headers.get("vary"), "Accept-Encoding");
  docker(["restart", name]);
  await ready();
  const after = await (await fetch(`${url}/api/thoughts`, { headers })).json();
  assert.equal(after.thoughts[0].text, "Zapis z kontenera Rust");
  console.log("Docker: legacy volume, UID 1000, old session, durable write, restart, healthcheck and Brotli passed.");
} finally {
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  spawnSync("docker", ["volume", "rm", volume], { stdio: "ignore" });
  await rm(directory, { recursive: true, force: true });
}
