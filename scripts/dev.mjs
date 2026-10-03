import { spawn } from "node:child_process";

const children = [
  spawn("cargo", ["run", "--locked"], { stdio: "inherit", env: { ...process.env, HOST: "127.0.0.1", PORT: "3000" } }),
  spawn("npm", ["run", "dev:client"], { stdio: "inherit" }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  process.exitCode = code;
}
for (const child of children) {
  child.once("error", (error) => { console.error(error); stop(1); });
  child.once("exit", (code) => stop(code ?? 0));
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
