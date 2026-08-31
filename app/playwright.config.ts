import { defineConfig, devices } from "@playwright/test";

// Not listed in tsconfig.app.json (include is `src` only). Playwright CLI
// typechecks this file; tsc -b stays green without pulling e2e into the app graph.

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  workers: ci ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        // WebKit honours CSP upgrade-insecure-requests on http://127.0.0.1 and
        // then TLS-fails CSS/JS. Production is HTTPS; this only unblocks local
        // preview so overflow/consent/keyboard actually exercise the app (#254).
        bypassCSP: true,
      },
    },
  ],
  webServer: {
    command:
      "npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !ci,
    timeout: 120000,
    env: {
      ...process.env,
      // Valid MEASUREMENT_ID_RE; ConsentBanner returns null without it (AC4).
      GA_MEASUREMENT_ID: "G-TESTID000",
    },
  },
});
