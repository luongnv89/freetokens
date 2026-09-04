import { fileURLToPath, URL } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveMeasurementId, resolveStatsSite } from './src/lib/analyticsEnv.ts'
import { envValue } from './scripts/env-file.mjs'

// Same secret names as scripts/build.py / deploy.yml. Unset or malformed
// values compile to empty strings so no tracker id reaches the bundle.
// Vitest always sees empty defines so unit tests cannot leak a real id
// from the developer environment; tests opt in via configureAnalytics().
//
// envValue falls back to app/.env when the var is not in the real
// environment: Vite never loads a dotenv file into process.env, so before
// this a filled-in app/.env produced a local build with no traffic markup
// at all while CI, which injects the secrets directly, looked fine.
const appDir = fileURLToPath(new URL('.', import.meta.url))
const runningVitest = Boolean(process.env.VITEST)
const ftGaId = runningVitest
  ? ""
  : resolveMeasurementId(envValue('GA_MEASUREMENT_ID', appDir), true)
const ftGcSite = runningVitest
  ? ""
  : resolveStatsSite(envValue('GOATCOUNTER_SITE_URL', appDir), true)

/** Discover CSS before the module graph so FCP is not queued behind 280 kB of JS. */
function cssBeforeModuleScripts() {
  return {
    name: "css-before-module-scripts",
    enforce: "post" as const,
    transformIndexHtml(html: string) {
      const styles = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*>/gi)].map(
        (m) => m[0],
      )
      if (styles.length === 0) return html
      let next = html
      for (const tag of styles) next = next.replace(tag, "")
      const inject = styles.join("\n    ")
      if (next.includes("</title>")) {
        return next.replace("</title>", `</title>\n    ${inject}`)
      }
      return next.replace(/<head[^>]*>/i, (open) => `${open}\n    ${inject}`)
    },
  }
}

export default defineConfig({
  // Relative base keeps built asset URLs deploy-base safe under the GitHub
  // Pages /<repo>/ project path, matching the Python builder's href policy.
  base: "./",
  plugins: [react(), tailwindcss(), cssBeforeModuleScripts()],
  define: {
    __FT_GA_ID__: JSON.stringify(ftGaId),
    __FT_GC_SITE__: JSON.stringify(ftGcSite),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Perf budget (Task 3.5): keep the bundle tight for CWV. cssMinify + esbuild
  // minify are Vite defaults but spelled out so the perf contract is visible;
  // chunkSizeWarningLimit surfaces regressions before they reach Lighthouse.
  // Manual chunks are NOT split — single JS keeps the critical graph at one
  // request (cssBeforeModuleScripts already puts CSS first for FCP).
  build: {
    cssMinify: true,
    minify: "esbuild",
    sourcemap: false,
    chunkSizeWarningLimit: 400,
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  esbuild: {
    drop: runningVitest ? [] : ["console", "debugger"],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    // Playwright specs live in e2e/*.spec.ts; keep them out of vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
