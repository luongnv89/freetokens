import { fileURLToPath, URL } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveMeasurementId, resolveStatsSite } from './src/lib/analyticsEnv.ts'

// Same secret names as scripts/build.py / deploy.yml. Unset or malformed
// values compile to empty strings so no tracker id reaches the bundle.
// Vitest always sees empty defines so unit tests cannot leak a real id
// from the developer environment; tests opt in via configureAnalytics().
const runningVitest = Boolean(process.env.VITEST)
const ftGaId = runningVitest
  ? ""
  : resolveMeasurementId(process.env.GA_MEASUREMENT_ID, true)
const ftGcSite = runningVitest
  ? ""
  : resolveStatsSite(process.env.GOATCOUNTER_SITE_URL, true)

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
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.ts',
    // Playwright specs live in e2e/*.spec.ts; keep them out of vitest.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
