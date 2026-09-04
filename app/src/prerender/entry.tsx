// Node-side render entry: imports ONLY the page component tree (never
// main.tsx, whose CSS import node cannot parse) and returns prerendered
// markup per route (issue #123 — one React render per static document).
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App";
import type { Route } from "../routes";

export async function renderRoute(
  route: Route,
  baseUrl?: string,
): Promise<string> {
  return renderToStaticMarkup(<App route={route} baseUrl={baseUrl} />);
}
