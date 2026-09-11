// Node-side render entry: imports ONLY the page component tree (never
// main.tsx, whose CSS import node cannot parse) and returns prerendered
// markup per route (issue #123 — one React render per static document).
import { Writable } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import App from "../App";
import indexData from "../data/offers.json";
import detailsData from "../data/details.json";
import type { OffersIndex } from "../lib/offers";
import type { DetailsMap } from "../lib/offerDetails";
import type { Route } from "../routes";

const index = indexData as OffersIndex;
// Node-side only: this entry is bundled separately by scripts/prerender.mjs,
// so the aggregate details map never reaches the client chunk. The client
// (main.tsx) loads it via a route-guarded dynamic import instead (#369).
const details = detailsData as DetailsMap;

/**
 * Stream render: renderToPipeableStream (NOT renderToStaticMarkup).
 * renderToStaticMarkup omits the `<!-- -->` text separators Fizz emits
 * between adjacent text nodes, so hydrateRoot sees a different child shape
 * and regenerates the whole tree (React error #418, #369). The stream
 * renderer produces the exact HTML hydrateRoot expects, still one React
 * render per static document.
 */
export async function renderRoute(
  route: Route,
  baseUrl?: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const out: Buffer[] = [];
    let settled = false;
    const finish = (err?: unknown) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(Buffer.concat(out).toString("utf8"));
    };
    const { pipe } = renderToPipeableStream(
      <App
        index={index}
        details={details}
        route={route}
        baseUrl={baseUrl}
      />,
      {
        onError: (error) => finish(error),
        onAllReady() {
          pipe(
            new Writable({
              write(chunk, _enc, cb) {
                out.push(chunk);
                cb();
              },
              final(cb) {
                finish();
                cb();
              },
              destroy(err, cb) {
                finish(err);
                cb();
              },
            }),
          );
        },
      },
    );
  });
}
