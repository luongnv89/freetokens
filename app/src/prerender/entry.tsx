// Node-side render entry: imports ONLY the page component tree (never
// main.tsx, whose CSS import node cannot parse) and returns prerendered
// markup per route (issue #123 — one React render per static document).
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App";
import indexData from "../data/offers.json";
import type { OffersIndex } from "../lib/offers";
import type { Route } from "../routes";

const index = indexData as OffersIndex;

export async function renderRoute(
  route: Route,
  baseUrl?: string,
): Promise<string> {
  return renderToStaticMarkup(
    <App index={index} route={route} baseUrl={baseUrl} />,
  );
}
