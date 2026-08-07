import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("renders the finished And 1 more thing interface", async () => {
  const [layout, page] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /<html lang="pl">/i);
  assert.match(layout, /title:\s*"And 1 more thing"/);
  assert.match(page, /Co jeszcze chodzi Ci/);
  assert.match(page, /Zostaw tutaj/);
  assert.match(page, /Do przejrzenia/);
  assert.match(page, /Wszystkie/);
  assert.match(page, /Załatwione/);
  await access(new URL("../public/favicon.svg", import.meta.url));
  assert.doesNotMatch(`${layout}\n${page}`, /codex-preview|react-loading-skeleton/i);
});

test("supports automatic dark mode and clear capture feedback", async () => {
  const [page, styles] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(styles, /prefers-color-scheme:\s*dark/);
  assert.match(styles, /--accent:\s*#9bc5b0/i);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /@keyframes row-enter/);
  assert.match(styles, /@keyframes ambient-drift/);
  assert.match(styles, /@keyframes placeholder-cycle/);
  assert.match(styles, /@keyframes add-confirmation/);
  assert.match(page, /Intl\.RelativeTimeFormat\("pl-PL"/);
  assert.match(page, /THOUGHT_EXAMPLES/);
  assert.match(page, /Kupić chleb po pracy/);
  assert.match(page, /prefers-reduced-motion: reduce/);
  assert.match(page, /Dodane do poczekalni/);
  assert.match(page, /\/api\/thoughts/);
  assert.match(page, /sqlite-migrated/);
  assert.doesNotMatch(page, /Tu nic nie jest pilne|Jedno zdanie wystarczy/);
});
