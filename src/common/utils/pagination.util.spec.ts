import {
  buildCompatPaginationMeta,
  buildPaginationMeta,
} from './pagination.util';

describe('buildPaginationMeta', () => {
  it('describes a middle page', () => {
    expect(buildPaginationMeta(95, 3, 10)).toEqual({
      page: 3,
      limit: 10,
      total: 95,
      totalPages: 10,
      hasNextPage: true,
      hasPreviousPage: true,
    });
  });

  it('marks the last page as having no next', () => {
    const meta = buildPaginationMeta(20, 2, 10);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('reports one page when there are no rows, not zero', () => {
    // totalPages: 0 makes `page <= totalPages` false on page 1, which reads to
    // a client as "this page does not exist" rather than "this list is empty".
    const meta = buildPaginationMeta(0, 1, 20);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(false);
  });

  it('survives a zero limit instead of paging forever', () => {
    // Math.ceil(n / 0) is Infinity, so every `page < totalPages` stays true.
    const meta = buildPaginationMeta(10, 1, 0);
    expect(Number.isFinite(meta.totalPages)).toBe(true);
    expect(meta.limit).toBe(1);
  });
});

describe('buildCompatPaginationMeta', () => {
  it('carries both dialects so the console keeps working', () => {
    const meta = buildCompatPaginationMeta(95, 3, 10);

    expect(meta.page).toBe(meta.currentPage);
    expect(meta.limit).toBe(meta.perPage);
    expect(meta.totalPages).toBe(meta.lastPage);
    expect(meta.prev).toBe(2);
    expect(meta.next).toBe(4);
  });

  it('nulls prev and next at the edges', () => {
    expect(buildCompatPaginationMeta(5, 1, 10).prev).toBeNull();
    expect(buildCompatPaginationMeta(5, 1, 10).next).toBeNull();
  });
});
