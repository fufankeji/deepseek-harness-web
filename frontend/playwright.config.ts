import { defineConfig, devices } from "@playwright/test";

const externalServer = process.env.PLAYWRIGHT_BASE_URL;
const testPort = process.env.FF_E2E_BRIDGE_PORT ?? "4327";
const baseURL = externalServer ?? `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  reporter: "line",
  webServer: externalServer ? undefined : {
    command: "npm run start:e2e --prefix ../backend",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop-chromium", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1672, height: 941 } } },
    { name: "mobile-chromium", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"] } }
  ]
});
