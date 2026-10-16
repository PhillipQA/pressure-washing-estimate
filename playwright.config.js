// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 4173;
// Run against the live site with: BASE_URL=https://phillipqa.github.io/pressure-washing-estimate/ npx playwright test
const BASE_URL = process.env.BASE_URL;

module.exports = defineConfig({
  testDir: "./tests-e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL || `http://127.0.0.1:${PORT}/`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } }
  ],
  webServer: BASE_URL
    ? undefined
    : {
        command: `node tests-e2e/static-server.js ${PORT}`,
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI
      }
});
