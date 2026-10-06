// Home offer-list paging (#548): the list renders PAGE_SIZE rows per page
// and the pager below it walks a fixed-size window of numbered links.

export const PAGE_SIZE = 20;

export type PageItem = number | "gap";

export function pageCount(total: number, size = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/**
 * The numbered links between Previous and Next. Once `total` passes seven
 * the window always holds exactly seven slots — first page, last page, and
 * the pages around `current`, with "gap" markers where runs were dropped —
 * so the pager keeps a steady shape as the visitor moves between pages.
 */
export function pageItems(current: number, total: number): PageItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "gap", total];
  if (current >= total - 3) {
    return [1, "gap", total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, "gap", current - 1, current, current + 1, "gap", total];
}
