import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("renders the finished And 1 more thing interface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="pl">/i);
  assert.match(html, /<title>And 1 more thing/);
  assert.match(html, /Co jeszcze chodzi Ci/);
  assert.match(html, /Zostaw tutaj/);
  assert.match(html, /Do przejrzenia/);
  assert.match(html, /Wszystkie myśli/);
  assert.match(html, /Załatwione/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
