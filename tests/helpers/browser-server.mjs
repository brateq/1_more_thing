import { startServer, legacyCookie } from "./server.mjs";
import { visualThoughts } from "./visual-fixture.mjs";
import { rm } from "node:fs/promises";

const server = await startServer(null, { port: 3102 });
const result = await fetch(`${server.url}/api/thoughts/import`, {
  method: "POST", headers: { Cookie: legacyCookie(), "Content-Type": "application/json" },
  body: JSON.stringify({ thoughts: visualThoughts }),
});
if (!result.ok) throw new Error(`Could not seed browser fixture: ${await result.text()}`);
console.log("Browser fixture ready");
async function stop() { await server.stop(); await rm(server.directory, { recursive: true, force: true }); process.exit(); }
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
