import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: { baseURL: process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:3102", timezoneId: "Europe/Warsaw", locale: "pl-PL", reducedMotion: "reduce" },
  webServer: process.env.VISUAL_BASE_URL ? undefined : { command: "node tests/helpers/browser-server.mjs", url: "http://127.0.0.1:3102/health", reuseExistingServer: false },
});
