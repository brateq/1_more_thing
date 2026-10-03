import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

const payload = "v1.4102444800000";
const cookie = `${payload}.${createHmac("sha256", "migration-test-session-secret-1234567890").update(payload).digest("base64url")}`;

async function openAuthenticated(page: Page) {
  await page.context().addCookies([{ name: "and1_session", value: cookie, url: test.info().project.use.baseURL! }]);
  await page.goto("/");
  await expect(page.getByText("Zsynchronizowano", { exact: true })).toBeVisible();
}

async function offerInstallation(page: Page, outcome: "accepted" | "dismissed" | "error") {
  await page.evaluate((result) => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
      prompt: async () => {
        document.documentElement.dataset.installCalls = String(Number(document.documentElement.dataset.installCalls ?? "0") + 1);
        if (result === "error") throw new Error("Installation not available");
        return { outcome: result };
      },
      userChoice: Promise.resolve({ outcome: result }),
    });
    window.dispatchEvent(event);
  }, outcome);
}

test("Chromium parses the production manifest and finds no installation errors", async ({ page, context }) => {
  await page.goto("/");
  const session = await context.newCDPSession(page);
  const manifest = await session.send("Page.getAppManifest");
  expect(manifest.errors).toEqual([]);
  expect(JSON.parse(manifest.data!).display).toBe("standalone");
  const result = await session.send("Page.getInstallabilityErrors");
  expect(result.installabilityErrors).toEqual([]);
});

test("keeps a prompt received before login and consumes it once", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Hasło")).toBeVisible();
  await offerInstallation(page, "accepted");
  await page.getByLabel("Hasło").fill("migration-test-password-123");
  await page.getByRole("button", { name: "Wejdź", exact: true }).click();
  const button = page.getByRole("button", { name: "Zainstaluj", exact: true });
  await button.click();
  await expect(button).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-install-calls", "1");
});

test("handles dismissal, prompt failure and browser installation", async ({ page }) => {
  await openAuthenticated(page);
  const button = page.getByRole("button", { name: "Zainstaluj", exact: true });
  await offerInstallation(page, "dismissed");
  await button.click();
  await expect(button).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await offerInstallation(page, "error");
  await button.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText(/Nie udało się otworzyć okna instalacji/)).toBeVisible();
  await page.getByRole("button", { name: "Rozumiem" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await offerInstallation(page, "accepted");
  await expect(button).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(button).toHaveCount(0);
});

test("iPhone installation instructions fit the screen and restore focus on Escape", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
  });
  await openAuthenticated(page);
  await page.getByRole("button", { name: "Otwórz menu" }).click();
  await page.getByRole("button", { name: "Zainstaluj aplikację" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Do ekranu początkowego", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rozumiem" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("iphone-install-help.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Otwórz menu" })).toBeFocused();
});

test("Safari on Mac explains Add to Dock", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15" });
  });
  await page.setViewportSize({ width: 830, height: 900 });
  await openAuthenticated(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Zainstaluj", exact: true }).click();
  await expect(page.getByRole("dialog").getByText("Plik → Dodaj do Docka", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mac-install-help.png") });
  await page.getByRole("button", { name: "Rozumiem" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("hides installation controls when launched standalone on iOS", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "iPhone" });
    Object.defineProperty(navigator, "standalone", { value: true });
  });
  await openAuthenticated(page);
  await page.getByRole("button", { name: "Otwórz menu" }).click();
  await expect(page.getByRole("button", { name: /Zainstaluj/ })).toHaveCount(0);
});
