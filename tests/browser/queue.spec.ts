import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

const payload = "v1.4102444800000";
const cookie = `${payload}.${createHmac("sha256", "migration-test-session-secret-1234567890").update(payload).digest("base64url")}`;
const tasks = [
  "Sprawdzić, czy OC jest opłacone",
  "Kupić chleb po pracy",
  "Oddać książkę Ani",
  "Umówić wizytę u dentysty",
  "Zaplanować wszystkie sprawy na kolejny tydzień i uporządkować najważniejsze zadania. ".repeat(3).slice(0, 280),
  "Szósta myśl czeka poza najbliższą piątką",
].map((text, index) => ({
  id: `queue-${index}`, text, status: "active", createdAt: `2026-09-${15 + index}T10:00:00.000Z`,
  lastPresentedAt: null, completedAt: null,
}));

async function ready(page: Page) {
  await page.context().addCookies([{ name: "and1_session", value: cookie, url: test.info().project.use.baseURL! }]);
  await page.route("**/api/thoughts", route => route.request().method() === "GET"
    ? route.fulfill({ json: { thoughts: tasks } }) : route.continue());
  await page.goto("/");
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
}

for (const colorScheme of ["light", "dark"] as const) {
  for (const [width, height] of [[1440, 900], [1280, 720], [1024, 768], [768, 700], [390, 844], [375, 667], [320, 568]]) {
    test(`five nearest tasks fit without scrolling: ${width}x${height}, ${colorScheme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme });
      await ready(page);
      await expect(page.getByLabel("Myśl do zapisania")).toHaveCount(0);
      const cards = page.locator(".thought-card");
      await expect(cards).toHaveCount(5);
      for (let index = 0; index < 5; index++) {
        await expect(cards.nth(index).getByRole("button", { name: `Edytuj zadanie: ${tasks[index].text}`, exact: true })).toBeInViewport({ ratio: 1 });
        await expect(cards.nth(index).getByRole("button", { name: "Załatwione", exact: true })).toBeInViewport({ ratio: 1 });
      }
      expect(await page.evaluate(() => ({
        vertical: document.documentElement.scrollHeight <= innerHeight,
        horizontal: document.documentElement.scrollWidth <= innerWidth,
      }))).toEqual({ vertical: true, horizontal: true });
      await page.screenshot({ path: testInfo.outputPath("five-tasks.png") });
    });
  }
}

test("Plus and the shortcut open a focused dialog; closing preserves the draft and view", async ({ page }) => {
  await ready(page);
  const plus = page.getByRole("button", { name: "Dodaj myśl", exact: true });
  const input = page.getByLabel("Myśl do zapisania");
  await plus.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(input).toBeFocused();
  await input.fill("Szkic po zamknięciu");
  await page.keyboard.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(plus).toBeFocused();
  await page.locator(".desktop-nav").getByRole("button", { name: "Statystyki" }).click();
  await page.keyboard.press("Control+k");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("Szkic po zamknięciu");
  await page.getByRole("button", { name: "Zamknij dodawanie" }).click();
  await expect(page.getByRole("heading", { name: "Zadania w kolejce", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
  await expect(input).toHaveCount(0);
  await plus.click();
  await expect(input).toHaveValue("Szkic po zamknięciu");
});

test("a long preview opens the full task for editing", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await ready(page);
  await page.getByRole("button", { name: `Edytuj zadanie: ${tasks[4].text}`, exact: true }).click();
  await expect(page.getByLabel("Edytuj treść zadania")).toHaveValue(tasks[4].text);
});
