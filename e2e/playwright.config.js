const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  timeout: 30000,
  retries: 0,
  workers: 1, // Electron apps need single worker
  use: {
    headless: true,
    screenshot: "only-on-failure",
  },
});
