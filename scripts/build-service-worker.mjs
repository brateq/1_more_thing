import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = "dist/client";
const files = ["index.html", "favicon.svg", "manifest.webmanifest"];
for (const folder of ["assets", "icons"]) {
  for (const name of (await readdir(join(directory, folder))).sort()) {
    if (!/\.(br|gz|map)$/.test(name)) files.push(`${folder}/${name}`);
  }
}
const template = await readFile("scripts/service-worker.js", "utf8");
const hash = createHash("sha256").update(template);
for (const file of files) hash.update(file).update(await readFile(join(directory, file)));
const assets = files.map(file => file === "index.html" ? "/" : `/${file}`);
await writeFile(join(directory, "sw.js"), template
  .replace("__CACHE_NAME__", JSON.stringify(`and1-shell-${hash.digest("hex").slice(0, 20)}`))
  .replace("__ASSETS__", JSON.stringify(assets)));
