import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

const payload = "v1.4102444800000";
const cookie = `${payload}.${createHmac("sha256", "migration-test-session-secret-1234567890").update(payload).digest("base64url")}`;
const pendingIcon = (page: Page) => page.locator(".sync-status").getByRole("img", { name: "Oczekuje na synchronizację" });
const outboxSize = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("and-1-more-thing:outbox:v1:")).length);

async function ready(page: Page) {
  await page.context().addCookies([{ name: "and1_session", value: cookie, url: test.info().project.use.baseURL! }]);
  await page.goto("/");
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
}

async function capture(page: Page, text: string) {
  await page.getByRole("button", { name: "Dodaj myśl", exact: true }).click();
  await page.getByLabel("Myśl do zapisania").fill(text);
  await page.getByLabel("Myśl do zapisania").press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function showAll(page: Page) {
  await page.locator(".desktop-nav").getByRole("button", { name: "Wszystkie" }).click();
}

test("opens a new offline window, preserves edits and drafts, then clears pending icons after syncing", async ({ page, context }, testInfo) => {
  await ready(page);
  await capture(page, "Offline: zapis przed rozłączeniem");
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".sync-status").getByRole("img", { name: "Brak połączenia" })).toBeVisible();
  await showAll(page);
  const existing = page.locator("article").filter({ hasText: "Offline: zapis przed rozłączeniem" });
  await existing.getByRole("button", { name: "Edytuj", exact: true }).click();
  await page.getByLabel("Edytuj treść zadania").fill("Offline: poprawiona myśl");
  await page.getByLabel("Edytuj treść zadania").press("Enter");
  await capture(page, "Offline: zupełnie nowa myśl");
  await page.getByRole("button", { name: "Dodaj myśl", exact: true }).click();
  await page.getByLabel("Myśl do zapisania").fill("Szkic zapisany offline");
  await page.keyboard.press("Escape");
  await expect(pendingIcon(page)).toBeVisible();
  await expect.poll(() => outboxSize(page)).toBe(2);
  await page.close();

  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(pendingIcon(reopened)).toBeVisible();
  await expect(reopened.getByLabel("Myśl do zapisania")).toHaveCount(0);
  await reopened.getByRole("button", { name: "Dodaj myśl", exact: true }).click();
  await expect(reopened.getByLabel("Myśl do zapisania")).toBeFocused();
  await expect(reopened.getByLabel("Myśl do zapisania")).toHaveValue("Szkic zapisany offline");
  await reopened.keyboard.press("Escape");
  await showAll(reopened);
  for (const text of ["Offline: poprawiona myśl", "Offline: zupełnie nowa myśl"]) {
    await expect(reopened.locator("article").filter({ hasText: text }).getByRole("img", { name: "Oczekuje na synchronizację" })).toBeVisible();
  }
  await reopened.screenshot({ path: testInfo.outputPath("offline-desktop.png") });
  await reopened.setViewportSize({ width: 390, height: 844 });
  await reopened.emulateMedia({ colorScheme: "dark" });
  await expect(pendingIcon(reopened)).toBeVisible();
  expect(await reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reopened.screenshot({ path: testInfo.outputPath("offline-mobile-dark.png") });

  await context.setOffline(false);
  await expect(reopened.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
  await expect(reopened.getByRole("img", { name: "Oczekuje na synchronizację" })).toHaveCount(0);
  await expect.poll(() => outboxSize(reopened)).toBe(0);
  const saved = await (await context.request.get("/api/thoughts")).json();
  expect(saved.thoughts.filter((thought: { text: string }) => thought.text === "Offline: zupełnie nowa myśl")).toHaveLength(1);
  expect(saved.thoughts.some((thought: { text: string }) => thought.text === "Offline: poprawiona myśl")).toBe(true);
  const cachedUrls = await reopened.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat());
  expect(cachedUrls.some(url => new URL(url).pathname.startsWith("/api/"))).toBe(false);
});

test("falls back to saved data when the server is unreachable despite an online connection", async ({ page, context }) => {
  await ready(page);
  await context.route("**/api/**", route => route.abort("failed"));
  await page.reload();
  await expect(page.getByText("Pokazuję zapisane dane. Czekam na synchronizację.")).toBeVisible();
  await expect(pendingIcon(page)).toBeVisible();
  await capture(page, "Offline: serwer niedostępny");
  await expect.poll(() => outboxSize(page)).toBe(1);
  await expect(page.getByText("Zapisane na tym urządzeniu. Czeka na synchronizację: 1.", { exact: true })).toBeVisible();
  await context.unroute("**/api/**");
  await page.getByRole("button", { name: "Spróbuj teraz" }).click();
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
});

test("keeps completion and deletion offline, including the pending icon when no row remains", async ({ page, context }) => {
  await ready(page);
  await context.setOffline(true);
  await capture(page, "Offline: załatw i usuń");
  await showAll(page);
  const row = page.locator("article").filter({ hasText: "Offline: załatw i usuń" });
  await row.getByRole("button", { name: "Załatwione" }).click();
  await page.reload();
  await page.locator(".desktop-nav").getByRole("button", { name: "Załatwione" }).click();
  await expect(row.getByRole("img", { name: "Oczekuje na synchronizację" })).toBeVisible();
  await row.getByRole("button", { name: "Przywróć" }).click();
  await showAll(page);
  await row.getByRole("button", { name: "Usuń", exact: true }).click();
  await page.getByRole("button", { name: "Usuń na dobre" }).click();
  await page.reload();
  await showAll(page);
  await expect(row).toHaveCount(0);
  await expect(pendingIcon(page)).toBeVisible();
  expect(await outboxSize(page)).toBe(4);
  await context.setOffline(false);
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
  await expect(pendingIcon(page)).toHaveCount(0);
  const saved = await (await context.request.get("/api/thoughts")).json();
  expect(saved.thoughts.some((thought: { text: string }) => thought.text === "Offline: załatw i usuń")).toBe(false);
});

test("keeps acknowledged changes in the offline snapshot even if the following GET fails", async ({ page, context }) => {
  await ready(page);
  await context.route("**/api/thoughts", route => route.request().method() === "GET" ? route.abort("failed") : route.continue());
  await capture(page, "Offline: potwierdzone przed awarią");
  await expect.poll(() => outboxSize(page)).toBe(0);
  await expect(page.getByText("Pokazuję zapisane dane. Czekam na synchronizację.")).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await showAll(page);
  const saved = page.locator("article").filter({ hasText: "Offline: potwierdzone przed awarią" });
  await expect(saved).toBeVisible();
  await expect(saved.getByRole("img", { name: "Oczekuje na synchronizację" })).toHaveCount(0);
});

test("requires login after session expiry and keeps offline changes until reauthentication", async ({ page, context }) => {
  await ready(page);
  await context.setOffline(true);
  await capture(page, "Offline: sesja wygasła");
  await context.clearCookies();
  await page.reload();
  await expect(pendingIcon(page)).toBeVisible();
  await context.setOffline(false);
  // Reconnecting immediately after an offline reload can use the 15-second retry.
  await expect(page.getByLabel("Hasło")).toBeVisible({ timeout: 20_000 });
  expect(await outboxSize(page)).toBe(1);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel("Hasło")).toBeVisible();
  await expect(page.getByLabel("Myśl do zapisania")).toHaveCount(0);
  await context.setOffline(false);
  await page.getByLabel("Hasło").fill("migration-test-password-123");
  await page.getByRole("button", { name: "Wejdź", exact: true }).click();
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
  expect(await outboxSize(page)).toBe(0);
  await showAll(page);
  await expect(page.locator("article").filter({ hasText: "Offline: sesja wygasła" })).toBeVisible();
});

test("offline logout locks other windows and remains locked when an old cookie survives", async ({ page, context }) => {
  await ready(page);
  await context.setOffline(true);
  await capture(page, "Offline: zachowaj po wylogowaniu");
  const other = await context.newPage();
  await other.goto("/");
  await expect(pendingIcon(other)).toBeVisible();
  await page.getByRole("button", { name: "Wyloguj", exact: true }).click();
  await expect(page.getByLabel("Hasło")).toBeVisible();
  await expect(other.getByLabel("Hasło")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Hasło")).toBeVisible();
  expect(await outboxSize(page)).toBe(1);
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByLabel("Hasło")).toBeVisible();
  await page.getByLabel("Hasło").fill("migration-test-password-123");
  await page.getByRole("button", { name: "Wejdź", exact: true }).click();
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
});

test("a cached app shell without a prior login does not expose a list offline", async ({ page, context }) => {
  await page.goto("/");
  await expect(page.getByLabel("Hasło")).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Połącz się, żeby zacząć.")).toBeVisible();
  await expect(page.getByLabel("Myśl do zapisania")).toHaveCount(0);
});
