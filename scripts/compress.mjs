import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

// Pay compression cost once at build time; Rust serves the negotiated bytes.
async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compress(path);
    else if (/\.(html|js|css|svg)$/.test(entry.name)) {
      const bytes = await readFile(path);
      await Promise.all([
        writeFile(`${path}.gz`, gzipSync(bytes, { level: 9 })),
        writeFile(`${path}.br`, brotliCompressSync(bytes, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
        })),
      ]);
    }
  }
}
await compress("dist/client");
