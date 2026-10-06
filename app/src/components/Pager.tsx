import type { MouseEvent } from "react";
import { pageItems } from "../lib/pagination";

/**
 * The numbered pager under the home offer list (#548). Every link carries a
 * real href so pages are shareable and openable in a new tab; a plain click
 * is intercepted and routed through onSelect, modifier clicks are left to
 * the browser.
 */
export function Pager({
  page,
  totalPages,
  hrefFor,
  onSelect,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
  onSelect: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  function handleClick(target: number) {
    return (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      onSelect(target);
    };
  }

  const prevContent = (
    <>
      <span aria-hidden="true">‹</span>{" "}
      <span className="pager-step-label">Previous</span>
    </>
  );
  const nextContent = (
    <>
      <span className="pager-step-label">Next</span>{" "}
      <span aria-hidden="true">›</span>
    </>
  );

  return (
    <nav className="pager" id="ft-pager" aria-label="Offer list pages">
      {page > 1 ? (
        <a
          className="pager-step pager-prev"
          href={hrefFor(page - 1)}
          rel="prev"
          onClick={handleClick(page - 1)}
        >
          {prevContent}
        </a>
      ) : (
        <span className="pager-step pager-prev" aria-hidden="true">
          {prevContent}
        </span>
      )}
      <ol className="pager-pages">
        {pageItems(page, totalPages).map((item, i) =>
          item === "gap" ? (
            <li key={`gap-${i}`} className="pager-gap" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={item}>
              <a
                className="pager-page"
                href={hrefFor(item)}
                aria-label={`Page ${item}`}
                aria-current={item === page ? "page" : undefined}
                onClick={handleClick(item)}
              >
                {item}
              </a>
            </li>
          ),
        )}
      </ol>
      {page < totalPages ? (
        <a
          className="pager-step pager-next"
          href={hrefFor(page + 1)}
          rel="next"
          onClick={handleClick(page + 1)}
        >
          {nextContent}
        </a>
      ) : (
        <span className="pager-step pager-next" aria-hidden="true">
          {nextContent}
        </span>
      )}
    </nav>
  );
}
