import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function createPasswordHash(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitForServer(url, processOutput) {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // The standalone server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Standalone server did not start.\n${processOutput()}`);
}

test("persists and protects synchronized thoughts in standalone mode", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "and1-sync-"));
  const port = await availablePort();
  const password = "test-password-123";
  let output = "";

  const server = spawn(resolve("target/release/and1"), [], {
    cwd: resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      DATABASE_PATH: join(directory, "and1.db"),
      MIGRATIONS_PATH: resolve("drizzle"),
      AUTH_PASSWORD_HASH: createPasswordHash(password),
      SESSION_SECRET: "integration-test-session-secret-1234567890",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => (output += chunk.toString()));
  server.stderr.on("data", (chunk) => (output += chunk.toString()));

  t.after(async () => {
    if (server.exitCode === null) server.kill("SIGTERM");
    await rm(directory, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, () => output);

  const home = await fetch(baseUrl);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>1 more thing<\/title>/);

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok" });

  const unauthorized = await fetch(`${baseUrl}/api/thoughts`);
  assert.equal(unauthorized.status, 401);

  const invalidLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong-password" }),
  });
  assert.equal(invalidLogin.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);

  const thought = {
    id: "sync-test-thought",
    text: "Sprawdzić synchronizację",
    status: "active",
    createdAt: new Date().toISOString(),
    lastPresentedAt: null,
    completedAt: null,
  };
  const created = await fetch(`${baseUrl}/api/thoughts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": "create-test" },
    body: JSON.stringify({ thought }),
  });
  assert.equal(created.status, 201, await created.text());

  const completedAt = new Date().toISOString();
  const updated = await fetch(`${baseUrl}/api/thoughts/${thought.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": "complete-test" },
    body: JSON.stringify({ status: "done", completedAt }),
  });
  assert.equal(updated.status, 200, await updated.text());

  const list = await fetch(`${baseUrl}/api/thoughts`, {
    headers: { Cookie: cookie },
  });
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.thoughts.length, 1);
  assert.equal(body.thoughts[0].status, "done");

  const replayCreate = await fetch(`${baseUrl}/api/thoughts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": "create-test" },
    body: JSON.stringify({ thought }),
  });
  assert.equal(replayCreate.status, 201);
  const collision = await fetch(`${baseUrl}/api/thoughts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": "create-test" },
    body: JSON.stringify({ thought: { ...thought, text: "Different operation" } }),
  });
  assert.equal(collision.status, 409);

  const restored = await fetch(`${baseUrl}/api/thoughts/${thought.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ status: "active", completedAt: null }),
  });
  assert.equal(restored.status, 200);
  const replayComplete = await fetch(`${baseUrl}/api/thoughts/${thought.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie, "Idempotency-Key": "complete-test" },
    body: JSON.stringify({ status: "done", completedAt }),
  });
  assert.equal(replayComplete.status, 200);
  const afterReplay = await fetch(`${baseUrl}/api/thoughts`, { headers: { Cookie: cookie } });
  const replayBody = await afterReplay.json();
  assert.equal(replayBody.thoughts.length, 1);
  assert.equal(replayBody.thoughts[0].status, "active", "an old retry must not overwrite a later change");

  const deleted = await fetch(`${baseUrl}/api/thoughts/${thought.id}`, {
    method: "DELETE",
    headers: { Cookie: cookie, "Idempotency-Key": "delete-test" },
  });
  assert.equal(deleted.status, 204);
  const replayDelete = await fetch(`${baseUrl}/api/thoughts/${thought.id}`, {
    method: "DELETE",
    headers: { Cookie: cookie, "Idempotency-Key": "delete-test" },
  });
  assert.equal(replayDelete.status, 204);
});
