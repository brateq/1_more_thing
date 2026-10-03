import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { legacyCookie, password, secret, startServer } from "./helpers/server.mjs";

const thought = {
  id: "legacy/zażółć 😃", text: "Myśl zapisana przed migracją 😃", status: "active",
  createdAt: "2026-08-07T10:05:12.123Z", lastPresentedAt: null, completedAt: null,
};
const path = `/api/thoughts/${encodeURIComponent(thought.id)}`;
const fingerprint = (method, path, value) => createHash("sha256")
  .update(JSON.stringify([method, path, value])).digest("hex");

async function legacyDatabase(version = 2) {
  const directory = await mkdtemp(join(tmpdir(), "and1-legacy-"));
  const db = new DatabaseSync(join(directory, "and1.db"));
  db.exec("CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
  const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
  for (const entry of journal.entries.slice(0, version)) {
    const sql = await readFile(`drizzle/${entry.tag}.sql`, "utf8");
    db.exec(sql);
    db.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
      .run(createHash("sha256").update(sql).digest("hex"), entry.when);
  }
  db.prepare("INSERT INTO thoughts VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(thought.id, thought.text, thought.status, Date.parse(thought.createdAt), null, null, 1786097112123);
  return { directory, db };
}

test("opens production schema, preserves Drizzle history, Node sessions and old mutation receipts", async (t) => {
  const { directory, db } = await legacyDatabase();
  const journalBefore = db.prepare("SELECT * FROM __drizzle_migrations").all();
  const rowBefore = db.prepare("SELECT * FROM thoughts").get();
  // Order, UTF-8, numbers, integer keys, trim and dates matter to old fingerprints.
  const patch = JSON.parse('{"text":"  Dawna treść 😃  ","completedAt":null,"ignored":1e-7,"10":2,"2":-0,"large":1e21}');
  for (const [key, method, url, payload, status, body] of [
    ["old-create", "POST", "/api/thoughts", thought, 201, { thought }],
    ["old-edit", "PATCH", path, patch, 200, { thought: { ...thought, text: "Dawna treść 😃" } }],
    ["old-delete", "DELETE", path, null, 204, null],
  ]) db.prepare("INSERT INTO mutation_receipts VALUES (?, ?, ?, ?)")
    .run(key, fingerprint(method, url, payload), status, body ? JSON.stringify(body) : null);
  db.close();
  const server = await startServer(t, { directory });
  const headers = { Cookie: legacyCookie(), "Content-Type": "application/json" };
  const session = await fetch(`${server.url}/api/auth/session`, { headers });
  assert.deepEqual(await session.json(), { authenticated: true, configured: true });
  const list = await fetch(`${server.url}/api/thoughts`, { headers });
  assert.deepEqual(await list.json(), { thoughts: [thought] });
  for (const [key, method, url, payload, status] of [
    ["old-create", "POST", "/api/thoughts", { thought }, 201],
    ["old-edit", "PATCH", path, patch, 200],
    ["old-delete", "DELETE", path, undefined, 204],
  ]) {
    const response = await fetch(server.url + url, { method, headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(payload) });
    assert.equal(response.status, status, await response.text());
  }
  const collision = await fetch(server.url + path, { method: "PATCH", headers: { ...headers, "Idempotency-Key": "old-edit" }, body: JSON.stringify({ text: "Nowa operacja" }) });
  assert.equal(collision.status, 409);
  await server.stop();
  const after = new DatabaseSync(join(directory, "and1.db"));
  assert.deepEqual(after.prepare("SELECT * FROM __drizzle_migrations").all(), journalBefore);
  assert.deepEqual(after.prepare("SELECT * FROM thoughts").get(), rowBefore, "replay must never overwrite newer data");
  assert.equal(after.prepare("SELECT count(*) AS count FROM mutation_receipts").get().count, 3);
  after.close();
});

test("upgrades a database predating the offline queue without rewriting its thoughts", async (t) => {
  const { directory, db } = await legacyDatabase(1);
  db.close();
  const server = await startServer(t, { directory });
  const response = await fetch(`${server.url}/api/thoughts`, { headers: { Cookie: legacyCookie() } });
  assert.deepEqual(await response.json(), { thoughts: [thought] });
  await server.stop();
  const after = new DatabaseSync(join(directory, "and1.db"));
  assert.equal(after.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get().count, 2);
  assert.equal(after.prepare("SELECT count(*) AS count FROM mutation_receipts").get().count, 0);
  after.close();
});

test("keeps the Node password and cookie formats in both directions", async (t) => {
  const server = await startServer(t);
  const login = await fetch(`${server.url}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https" }, body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=2592000; Secure/);
  const [version, expires, signature] = cookie.split(";")[0].split("=")[1].split(".");
  assert.equal(signature, createHmac("sha256", secret).update(`${version}.${expires}`).digest("base64url"));
  for (const Cookie of [legacyCookie(1), legacyCookie() + "tampered"]) {
    const response = await fetch(`${server.url}/api/thoughts`, { headers: { Cookie } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const hash = spawnSync("target/release/and1", ["hash-password", password], { encoding: "utf8" });
  assert.equal(hash.status, 0);
  const { scryptSync } = await import("node:crypto");
  const [algorithm, salt, expected] = hash.stdout.trim().split(".");
  assert.equal(algorithm, "scrypt");
  assert.equal(scryptSync(password, Buffer.from(salt, "base64url"), 64).toString("base64url"), expected);
});

test("concurrent retries commit one receipt, survive restart, and do not undo subsequent edits", async (t) => {
  let server = await startServer(t);
  const headers = { Cookie: legacyCookie(), "Content-Type": "application/json", "Idempotency-Key": "concurrent" };
  const responses = await Promise.all(Array.from({ length: 20 }, () => fetch(`${server.url}/api/thoughts`, { method: "POST", headers, body: JSON.stringify({ thought }) })));
  assert.deepEqual(responses.map((r) => r.status), Array(20).fill(201));
  await fetch(server.url + path, { method: "PATCH", headers: { ...headers, "Idempotency-Key": "next" }, body: JSON.stringify({ text: "Nowsza treść" }) });
  await server.stop();
  server = await startServer(null, { directory: server.directory });
  t.after(server.stop);
  const replay = await fetch(`${server.url}/api/thoughts`, { method: "POST", headers, body: JSON.stringify({ thought }) });
  assert.equal(replay.status, 201);
  const result = await fetch(`${server.url}/api/thoughts`, { headers });
  assert.equal((await result.json()).thoughts[0].text, "Nowsza treść");
  await server.stop();
});

test("serves compressed immutable assets, fresh HTML and JSON errors with correct status", async (t) => {
  const { url } = await startServer(t);
  const html = await fetch(url);
  assert.equal(html.headers.get("cache-control"), "no-cache");
  assert.equal(html.headers.get("vary"), "Accept-Encoding");
  const source = await html.text();
  const asset = source.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
  for (const encoding of ["br", "gzip", "identity"]) {
    const response = await fetch(url + asset, { headers: { "Accept-Encoding": encoding } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /immutable/);
    assert.equal(response.headers.get("vary"), "Accept-Encoding");
    assert.equal(response.headers.get("content-encoding"), encoding === "identity" ? null : encoding);
    assert.ok((await response.text()).length > 100);
  }
  assert.equal((await fetch(`${url}/missing.js`)).status, 404);
  assert.equal((await fetch(`${url}/assets/missing.js`)).status, 404);
  const headers = { Cookie: legacyCookie(), "Content-Type": "application/json" };
  for (const [payload, error] of [[null, "invalid_request"], [[], "invalid_request"], [{}, "empty_update"], [{ text: "😃".repeat(141) }, "invalid_text"], [{ status: "unknown" }, "invalid_status"], [{ completedAt: "not-a-date" }, "invalid_date"]]) {
    const response = await fetch(url + path, { method: "PATCH", headers, body: JSON.stringify(payload) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error });
  }
  const malformed = await fetch(`${url}/api/thoughts`, { method: "POST", headers, body: "{" });
  assert.equal(malformed.status, 400);
  const invalidKey = await fetch(`${url}/api/thoughts`, { method: "POST", headers: { ...headers, "Idempotency-Key": "bad key" }, body: JSON.stringify({ thought }) });
  assert.equal(invalidKey.status, 400);
});

test("imports 2000 legacy entries transactionally and never overwrites existing IDs", async (t) => {
  const { url } = await startServer(t);
  const headers = { Cookie: legacyCookie(), "Content-Type": "application/json" };
  const thoughts = Array.from({ length: 2000 }, (_, i) => ({ ...thought, id: `import-${i}` }));
  for (const [values, count] of [[thoughts, 2000], [thoughts.map(t => ({ ...t, text: "overwrite" })), 0]]) {
    const response = await fetch(`${url}/api/thoughts/import`, { method: "POST", headers, body: JSON.stringify({ thoughts: values }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { imported: count });
  }
  const invalid = await fetch(`${url}/api/thoughts/import`, { method: "POST", headers, body: JSON.stringify({ thoughts: [{ ...thought, id: "partial" }, {}] }) });
  assert.equal(invalid.status, 400);
  const list = (await (await fetch(`${url}/api/thoughts`, { headers })).json()).thoughts;
  assert.equal(list.length, 2000);
  assert.ok(list.every(t => t.text === thought.text));
});

test("rate limits concurrent login failures and refuses access without configuration", async (t) => {
  const { url } = await startServer(t);
  const responses = await Promise.all(Array.from({ length: 9 }, () => fetch(`${url}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "wrong-password" }),
  })));
  assert.equal(responses.filter(r => r.status === 401).length, 8);
  assert.equal(responses.filter(r => r.status === 429).length, 1);
  assert.equal(responses.find(r => r.status === 429).headers.get("retry-after"), "900");
  const unconfigured = await startServer(t, { env: { SESSION_SECRET: "", AUTH_PASSWORD_HASH: "" } });
  assert.deepEqual(await (await fetch(`${unconfigured.url}/api/auth/session`)).json(), { authenticated: false, configured: false });
  const login = await fetch(`${unconfigured.url}/api/auth/login`, { method: "POST", body: "{}" });
  assert.equal(login.status, 503);
});

test("writes fingerprints and receipts that the old Node server can replay", async (t) => {
  const server = await startServer(t);
  const headers = { Cookie: legacyCookie(), "Content-Type": "application/json", "Idempotency-Key": "new-create" };
  const response = await fetch(`${server.url}/api/thoughts`, { method: "POST", headers, body: JSON.stringify({ thought }) });
  assert.equal(response.status, 201);
  const patch = { text: "Kolejna treść 😃", completedAt: null, ignored: 1e-7 };
  const update = await fetch(server.url + path, { method: "PATCH", headers: { ...headers, "Idempotency-Key": "new-edit" }, body: JSON.stringify(patch) });
  assert.equal(update.status, 200);
  await server.stop();
  const db = new DatabaseSync(join(server.directory, "and1.db"));
  for (const [key, method, url, payload] of [["new-create", "POST", "/api/thoughts", thought], ["new-edit", "PATCH", path, patch]]) {
    const receipt = db.prepare("SELECT * FROM mutation_receipts WHERE id=?").get(key);
    assert.equal(receipt.fingerprint, fingerprint(method, url, payload));
    assert.equal(JSON.parse(receipt.body).thought.id, thought.id);
  }
  db.close();
});
