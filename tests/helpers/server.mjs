import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes, scryptSync, createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const password = "migration-test-password-123";
export const secret = "migration-test-session-secret-1234567890";
export function passwordHash() {
  const salt = randomBytes(16);
  return `scrypt.${salt.toString("base64url")}.${scryptSync(password, salt, 64).toString("base64url")}`;
}
export function legacyCookie(expires = Date.now() + 60_000) {
  const payload = `v1.${expires}`;
  return `and1_session=${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
export async function availablePort() {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
export async function startServer(t, { directory, port, env = {} } = {}) {
  directory ??= await mkdtemp(join(tmpdir(), "and1-rust-"));
  port ??= await availablePort();
  let output = "";
  const child = spawn(resolve("target/release/and1"), [], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port),
      DATABASE_PATH: join(directory, "and1.db"), STATIC_DIR: resolve("dist/client"),
      AUTH_PASSWORD_HASH: passwordHash(), SESSION_SECRET: secret, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output += chunk);
  child.stderr.on("data", (chunk) => output += chunk);
  await once(child, "spawn");
  let cleaned = false;
  async function stop() {
    if (cleaned) return;
    cleaned = true;
    if (child.exitCode === null) {
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
    }
  }
  t?.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${port}`;
  for (let count = 0; count < 100; count++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output}`);
    try { if ((await fetch(`${url}/health`)).ok) return { url, directory, child, stop }; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await stop();
  throw new Error(`Server did not start: ${output}`);
}
