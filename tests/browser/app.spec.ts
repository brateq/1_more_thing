import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

const secret = "migration-test-session-secret-1234567890";
const payload = "v1.4102444800000";
const cookie = `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;

for (const colorScheme of ["light", "dark"] as const) {
  for (const mobile of [false, true]) {
    test(`visual parity: ${colorScheme}, ${mobile ? "mobile" : "desktop"}`, async ({ page, context }) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await page.emulateMedia({ colorScheme });
      await page.clock.setFixedTime(new Date("2026-10-03T12:00:00Z"));
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Wejdź", exact: true })).toBeVisible();
      await expect(page).toHaveScreenshot(`${colorScheme}-${mobile ? "mobile" : "desktop"}-login.png`, { animations: "disabled" });
      await context.addCookies([{ name: "and1_session", value: cookie, url: new URL(page.url()).origin }]);
      await page.reload();
      await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
      for (const [view, label] of [["review", null], ["all", "Wszystkie"], ["done", "Załatwione"], ["stats", "Statystyki"]] as const) {
        if (label) {
          if (mobile) await page.getByRole("button", { name: "Otwórz menu" }).click();
          await page.getByRole("navigation").filter({ visible: true }).getByRole("button", { name: label, exact: false }).click();
        }
        await expect(page).toHaveScreenshot(`${colorScheme}-${mobile ? "mobile" : "desktop"}-${view}.png`, { animations: "disabled" });
      }
    });
  }
}

test("login, capture, edit, defer, complete, undo, restore, delete and offline reload", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Hasło").fill("migration-test-password-123");
  await page.getByRole("button", { name: "Wejdź", exact: true }).click();
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
  const input = page.getByLabel("Myśl do zapisania");
  await input.fill("Test interakcji");
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "Edytuj zadanie: Test interakcji", exact: true })).toBeVisible();
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edytuj zadanie: Test interakcji", exact: true }).click();
  await page.getByLabel("Edytuj treść zadania").fill("Poprawiony test");
  await page.getByLabel("Edytuj treść zadania").press("Enter");
  let card = page.locator("article").filter({ hasText: "Poprawiony test" });
  await card.getByRole("button", { name: "Nie teraz" }).click();
  await card.getByRole("button", { name: "Załatwione" }).click();
  await page.getByRole("button", { name: "Cofnij", exact: true }).click();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Załatwione" }).click();
  await page.locator(".desktop-nav").getByRole("button", { name: "Załatwione" }).click();
  await page.locator("article").filter({ hasText: "Poprawiony test" }).getByRole("button", { name: "Przywróć" }).click();
  await page.locator(".desktop-nav").getByRole("button", { name: "Wszystkie" }).click();
  await page.locator("article").filter({ hasText: "Poprawiony test" }).getByRole("button", { name: "Usuń", exact: true }).click();
  await page.getByRole("button", { name: "Usuń na dobre" }).click();
  await expect(page.locator("article").filter({ hasText: "Poprawiony test" })).toHaveCount(0);
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();

  await context.setOffline(true);
  await input.fill("Myśl offline");
  await input.press("Enter");
  await input.fill("Szkic po odświeżeniu");
  await expect(page.getByText(/Zapisane na tym urządzeniu/)).toBeVisible();
  const pending = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("and-1-more-thing:outbox:v1:")));
  expect(pending).toHaveLength(1);
  await context.setOffline(false);
  await page.reload();
  await expect(input).toHaveValue("Szkic po odświeżeniu");
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edytuj zadanie: Myśl offline", exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("and-1-more-thing:outbox:v1:")))).toHaveLength(0);
  expect(errors).toEqual([]);
});
