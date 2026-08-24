// Node-side render entry: imports ONLY the page component tree (never
// main.tsx, whose CSS import node cannot parse) and returns the full
// prerendered document fragment for dist/index.html.
import { renderToStaticMarkup } from "react-dom/server"
import App from "../App"

export async function renderHomeDocument(): Promise<string> {
  return renderToStaticMarkup(<App />)
}
