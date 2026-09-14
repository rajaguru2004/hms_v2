/**
 * One pagination meta, spoken in two dialects.
 *
 * Most list endpoints answer `{page, limit, total, totalPages, hasNextPage,
 * hasPreviousPage}`; the queue answers `{total, lastPage, currentPage, perPage,
 * prev, next}`. Two shapes means every client needs two readers, and the one it
 * forgets is the one that renders an empty board against a perfectly good 200.
 *
 * The queue's dialect is the odd one out, so it converges on the standard —
 * but the web console reads `currentPage`/`perPage`/`lastPage` today, so both
 * sets ship together for one release. The legacy keys are marked deprecated and
 * removed once the console is switched over.
 */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** The legacy queue dialect. Remove once `frontend/` reads the standard keys. */
export interface LegacyPaginationMeta {
  /** @deprecated use `page` */
  currentPage: number;
  /** @deprecated use `limit` */
  perPage: number;
  /** @deprecated use `totalPages` */
  lastPage: number;
  /** @deprecated use `hasPreviousPage` */
  prev: number | null;
  /** @deprecated use `hasNextPage` */
  next: number | null;
}

export type CompatPaginationMeta = PaginationMeta & LegacyPaginationMeta;

export function buildPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMeta {
  // A limit of zero would make totalPages Infinity and every `page < totalPages`
  // comparison true, so a client would page forever.
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));

  return {
    page,
    limit: safeLimit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

/** The standard meta plus the legacy queue keys, for the transition window. */
export function buildCompatPaginationMeta(
  total: number,
  page: number,
  limit: number,
): CompatPaginationMeta {
  const meta = buildPaginationMeta(total, page, limit);

  return {
    ...meta,
    currentPage: meta.page,
    perPage: meta.limit,
    lastPage: meta.totalPages,
    prev: meta.hasPreviousPage ? meta.page - 1 : null,
    next: meta.hasNextPage ? meta.page + 1 : null,
  };
}
